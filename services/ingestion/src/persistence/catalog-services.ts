/**
 * catalog-services.ts — Adapters REAIS das portas dos handlers. EXCLUIDO do
 * typecheck (toca Prisma + client TMDB).
 *
 * Traduz as portas puras de `catalog-jobs/handlers/ports.ts` para os servicos
 * que ja existem (import/*, catalog-sync/*, catalog-entities/*, episodes/*,
 * raw-promote/*, search-projection/*). Nao reimplementa dominio: so liga.
 *
 * ARMADILHA CENTRAL — os servicos de import e de midia sao "pipeline-safe": eles
 * NAO lancam; uma falha vira `status: 'failed'` no resultado e uma linha em
 * api_sync_logs. Isso e certo para um lote (um item ruim nao derruba 1000), mas
 * ERRADO para a fila: um handler que devolvesse esse resultado como sucesso
 * marcaria o job `succeeded` e o erro sumiria — sem retry, sem dead-letter.
 * Por isso todo adapter aqui CONVERTE `status failed/aborted` em throw.
 */

import {
  importMovie,
  importPerson,
  importTvShow,
} from '../import/index.js'
import { normalizeMovie } from '../normalizers/movie.js'
import { normalizeTvShow } from '../normalizers/tv.js'
import { normalizePerson } from '../normalizers/person.js'
import {
  extractAlternativeTitles,
  extractCollectionRef,
  extractKeywords,
  extractNetworks,
  extractProductionCompanies,
  normalizeCollectionDetail,
  normalizeCollectionParts,
  normalizeCompanyDetail,
  normalizeKeywordDetail,
  normalizeNetworkDetail,
} from '../catalog-entities/normalize.js'
import {
  extractEpisodeCast,
  extractEpisodeCrew,
  extractEpisodeExternalIds,
  extractEpisodeGuestStars,
  extractEpisodeStills,
} from '../episodes/normalize.js'
import { runMediaSync } from '../catalog-sync/media-sync.js'
import { extractListItems } from '../discovery-snapshots/index.js'
import { parseIdExport, exportUrl, DAILY_ID_EXPORTS } from '../discovery/id-exports.js'
import { filterAdult } from '../discovery/adult-filter.js'
import { reindexEntity } from '../search-projection/index.js'
import { PermanentJobError } from '../catalog-jobs/handler.js'
import { promoteMoviesFromRaw, promotePeopleFromRaw, promoteTvShowsFromRaw } from '../raw-promote/run.js'
import { createPrismaCatalogEntitiesStore } from './catalog-entities-store.js'
import { createPrismaEpisodeStore } from './episode-store.js'
import { createPrismaMediaStore } from './media-store.js'
import { createPrismaSearchStore } from './search-store.js'
import { createPrismaSearchProjectionSource } from './search-projection-source.js'
import { createPrismaDiscoverySnapshotStore } from './discovery-snapshot-store.js'
import { createPrismaChangesCheckpoint } from './changes-checkpoint-store.js'
import { createPrismaCatalogJobStore } from './catalog-job-store.js'
import { createPrismaRawMovieSource, createPrismaRawPersonSource, createPrismaRawTvSource } from './tmdb-raw-promote-store.js'
import { createPrismaCatalogFinalize } from './catalog-finalize.js'
import { createPersistence } from './index.js'

/** Erro transitorio de um servico pipeline-safe que reportou falha. */
class CatalogServiceError extends Error {
  constructor(operation, code, detail) {
    super(`${operation} falhou (${code})${detail ? `: ${detail}` : ''}`)
    this.name = 'CatalogServiceError'
    this.code = code
  }
}

/**
 * Converte o `ImportResult` pipeline-safe em excecao quando falhou.
 *
 * `aborted` e `failed` viram throw: o worker decide retry/dead-letter. Um 404
 * (entidade nao existe upstream) e PERMANENTE — repetir devolve o mesmo 404.
 */
function assertImportOk(result, operation) {
  if (result.status === 'success') return result
  const code = result.error ?? 'unknown'
  if (/\b404\b|not[_ ]?found/i.test(String(result.error ?? ''))) {
    throw new PermanentJobError('upstream_not_found', `${operation}: ${code}`)
  }
  throw new CatalogServiceError(operation, result.status, result.error)
}

/** Monta os adapters de servico do catalogo. */
export function createCatalogServices(options) {
  const { tmdb, catalogEndpoints, staleWindowMs = 7 * 24 * 60 * 60 * 1000, now = () => new Date() } = options
  const persistence = createPersistence({ ttlMs: options.cacheTtlMs, now })
  const prisma = persistence.prisma

  const entitiesStore = createPrismaCatalogEntitiesStore(prisma)
  const episodeStore = createPrismaEpisodeStore(prisma)
  const mediaStore = createPrismaMediaStore(prisma)
  const searchStore = createPrismaSearchStore(prisma)
  const searchSource = createPrismaSearchProjectionSource(prisma)
  const snapshots = createPrismaDiscoverySnapshotStore(prisma)
  const checkpoint = createPrismaChangesCheckpoint(prisma)
  const jobStore = createPrismaCatalogJobStore(prisma, { now })

  /** Contexto de import (mesmo shape usado por composition.ts). */
  const importContext = {
    tmdb,
    cache: persistence.cache,
    store: persistence.store,
    syncLog: persistence.syncLog,
    now,
    staleAfter: (at) => new Date(at.getTime() + staleWindowMs),
  }

  /** Detalhe de uma entidade de referencia (collection/company/network/keyword). */
  async function syncReferenceDetail(kind, tmdbId, locale) {
    if (kind === 'collection') {
      const payload = await catalogEndpoints.getCollection(tmdbId, locale)
      const row = normalizeCollectionDetail(payload)
      if (row === null) throw new PermanentJobError('invalid_upstream', `collection ${tmdbId} sem id/nome`)
      const parts = normalizeCollectionParts(payload)
      const linked = await entitiesStore.upsertCollectionWithParts(row, parts)
      return { created: true, updated: false, unchanged: false, entityId: null, skipped: false, skipReason: null, linked }
    }
    if (kind === 'company') {
      const row = normalizeCompanyDetail(await catalogEndpoints.getCompany(tmdbId))
      if (row === null) throw new PermanentJobError('invalid_upstream', `company ${tmdbId} sem id/nome`)
      await entitiesStore.upsertCompany(row)
      return { created: true, updated: false, unchanged: false, entityId: null, skipped: false, skipReason: null }
    }
    if (kind === 'network') {
      const row = normalizeNetworkDetail(await catalogEndpoints.getNetwork(tmdbId))
      if (row === null) throw new PermanentJobError('invalid_upstream', `network ${tmdbId} sem id/nome`)
      await entitiesStore.upsertNetwork(row)
      return { created: true, updated: false, unchanged: false, entityId: null, skipped: false, skipReason: null }
    }
    const row = normalizeKeywordDetail(await catalogEndpoints.getKeyword(tmdbId))
    if (row === null) throw new PermanentJobError('invalid_upstream', `keyword ${tmdbId} sem id/nome`)
    await entitiesStore.upsertKeyword(row)
    return { created: true, updated: false, unchanged: false, entityId: null, skipped: false, skipReason: null }
  }

  /** Vincula referencias (colecao/produtoras/redes/keywords/aliases) de movie|tv. */
  async function syncEntityReferences(kind, tmdbId, detail) {
    return entitiesStore.syncEntityReferences({
      entityType: kind,
      entityTmdbId: tmdbId,
      collection: extractCollectionRef(detail),
      companies: extractProductionCompanies(detail),
      networks: kind === 'tv' ? extractNetworks(detail) : [],
      keywords: extractKeywords(detail),
      alternativeTitles: extractAlternativeTitles(detail),
    })
  }

  const detailSync = {
    async syncDetail({ kind, tmdbId, locale }) {
      if (kind === 'movie') {
        const result = assertImportOk(await importMovie(importContext, tmdbId), `importMovie(${tmdbId})`)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
        }
      }
      if (kind === 'tv') {
        const result = assertImportOk(await importTvShow(importContext, tmdbId), `importTvShow(${tmdbId})`)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
        }
      }
      if (kind === 'person') {
        const result = assertImportOk(await importPerson(importContext, tmdbId), `importPerson(${tmdbId})`)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
        }
      }
      return syncReferenceDetail(kind, tmdbId, locale)
    },
  }

  const creditsSync = {
    async syncCredits({ kind, tmdbId, seasonNumber, episodeNumber }) {
      if (kind === 'episode') {
        const payload = await tmdb.getTvSeason(tmdbId, seasonNumber)
        const episode = findEpisode(payload, episodeNumber)
        if (episode === null) {
          return { cast: 0, crew: 0, guestStars: 0, skipped: true, skipReason: 'episodio ausente no payload' }
        }
        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tmdbId,
          seasonNumber,
          episodeNumber,
          cast: extractEpisodeCast(episode),
          guestStars: extractEpisodeGuestStars(episode),
          crew: extractEpisodeCrew(episode),
          externalIds: [],
          stills: [],
        })
        return {
          cast: outcome.cast,
          crew: outcome.crew,
          guestStars: outcome.guestStars,
          skipped: false,
          skipReason: null,
        }
      }

      // Caminho de REPARO de movie|tv: reprocessa o detalhe (cache quente) e
      // reaplica elenco/equipe mesmo quando o payload nao mudou — que e
      // exatamente o buraco que o import short-circuita no `touch`.
      if (kind === 'movie') {
        const detail = await tmdb.getMovie(tmdbId)
        const normalized = normalizeMovie(detail)
        const outcome = await persistence.store.upsertMovie({
          movie: normalized.movie,
          externalIds: normalized.externalIds,
          cast: normalized.cast,
          crew: normalized.crew,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        await syncEntityReferences('movie', tmdbId, detail)
        return {
          cast: normalized.cast.length,
          crew: normalized.crew.length,
          guestStars: 0,
          skipped: outcome === null,
          skipReason: null,
        }
      }
      if (kind === 'tv') {
        const detail = await tmdb.getTvShow(tmdbId)
        const normalized = normalizeTvShow(detail)
        await persistence.store.upsertTvShow({
          tvShow: normalized.tvShow,
          externalIds: normalized.externalIds,
          cast: normalized.cast,
          crew: normalized.crew,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        await syncEntityReferences('tv', tmdbId, detail)
        return {
          cast: normalized.cast.length,
          crew: normalized.crew.length,
          guestStars: 0,
          skipped: false,
          skipReason: null,
        }
      }
      // `season`: os creditos de temporada nao tem tabela propria; o nivel util
      // e o episodio. Reportar skip explicito e melhor que fingir sucesso.
      return { cast: 0, crew: 0, guestStars: 0, skipped: true, skipReason: 'creditos de temporada nao persistidos' }
    },
  }

  const externalIdsSync = {
    async syncExternalIds({ kind, tmdbId, seasonNumber, episodeNumber }) {
      if (kind === 'episode') {
        const payload = await tmdb.getTvSeason(tmdbId, seasonNumber)
        const episode = findEpisode(payload, episodeNumber)
        if (episode === null) {
          return { upserted: 0, changed: 0, skipped: true, skipReason: 'episodio ausente no payload' }
        }
        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tmdbId,
          seasonNumber,
          episodeNumber,
          cast: [],
          guestStars: [],
          crew: [],
          externalIds: extractEpisodeExternalIds(episode),
          stills: [],
        })
        return { upserted: outcome.externalIds, changed: 0, skipped: false, skipReason: null }
      }
      if (kind === 'movie') {
        const normalized = normalizeMovie(await tmdb.getMovie(tmdbId))
        await persistence.store.upsertMovie({
          movie: normalized.movie,
          externalIds: normalized.externalIds,
          cast: normalized.cast,
          crew: normalized.crew,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        return { upserted: normalized.externalIds.length, changed: 0, skipped: false, skipReason: null }
      }
      if (kind === 'tv') {
        const normalized = normalizeTvShow(await tmdb.getTvShow(tmdbId))
        await persistence.store.upsertTvShow({
          tvShow: normalized.tvShow,
          externalIds: normalized.externalIds,
          cast: normalized.cast,
          crew: normalized.crew,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        return { upserted: normalized.externalIds.length, changed: 0, skipped: false, skipReason: null }
      }
      const normalized = normalizePerson(await tmdb.getPerson(tmdbId))
      await persistence.store.upsertPerson({
        person: normalized.person,
        externalIds: normalized.externalIds,
        lastSyncedAt: now(),
      })
      return { upserted: normalized.externalIds.length, changed: 0, skipped: false, skipReason: null }
    },
  }

  const mediaSync = {
    async syncMedia({ kind, tmdbId, seasonNumber, episodeNumber }) {
      const target = buildMediaTarget(catalogEndpoints, kind, tmdbId, seasonNumber, episodeNumber)
      const result = await runMediaSync(target, {
        cache: persistence.cache,
        log: persistence.syncLog,
        store: mediaStore,
        now,
      })
      // runMediaSync tambem e pipeline-safe: falha vira status, nao excecao.
      if (result.images.status === 'failed' || result.videos?.status === 'failed') {
        throw new CatalogServiceError(`runMediaSync(${kind}/${tmdbId})`, 'failed')
      }
      return {
        images: result.images.rows,
        videos: result.videos?.rows ?? 0,
        skipped: false,
        skipReason: null,
      }
    },
  }

  const seasonsSync = {
    async syncSeasons({ tvTmdbId }) {
      const detail = await tmdb.getTvShow(tvTmdbId)
      const seasons = Array.isArray(detail?.seasons) ? detail.seasons : []
      const seasonNumbers = []
      for (const season of seasons) {
        const number = season?.season_number
        // Numero de temporada e a chave natural: sem ele nao ha o que buscar.
        if (typeof number === 'number' && Number.isInteger(number) && number >= 0) {
          seasonNumbers.push(number)
        }
      }
      return {
        seasons: seasonNumbers.length,
        episodes: 0,
        seasonNumbers,
        skipped: false,
        skipReason: null,
      }
    },
  }

  const episodesSync = {
    async syncEpisodes({ tvTmdbId, seasonNumber }) {
      const payload = await tmdb.getTvSeason(tvTmdbId, seasonNumber)
      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : []
      let cast = 0
      let guestStars = 0
      let crew = 0
      let externalIds = 0
      let stills = 0
      let processed = 0
      let skippedNoTmdbId = 0

      for (const episode of episodes) {
        const number = episode?.episode_number
        if (typeof number !== 'number' || !Number.isInteger(number)) {
          // Sem numero nao existe chave natural: pular e contar, nunca inventar.
          skippedNoTmdbId += 1
          continue
        }
        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tvTmdbId,
          seasonNumber,
          episodeNumber: number,
          cast: extractEpisodeCast(episode),
          guestStars: extractEpisodeGuestStars(episode),
          crew: extractEpisodeCrew(episode),
          externalIds: extractEpisodeExternalIds(episode),
          stills: extractEpisodeStills(episode),
        })
        cast += outcome.cast
        guestStars += outcome.guestStars
        crew += outcome.crew
        externalIds += outcome.externalIds
        stills += outcome.stills
        processed += 1
      }

      return {
        episodes: processed,
        cast,
        guestStars,
        crew,
        externalIds,
        stills,
        skippedNoTmdbId,
        skipped: false,
        skipReason: null,
      }
    },
  }

  const listFetch = {
    async fetchPage({ listType, entityType, locale, country, window, page }) {
      return fetchDiscoveryPage(catalogEndpoints, { listType, entityType, locale, country, window, page })
    },
  }

  const discovery = {
    async discover({ strategy, kind, locale, country, limit, maxPages, ids }) {
      if (strategy === 'explicit-ids') {
        const accepted = [...new Set(ids ?? [])]
        return {
          discovered: accepted.length,
          accepted: accepted.length,
          rejectedAdult: 0,
          duplicate: (ids?.length ?? 0) - accepted.length,
          ids: limit === null ? accepted : accepted.slice(0, limit),
        }
      }
      if (strategy === 'daily-exports') {
        return discoverFromDailyExports(kind, limit, now, options.fetchText)
      }
      return discoverFromLists(catalogEndpoints, {
        strategy,
        kind,
        locale,
        country,
        limit,
        maxPages: maxPages ?? 5,
      })
    },
  }

  const reprocessRaw = {
    async reprocess({ kind, baseLanguage, limit, dryRun }) {
      // `finalize` e OBRIGATORIO: e ele que grava slug canonico (+301 na troca) e
      // a traducao. Promover sem ele deixaria a entidade sem slug — e entidade
      // sem slug nao indexa nem entra na busca (o backfill pagina por slug).
      const shared = {
        baseLanguage,
        limit: limit ?? 100,
        dryRun,
        store: persistence.store,
        finalize: createPrismaCatalogFinalize(prisma, baseLanguage),
        now,
      }
      const report =
        kind === 'movie'
          ? await promoteMoviesFromRaw({ ...shared, source: createPrismaRawMovieSource(prisma) })
          : kind === 'tv'
            ? await promoteTvShowsFromRaw({ ...shared, source: createPrismaRawTvSource(prisma) })
            : await promotePeopleFromRaw({ ...shared, source: createPrismaRawPersonSource(prisma) })

      const counts = report.counts ?? {}
      const created = counts.created ?? 0
      const updated = counts.updated ?? 0
      const skipped = counts.skipped ?? 0
      const failed = counts.failed ?? 0
      return {
        scanned: created + updated + skipped + failed,
        promoted: created + updated,
        unchanged: skipped,
        skipped,
        failed,
        dryRun,
      }
    },
  }

  const search = {
    async reindexEntity(entityType, entityId, locale) {
      await reindexEntity({ source: searchSource, store: searchStore }, entityType, entityId, locale)
    },
  }

  const changes = {
    async fetchChanges(kind, params) {
      if (kind === 'movie') return catalogEndpoints.getMovieChanges(params)
      if (kind === 'tv') return catalogEndpoints.getTvChanges(params)
      return catalogEndpoints.getPersonChanges(params)
    },
    checkpoint,
    now,
  }

  return {
    prisma,
    store: jobStore,
    detailSync,
    creditsSync,
    externalIdsSync,
    mediaSync,
    seasonsSync,
    episodesSync,
    discovery,
    reprocessRaw,
    listFetch,
    snapshots,
    changes,
    search,
    searchStore,
    searchSource,
    persistence,
    now,
  }
}

/** Acha um episodio pelo numero dentro do payload de temporada. */
function findEpisode(seasonPayload, episodeNumber) {
  const episodes = Array.isArray(seasonPayload?.episodes) ? seasonPayload.episodes : []
  return episodes.find((e) => e?.episode_number === episodeNumber) ?? null
}

/** Monta o alvo de midia com os fetchers certos por tipo. */
function buildMediaTarget(endpoints, kind, tmdbId, seasonNumber, episodeNumber) {
  if (kind === 'movie') {
    return {
      entityType: 'movie',
      tmdbId,
      fetchImages: () => endpoints.getMovieImages(tmdbId),
      fetchVideos: () => endpoints.getMovieVideos(tmdbId),
    }
  }
  if (kind === 'tv') {
    return {
      entityType: 'tv',
      tmdbId,
      fetchImages: () => endpoints.getTvImages(tmdbId),
      fetchVideos: () => endpoints.getTvVideos(tmdbId),
    }
  }
  if (kind === 'season') {
    return {
      entityType: 'season',
      tmdbId,
      fetchImages: () => endpoints.getSeasonImages(tmdbId, seasonNumber),
      fetchVideos: () => endpoints.getSeasonVideos(tmdbId, seasonNumber),
    }
  }
  if (kind === 'episode') {
    return {
      entityType: 'episode',
      tmdbId,
      fetchImages: () => endpoints.getEpisodeImages(tmdbId, seasonNumber, episodeNumber),
      fetchVideos: () => endpoints.getEpisodeVideos(tmdbId, seasonNumber, episodeNumber),
    }
  }
  // Pessoa nao tem endpoint de videos: `fetchVideos` ausente por contrato.
  return {
    entityType: 'person',
    tmdbId,
    fetchImages: () => endpoints.getPersonImages(tmdbId),
  }
}

/** Busca uma pagina da lista de descoberta pedida. */
async function fetchDiscoveryPage(endpoints, { listType, entityType, locale, country, window, page }) {
  const params = { page, language: locale, region: country ?? undefined }
  if (listType === 'trending') {
    return endpoints.getTrending(entityType, window === 'week' ? 'week' : 'day', params)
  }
  if (listType === 'popular') {
    return entityType === 'movie' ? endpoints.getPopularMovies(params) : endpoints.getPopularTvShows(params)
  }
  if (listType === 'top_rated') {
    return entityType === 'movie' ? endpoints.getTopRatedMovies(params) : endpoints.getTopRatedTvShows(params)
  }
  if (listType === 'upcoming') return endpoints.getUpcomingMovies(params)
  if (listType === 'now_playing') return endpoints.getNowPlayingMovies(params)
  if (listType === 'airing_today') return endpoints.getAiringTodayTvShows(params)
  if (listType === 'on_the_air') return endpoints.getOnTheAirTvShows(params)
  return entityType === 'movie' ? endpoints.discoverMovies(params) : endpoints.discoverTvShows(params)
}

/** Descobre ids a partir das listas do provider. */
async function discoverFromLists(endpoints, { strategy, kind, locale, country, limit, maxPages }) {
  const entityType = kind === 'person' ? 'movie' : kind
  const ids = []
  let discovered = 0
  let duplicate = 0
  const seen = new Set()

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchDiscoveryPage(endpoints, {
      listType: strategy,
      entityType,
      locale,
      country,
      window: 'day',
      page,
    })
    const items = extractListItems(response)
    if (items.length === 0) break
    for (const item of items) {
      discovered += 1
      if (seen.has(item.entityTmdbId)) {
        duplicate += 1
        continue
      }
      seen.add(item.entityTmdbId)
      ids.push(item.entityTmdbId)
      if (limit !== null && ids.length >= limit) break
    }
    if (limit !== null && ids.length >= limit) break
    const totalPages = response?.total_pages
    if (typeof totalPages === 'number' && page >= totalPages) break
  }

  return { discovered, accepted: ids.length, rejectedAdult: 0, duplicate, ids }
}

/**
 * Descobre ids pelos Daily ID Exports.
 *
 * Duas camadas anti-adulto (regra de ingestao): os arquivos `adult_*` nunca sao
 * baixados (so o catalogo padrao entra), e o campo `adult` e classificado
 * FAIL-CLOSED por linha — `false` e seguro; `true` e descartado; qualquer valor
 * presente porem malformado ("true", 1, null) e descartado como unsafe, nunca
 * presumido seguro.
 */
async function discoverFromDailyExports(kind, limit, now, fetchText) {
  if (typeof fetchText !== 'function') {
    throw new PermanentJobError('missing_dependency', 'discover daily-exports exige `fetchText` no wiring')
  }
  const file = DAILY_ID_EXPORTS.find((f) => f.kind === kind)
  if (file === undefined) {
    throw new PermanentJobError('unsupported_kind', `sem export diario para "${kind}"`)
  }
  // O export do dia so fica pronto ~08:00 UTC; usamos o dia anterior.
  const date = new Date(now().getTime() - 24 * 60 * 60 * 1000)
  const text = await fetchText(exportUrl(file.file, date))
  const records = parseIdExport(text)

  // `filterAdult` E a camada 2: `adult === true` e descartado, e um `adult`
  // malformado ("true", 1, null) ou AUSENTE num export que deveria traze-lo
  // (movie/person, via `hasAdultField`) tambem cai — nunca presumido seguro.
  const filtered = filterAdult(records, { adultFieldRequired: file.hasAdultField })

  const ids = []
  const seen = new Set()
  let duplicate = 0

  for (const record of filtered.kept) {
    if (seen.has(record.id)) {
      duplicate += 1
      continue
    }
    seen.add(record.id)
    ids.push(record.id)
    if (limit !== null && ids.length >= limit) break
  }

  return {
    discovered: records.length,
    accepted: ids.length,
    // Descarte "unsafe" conta junto com adulto: os dois sao o filtro protegendo
    // a fila, e somar os dois e o numero que o operador precisa vigiar.
    rejectedAdult: filtered.adultDropped + filtered.unsafeDropped,
    duplicate,
    ids,
  }
}
