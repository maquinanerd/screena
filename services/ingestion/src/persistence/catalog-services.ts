/**
 * catalog-services.ts — Adapters REAIS das portas dos handlers.
 *
 * Fora do `tsconfig.json` principal (toca Prisma + client TMDB), mas COBERTO por
 * `tsconfig.runtime.json` (`pnpm typecheck:catalog-runtime`). As portas abaixo
 * sao anotadas com suas interfaces de proposito: e assim que o compilador checa
 * cada chamada contra a assinatura REAL do servico.
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
import { CatalogServiceError, assertImportOk } from '../import/assert-ok.js'
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
import type { MediaTarget } from '../catalog-sync/media-sync.js'
import { extractListItems } from '../discovery-snapshots/index.js'
import { exportUrl, DAILY_ID_EXPORTS } from '../discovery/id-exports.js'
import { discoverIdsFromExportText } from '../discovery/export-discovery.js'
import { reindexEntity } from '../search-projection/index.js'
import type { SearchProjectionSourcePort } from '../search-projection/index.js'
import type { SearchStorePort } from '../search/store-port.js'
import { PermanentJobError } from '../catalog-jobs/handler.js'
import { createNoopMetricsSink } from '../metrics/index.js'
import type { MetricsSink } from '../metrics/index.js'
import type { CatalogHandlerDependencies } from '../catalog-jobs/handlers/registry.js'
import type {
  CatalogCreditsSyncPort,
  CatalogDetailSyncPort,
  CatalogDiscoverIdsPort,
  CatalogEpisodesSyncPort,
  CatalogExternalIdsSyncPort,
  CatalogMediaSyncPort,
  CatalogReprocessRawPort,
  CatalogSeasonsSyncPort,
  CreditsSyncOutcome,
  DetailSyncOutcome,
  DiscoverIdsOutcome,
  DiscoveryListFetchPort,
  DiscoveryListPage,
  SearchReindexPort,
} from '../catalog-jobs/handlers/ports.js'
import type { SyncDetailKind } from '../catalog-jobs/handlers/schemas.js'
import type { ReferenceOwnerType } from '../catalog-entities/store-port.js'
import type { CatalogDisplayFields } from '../display-fields.js'
import { desiredCatalogSlug } from '../public-catalog-slug.js'
import type { CreditsWriteOutcome, TmdbReadPort } from '../ports.js'
import type { PrismaClient } from '@screena/db/server'
import type { TmdbCatalogEndpoints } from '@screena/tmdb-client'
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
import { createPrismaTmdbWatchOfferStore, createPrismaWatchEntityResolver } from './watch-providers-store.js'
import { DEFAULT_WATCH_TERRITORIES } from '../watch-providers/territories.js'
import { emptyDetailWatchReport } from '../watch-providers/from-detail.js'
import { createPersistence } from './index.js'

/**
 * Exige um numero onde o tipo da porta permite null.
 *
 * O validador do handler ja garante o campo, mas o TIPO nao expressa isso. Sem a
 * guarda, um chamador direto passaria `null` adiante e a URL do provider sairia
 * errada em silencio. Falha permanente: nao adianta repetir um input incompleto.
 */
function requireNumber(value: number | null, field: string, kind: string): number {
  if (value === null) {
    throw new PermanentJobError('invalid_job_input', `"${field}" e obrigatorio para ${kind}`)
  }
  return value
}

/**
 * Traduz o resumo do replace-set de creditos para o relatorio do `sync_credits`.
 *
 * Quando o payload nao trouxe NENHUMA das duas listas, nada foi regravado — e o
 * job precisa dizer isso. Antes esse caso devolvia `{ cast: 0, skipped: false }`,
 * ou seja, "sucesso, zero creditos", enquanto o store apagava o elenco existente.
 */
function creditsSyncOutcome(credits: CreditsWriteOutcome): CreditsSyncOutcome {
  if (!credits.castReplaced && !credits.crewReplaced) {
    return {
      cast: 0,
      crew: 0,
      guestStars: 0,
      skipped: true,
      skipReason: 'payload sem bloco credits: elenco/equipe preservados',
    }
  }
  return {
    cast: credits.castLinked,
    crew: credits.crewLinked,
    guestStars: 0,
    skipped: false,
    // Credito descartado por falta de stub de pessoa e perda de dado: aparece
    // no relatorio em vez de sumir no `.filter`.
    skipReason:
      credits.castDropped + credits.crewDropped > 0
        ? `creditos sem pessoa resolvida descartados: elenco=${credits.castDropped} equipe=${credits.crewDropped}`
        : null,
  }
}

/** Opcoes de montagem dos servicos do catalogo. */
export interface CatalogServicesOptions {
  /** Endpoints de leitura (movie/tv/season/person/upcoming). */
  readonly tmdb: TmdbReadPort
  /** Endpoints de catalogo (listas, midia, changes, entidades de referencia). */
  readonly catalogEndpoints: TmdbCatalogEndpoints
  readonly cacheTtlMs: number
  readonly staleWindowMs?: number
  /**
   * Territorios ingeridos para disponibilidade ("onde assistir").
   * Omitido => `DEFAULT_WATCH_TERRITORIES` (hoje `['BR']`, o unico que o render
   * le). Ampliar exige que os codigos existam em `countries` — ver
   * `src/watch-providers/territories.ts`.
   */
  readonly watchTerritories?: readonly string[]
  /**
   * Frescor da oferta de disponibilidade. Omitido => 1 dia, a periodicidade-alvo
   * de "onde assistir" em `.claude/rules/ingestion.md` (dado volatil, janela
   * curta) — deliberadamente MENOR que `staleWindowMs`, que e do detalhe.
   */
  readonly watchStaleWindowMs?: number
  readonly now?: () => Date
  /** Baixa um texto por URL (Daily ID Exports). Injetado: o core nao faz rede. */
  readonly fetchText?: (url: string) => Promise<string>
  readonly metrics?: MetricsSink
}

/** Servicos montados, prontos para o registry e para a CLI. */
export interface CatalogServices extends CatalogHandlerDependencies {
  readonly prisma: PrismaClient
  readonly searchStore: SearchStorePort
  readonly searchSource: SearchProjectionSourcePort
  readonly now: () => Date
}

/** Monta os adapters de servico do catalogo. */
export function createCatalogServices(options: CatalogServicesOptions): CatalogServices {
  const {
    tmdb,
    catalogEndpoints,
    staleWindowMs = 7 * 24 * 60 * 60 * 1000,
    watchTerritories = DEFAULT_WATCH_TERRITORIES,
    watchStaleWindowMs = 24 * 60 * 60 * 1000,
    now = () => new Date(),
  } = options
  const metrics = options.metrics ?? createNoopMetricsSink()
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
    staleAfter: (at: Date) => new Date(at.getTime() + staleWindowMs),
    /**
     * Disponibilidade a partir do payload de detalhe que o import JA tem.
     *
     * Reusa, sem uma linha nova de SQL, as duas pecas que ja rodam em producao
     * pelo caminho do bruto: o escritor (que nasce `display_allowed=false`,
     * invariante 6, e hidrata credito pela licenca vigente) e o resolvedor
     * tmdbId -> id interno (necessario no short-circuit de cache).
     */
    watch: {
      store: createPrismaTmdbWatchOfferStore(prisma),
      resolver: createPrismaWatchEntityResolver(prisma),
      territories: watchTerritories,
      staleAfterMs: watchStaleWindowMs,
    },
  }

  /**
   * Desfecho de disponibilidade das entidades de REFERENCIA
   * (collection/company/network/keyword): nenhuma delas tem "onde assistir" —
   * os quatro endpoints sequer aceitam `append_to_response`. `not-applicable`
   * mantem a distincao entre "nao se aplica" e "nao tem oferta".
   */
  const REFERENCE_WATCH = emptyDetailWatchReport('not-applicable')

  /** Detalhe de uma entidade de referencia (collection/company/network/keyword). */
  async function syncReferenceDetail(
    kind: SyncDetailKind,
    tmdbId: number,
    locale: string,
  ): Promise<DetailSyncOutcome> {
    if (kind === 'collection') {
      const payload = await catalogEndpoints.getCollection(tmdbId, locale)
      const row = normalizeCollectionDetail(payload)
      if (row === null) throw new PermanentJobError('invalid_upstream', `collection ${tmdbId} sem id/nome`)
      const parts = normalizeCollectionParts(payload)
      // `upsertCollectionWithParts` devolve quantos filmes membros JA promovidos
      // foram vinculados. Nao cabe em DetailSyncOutcome (que descreve a entidade,
      // nao os vinculos) — fica no log, onde e util para diagnostico.
      await entitiesStore.upsertCollectionWithParts(row, parts)
      return {
        created: true,
        updated: false,
        unchanged: false,
        entityId: null,
        skipped: false,
        skipReason: null,
        watchOutcome: REFERENCE_WATCH.outcome,
        watchOffers: REFERENCE_WATCH.offersUpserted,
      }
    }
    if (kind === 'company') {
      const row = normalizeCompanyDetail(await catalogEndpoints.getCompany(tmdbId))
      if (row === null) throw new PermanentJobError('invalid_upstream', `company ${tmdbId} sem id/nome`)
      await entitiesStore.upsertCompany(row)
      return {
        created: true,
        updated: false,
        unchanged: false,
        entityId: null,
        skipped: false,
        skipReason: null,
        watchOutcome: REFERENCE_WATCH.outcome,
        watchOffers: REFERENCE_WATCH.offersUpserted,
      }
    }
    if (kind === 'network') {
      const row = normalizeNetworkDetail(await catalogEndpoints.getNetwork(tmdbId))
      if (row === null) throw new PermanentJobError('invalid_upstream', `network ${tmdbId} sem id/nome`)
      await entitiesStore.upsertNetwork(row)
      return {
        created: true,
        updated: false,
        unchanged: false,
        entityId: null,
        skipped: false,
        skipReason: null,
        watchOutcome: REFERENCE_WATCH.outcome,
        watchOffers: REFERENCE_WATCH.offersUpserted,
      }
    }
    const row = normalizeKeywordDetail(await catalogEndpoints.getKeyword(tmdbId))
    if (row === null) throw new PermanentJobError('invalid_upstream', `keyword ${tmdbId} sem id/nome`)
    await entitiesStore.upsertKeyword(row)
    return {
        created: true,
        updated: false,
        unchanged: false,
        entityId: null,
        skipped: false,
        skipReason: null,
        watchOutcome: REFERENCE_WATCH.outcome,
        watchOffers: REFERENCE_WATCH.offersUpserted,
      }
  }

  /** Vincula referencias (colecao/produtoras/redes/keywords/aliases) de movie|tv. */
  async function syncEntityReferences(kind: ReferenceOwnerType, tmdbId: number, detail: unknown) {
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

  /**
   * FINALIZACAO editorial do detalhe: slug canonico pt-BR (+301 na troca) e
   * traducao. E o passo que transforma uma ficha tipada em ENTIDADE PUBLICAVEL.
   *
   * Por que aqui: a promocao de `tmdb_raw` ja finalizava (via
   * `createPrismaCatalogFinalize`), mas o import DIRETO de detalhe — o caminho
   * que a fila duravel usa no job `sync_details` — parava no upsert tipado. O
   * resultado era um bootstrap que enchia `movies`/`tv_shows`/`people` e nao
   * gerava nenhuma URL publica: sem slug nao ha rota, nao ha entrada de busca
   * (o backfill pagina por slug) e nao ha linha de sitemap.
   *
   * Idempotente: `upsertCanonicalSlug` faz no-op quando o canonico ja e o
   * desejado, e `upsertTranslation` e upsert por (entidade, idioma). Reexecutar
   * o mesmo `sync_details` nao duplica slug nem gera 301 espurio.
   *
   * So finaliza quando houve upsert (`entityId !== null`): no short-circuit de
   * cache (`changed === false`) nao ha id, e o slug daquela entidade ja existe
   * da execucao que a criou.
   */
  /**
   * Cache de idiomas REGISTRADOS em `languages`.
   *
   * `slugs.language_code` e `entity_translations.language_code` tem FK para
   * `languages`, e a tabela so tem os idiomas do seed (hoje pt-BR, en, es). O
   * `--locale` do TMDB, porem, e um BCP-47 completo: `en-US`, `es-ES`, `fr-FR`.
   *
   * Sem esta checagem, `catalog sync --locale en-US` passaria a estourar FK
   * violation e derrubar o job inteiro — um comando que ANTES desta mudanca
   * funcionava (so nao criava slug). Manter o comportamento antigo para idioma
   * desconhecido (nao finaliza) e o unico caminho que nao regride.
   */
  const knownLanguages = new Map<string, boolean>()

  async function isRegisteredLanguage(code: string): Promise<boolean> {
    const cached = knownLanguages.get(code)
    if (cached !== undefined) return cached
    const row = await prisma.language.findUnique({ where: { code }, select: { code: true } })
    const exists = row !== null
    knownLanguages.set(code, exists)
    return exists
  }

  async function finalizeDetail(
    entityType: 'movie' | 'tv' | 'person',
    entityId: string | null,
    display: CatalogDisplayFields | undefined,
    tmdbId: number,
    locale: string,
  ): Promise<void> {
    if (entityId === null || display === undefined) return
    // Titulo vazio => slug vazio => URL invalida. Melhor NAO criar slug do que
    // criar um quebrado: a entidade fica sem rota publica ate ter titulo, em vez
    // de virar uma URL que o sitemap publica e o render nao resolve.
    if (display.title.trim() === '') return
    // Idioma nao registrado: nao finaliza (ver `isRegisteredLanguage`). O
    // detalhe continua sincronizado; so nao ganha slug/traducao naquele idioma.
    if (!(await isRegisteredLanguage(locale))) return
    const finalize = createPrismaCatalogFinalize(prisma, locale)
    const desiredSlug = desiredCatalogSlug(display.title, tmdbId)
    await finalize.upsertCanonicalSlug(entityType, entityId, desiredSlug, tmdbId)
    await finalize.upsertTranslation(entityType, entityId, display.title, display.overview)
  }

  const detailSync: CatalogDetailSyncPort = {
    async syncDetail({ kind, tmdbId, locale }) {
      if (kind === 'movie') {
        const result = assertImportOk(await importMovie(importContext, tmdbId), `importMovie(${tmdbId})`)
        await finalizeDetail('movie', result.id, result.display, tmdbId, locale)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
          watchOutcome: result.watch.outcome,
          watchOffers: result.watch.offersUpserted,
        }
      }
      if (kind === 'tv') {
        const result = assertImportOk(await importTvShow(importContext, tmdbId), `importTvShow(${tmdbId})`)
        await finalizeDetail('tv', result.id, result.display, tmdbId, locale)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
          watchOutcome: result.watch.outcome,
          watchOffers: result.watch.offersUpserted,
        }
      }
      if (kind === 'person') {
        const result = assertImportOk(await importPerson(importContext, tmdbId), `importPerson(${tmdbId})`)
        await finalizeDetail('person', result.id, result.display, tmdbId, locale)
        return {
          created: result.created,
          updated: result.changed && !result.created,
          unchanged: !result.changed,
          entityId: result.id,
          skipped: false,
          skipReason: null,
          watchOutcome: result.watch.outcome,
          watchOffers: result.watch.offersUpserted,
        }
      }
      return syncReferenceDetail(kind, tmdbId, locale)
    },
  }

  const creditsSync: CatalogCreditsSyncPort = {
    async syncCredits({ kind, tmdbId, seasonNumber, episodeNumber }) {
      if (kind === 'episode') {
        // O validador ja garante os dois para `episode`, mas o TIPO da porta os
        // declara nulaveis. Sem esta guarda, um chamador direto (teste, script)
        // faria `getTvSeason(id, null)` -> URL errada. A guarda transforma a
        // garantia do validador em prova, em vez de convencao.
        const season = requireNumber(seasonNumber, 'seasonNumber', kind)
        const episodeNo = requireNumber(episodeNumber, 'episodeNumber', kind)
        const payload = await tmdb.getTvSeason(tmdbId, season)
        const episode = findEpisode(payload, episodeNo)
        if (episode === null) {
          return { cast: 0, crew: 0, guestStars: 0, skipped: true, skipReason: 'episodio ausente no payload' }
        }
        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tmdbId,
          seasonNumber: season,
          episodeNumber: episodeNo,
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
          castPresent: normalized.castPresent,
          crewPresent: normalized.crewPresent,
          recommendations: normalized.recommendations,
          recommendationsPresent: normalized.recommendationsPresent,
          genres: normalized.genres,
          genresPresent: normalized.genresPresent,
          countries: normalized.countries,
          countriesPresent: normalized.countriesPresent,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        await syncEntityReferences('movie', tmdbId, detail)
        return creditsSyncOutcome(outcome.credits)
      }
      if (kind === 'tv') {
        const detail = await tmdb.getTvShow(tmdbId)
        const normalized = normalizeTvShow(detail)
        const outcome = await persistence.store.upsertTvShow({
          tvShow: normalized.tvShow,
          externalIds: normalized.externalIds,
          cast: normalized.cast,
          crew: normalized.crew,
          castPresent: normalized.castPresent,
          crewPresent: normalized.crewPresent,
          recommendations: normalized.recommendations,
          recommendationsPresent: normalized.recommendationsPresent,
          genres: normalized.genres,
          genresPresent: normalized.genresPresent,
          countries: normalized.countries,
          countriesPresent: normalized.countriesPresent,
          timestamps: { lastSyncedAt: now(), staleAfter: new Date(now().getTime() + staleWindowMs) },
        })
        await syncEntityReferences('tv', tmdbId, detail)
        return creditsSyncOutcome(outcome.credits)
      }
      // `season`: os creditos de temporada nao tem tabela propria; o nivel util
      // e o episodio. Reportar skip explicito e melhor que fingir sucesso.
      return { cast: 0, crew: 0, guestStars: 0, skipped: true, skipReason: 'creditos de temporada nao persistidos' }
    },
  }

  const externalIdsSync: CatalogExternalIdsSyncPort = {
    async syncExternalIds({ kind, tmdbId, seasonNumber, episodeNumber }) {
      if (kind === 'episode') {
        const season = requireNumber(seasonNumber, 'seasonNumber', kind)
        const episodeNo = requireNumber(episodeNumber, 'episodeNumber', kind)
        const payload = await tmdb.getTvSeason(tmdbId, season)
        const episode = findEpisode(payload, episodeNo)
        if (episode === null) {
          return { upserted: 0, changed: 0, skipped: true, skipReason: 'episodio ausente no payload' }
        }
        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tmdbId,
          seasonNumber: season,
          episodeNumber: episodeNo,
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
          // Este job existe para external_ids. Se o detalhe vier sem o bloco
          // `credits`, os flags nascem `false` e o elenco fica intocado — um
          // sync de IDs nunca pode ter efeito colateral sobre creditos.
          castPresent: normalized.castPresent,
          crewPresent: normalized.crewPresent,
          recommendations: normalized.recommendations,
          recommendationsPresent: normalized.recommendationsPresent,
          genres: normalized.genres,
          genresPresent: normalized.genresPresent,
          countries: normalized.countries,
          countriesPresent: normalized.countriesPresent,
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
          // Ver o ramo de filme: sync de IDs nao mexe em creditos.
          castPresent: normalized.castPresent,
          crewPresent: normalized.crewPresent,
          recommendations: normalized.recommendations,
          recommendationsPresent: normalized.recommendationsPresent,
          genres: normalized.genres,
          genresPresent: normalized.genresPresent,
          countries: normalized.countries,
          countriesPresent: normalized.countriesPresent,
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

  /**
   * Resolve o id TMDB PROPRIO da temporada/episodio a partir da chave natural.
   *
   * O job carrega o id da SERIE (e assim que o TMDB endereca a URL); a chave de
   * `tmdb_images`/`tmdb_videos` precisa do id da entidade dona. Os dois vivem no
   * banco desde a Fase 2 (`seasons.tmdb_id`, `episodes.tmdb_id`) — o que faltava
   * era alguem perguntar.
   *
   * Devolve `null` quando a linha nao existe ou nao tem id: quem chama RECUSA o
   * job (ver `buildMediaTarget`), nunca cai para o id da serie.
   */
  async function resolveOwnMediaTmdbId(
    kind: string,
    seriesTmdbId: number,
    seasonNumber: number | null,
    episodeNumber: number | null,
  ): Promise<number | null> {
    if (kind !== 'season' && kind !== 'episode') return null
    if (seasonNumber === null) return null

    const season = await prisma.season.findFirst({
      where: { seasonNumber, tvShow: { tmdbId: seriesTmdbId } },
      select: { id: true, tmdbId: true },
    })
    if (season === null) return null
    if (kind === 'season') return season.tmdbId

    if (episodeNumber === null) return null
    const episode = await prisma.episode.findFirst({
      where: { seasonId: season.id, episodeNumber },
      select: { tmdbId: true },
    })
    return episode?.tmdbId ?? null
  }

  const mediaSync: CatalogMediaSyncPort = {
    async syncMedia({ kind, tmdbId, seasonNumber, episodeNumber }) {
      const ownTmdbId = await resolveOwnMediaTmdbId(kind, tmdbId, seasonNumber, episodeNumber)
      const target = buildMediaTarget(catalogEndpoints, kind, tmdbId, {
        seasonNumber,
        episodeNumber,
        ownTmdbId,
      })
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

  const seasonsSync: CatalogSeasonsSyncPort = {
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

  /**
   * Sync das referencias dos episodios de UMA temporada.
   *
   * ============================================================================
   * POR QUE ISTO BUSCA O DETALHE DE CADA EPISODIO
   * ============================================================================
   * Ate 2026-08-27 esta funcao lia UM payload — `/tv/{id}/season/{n}` — e
   * passava cada item de `episodes[]` para os cinco extratores de
   * `episodes/normalize.ts`. Parecia economia de requisicao. Era descarte:
   *
   *   - `extractEpisodeCast` le `credits.cast` — o item da temporada nao tem
   *     bloco `credits`. Sempre `[]`.
   *   - `extractEpisodeExternalIds` le `external_ids` — ausente. Sempre `[]`.
   *   - `extractEpisodeStills` le `images.stills` — ausente (o item traz um
   *     unico `still_path`, que e outra coisa). Sempre `[]`.
   *   - `extractEpisodeCrew` lia `credits.crew` enquanto o TMDB mandava `crew`
   *     no TOPO: o dado CHEGAVA e era descartado na leitura.
   *
   * Quatro dos cinco contadores eram zero por construcao, e o job reportava
   * `success`. A pagina de episodio ficou sem elenco convidado, sem direcao e
   * sem roteiro — nao por falta de dado nem de licenca, por falta desta
   * chamada.
   *
   * CUSTO: a temporada continua sendo buscada uma vez (e dela sai a lista de
   * numeros de episodio, que e a chave natural), e agora ha UMA requisicao por
   * episodio. Para uma temporada de 12 episodios: 13 requisicoes, contra 1
   * antes. Os cinco appends do episodio cabem num unico pedido (teto de 20
   * sub-requests), entao nao ha multiplicacao alem dessa.
   *
   * Um episodio cujo detalhe FALHA nao derruba a temporada: e contado em
   * `failedDetail` e o lote segue. Falhar 12 episodios porque o 7o deu 404
   * transformaria um buraco upstream num incidente de fila.
   */
  const episodesSync: CatalogEpisodesSyncPort = {
    async syncEpisodes({ tvTmdbId, seasonNumber, signal }) {
      const payload = await tmdb.getTvSeason(tvTmdbId, seasonNumber)
      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : []
      let cast = 0
      let guestStars = 0
      let crew = 0
      let externalIds = 0
      let stills = 0
      let processed = 0
      let skippedNoTmdbId = 0
      let failedDetail = 0
      const episodeNumbers: number[] = []

      for (const episode of episodes) {
        if (signal.aborted) break
        const number = episode?.episode_number
        if (typeof number !== 'number' || !Number.isInteger(number)) {
          // Sem numero nao existe chave natural: pular e contar, nunca inventar.
          skippedNoTmdbId += 1
          continue
        }

        // O DETALHE, nao o resumo. Ver o cabecalho: e a diferenca entre a
        // pagina ter elenco/direcao/roteiro e nao ter.
        let detail: unknown
        try {
          detail = await tmdb.getTvEpisode(tvTmdbId, seasonNumber, number)
        } catch {
          // O resumo da temporada AINDA serve para guest stars e equipe (os
          // dois vem no topo). Degradar para ele e melhor que perder o
          // episodio inteiro — e a contagem em `failedDetail` diz quantos
          // ficaram sem elenco regular, ids externos e stills.
          failedDetail += 1
          detail = episode
        }

        const outcome = await episodeStore.syncEpisodeReferences({
          tvShowTmdbId: tvTmdbId,
          seasonNumber,
          episodeNumber: number,
          cast: extractEpisodeCast(detail),
          guestStars: extractEpisodeGuestStars(detail),
          crew: extractEpisodeCrew(detail),
          externalIds: extractEpisodeExternalIds(detail),
          stills: extractEpisodeStills(detail),
        })
        cast += outcome.cast
        guestStars += outcome.guestStars
        crew += outcome.crew
        externalIds += outcome.externalIds
        stills += outcome.stills
        processed += 1
        episodeNumbers.push(number)
      }

      return {
        episodes: processed,
        cast,
        guestStars,
        crew,
        externalIds,
        stills,
        skippedNoTmdbId,
        failedDetail,
        episodeNumbers,
        skipped: false,
        skipReason: null,
      }
    },
  }

  const listFetch: DiscoveryListFetchPort = {
    async fetchPage({ listType, entityType, locale, country, window, page }) {
      return fetchDiscoveryPage(catalogEndpoints, tmdb, {
        listType,
        entityType,
        locale,
        country,
        window,
        page,
      })
    },
  }

  const discovery: CatalogDiscoverIdsPort = {
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
      return discoverFromLists(catalogEndpoints, tmdb, {
        strategy,
        kind,
        locale,
        country,
        limit,
        maxPages: maxPages ?? 5,
      })
    },
  }

  const reprocessRaw: CatalogReprocessRawPort = {
    async reprocess({ kind, tmdbId, baseLanguage, limit, dryRun }) {
      // `promote*FromRaw` nao aceita filtro por id — so (baseLanguage, limit).
      // Aceitar `tmdbId` e ignora-lo faria o job reprocessar 100 linhas
      // arbitrarias enquanto reporta sucesso para o id pedido. Recusar e honesto.
      if (tmdbId !== null) {
        throw new PermanentJobError(
          'unsupported_filter',
          'reprocess_raw ainda nao filtra por tmdbId: a promocao opera por lote (baseLanguage + limit). Omita "tmdbId".',
        )
      }
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

      // `PromoteCounts` e {created, updated, failed} — NAO tem `skipped`. Ler
      // `counts.skipped` devolvia undefined -> 0 sempre; e `scanned` embutia um
      // termo que nunca existiu. O core de promocao nao tem desfecho "pulado":
      // cada linha vira created | updated | failed.
      const counts = report.counts
      const created = counts.created
      const updated = counts.updated
      const failed = counts.failed
      return {
        scanned: created + updated + failed,
        promoted: created + updated,
        unchanged: 0,
        skipped: 0,
        failed,
        dryRun,
      }
    },
  }

  const search: SearchReindexPort = {
    async reindexEntity(entityType, entityId, locale) {
      // `metrics` e OBRIGATORIO em SearchReindexDeps. `reindexEntity` nao o usa
      // hoje, mas `reindexAll` chama `metrics.gauge` — passar sempre evita que a
      // omissao vire crash quando o outro caminho o consumir.
      await reindexEntity({ source: searchSource, store: searchStore, metrics }, entityType, entityId, locale)
    },
  }

  const changes: CatalogServices['changes'] = {
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
    now,
  }
}

/** Le uma propriedade de um valor desconhecido sem assumir a forma. */
function readProp(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as Record<string, unknown>)[key]
}

/**
 * Acha um episodio pelo numero dentro do payload de temporada.
 *
 * Defensivo: o payload vem do provider e nao tem forma garantida.
 */
function findEpisode(seasonPayload: unknown, episodeNumber: number): Record<string, unknown> | null {
  const raw = readProp(seasonPayload, 'episodes')
  const episodes: unknown[] = Array.isArray(raw) ? raw : []
  for (const entry of episodes) {
    if (readProp(entry, 'episode_number') === episodeNumber) {
      return entry as Record<string, unknown>
    }
  }
  return null
}

/**
 * Monta o alvo de midia com os fetchers certos por tipo.
 *
 * ============================================================================
 * A RECUSA DE TEMPORADA/EPISODIO CAIU EM 2026-08-27 — E ELA TINHA METADE RAZAO
 * ============================================================================
 * O texto anterior recusava os dois assim: "`MediaTarget` so carrega
 * (entityType, tmdbId), e para temporada o tmdbId e o da SERIE. Logo a chave de
 * cache viraria `/season/1399/images` para TODAS as temporadas".
 *
 * A colisao era real — com UM id para dois papeis. O conserto nao era recusar,
 * era separar os papeis: `ownTmdbId` (a CHAVE, vinda de `seasons.tmdb_id` /
 * `episodes.tmdb_id`) e `endpointBase` (a URL, que precisa da serie + numero).
 * Sao dois numeros diferentes porque sao duas perguntas diferentes.
 *
 * A outra metade da recusa — "nada se perde: os stills de episodio ja entram
 * por `sync_episodes`" — era falsa. `extractEpisodeStills` lia `images.stills`
 * de um objeto que nunca teve esse bloco e devolvia [] em toda execucao. O
 * comentario descrevia um caminho que nao existia, e foi ele que manteve a
 * ausencia parecendo intencional por meses.
 *
 * FAIL-CLOSED: sem id proprio no banco, RECUSA. Gravar a midia da temporada sob
 * o id da serie e exatamente a corrupcao que a recusa antiga temia — e ela
 * continua sendo pior que recusar.
 */
function buildMediaTarget(
  endpoints: TmdbCatalogEndpoints,
  kind: string,
  tmdbId: number,
  input: { seasonNumber: number | null; episodeNumber: number | null; ownTmdbId: number | null },
): MediaTarget {
  if (kind === 'movie') {
    return {
      entityType: 'movie',
      tmdbId,
      endpointBase: `/movie/${String(tmdbId)}`,
      fetchImages: () => endpoints.getMovieImages(tmdbId),
      fetchVideos: () => endpoints.getMovieVideos(tmdbId),
    }
  }
  if (kind === 'tv') {
    return {
      entityType: 'tv',
      tmdbId,
      endpointBase: `/tv/${String(tmdbId)}`,
      fetchImages: () => endpoints.getTvImages(tmdbId),
      fetchVideos: () => endpoints.getTvVideos(tmdbId),
    }
  }
  if (kind === 'person') {
    // Pessoa nao tem endpoint de videos: `fetchVideos` ausente por contrato.
    return {
      entityType: 'person',
      tmdbId,
      endpointBase: `/person/${String(tmdbId)}`,
      fetchImages: () => endpoints.getPersonImages(tmdbId),
    }
  }

  if (kind === 'season' || kind === 'episode') {
    const seasonNumber = requireNumber(input.seasonNumber, 'seasonNumber', `sync_media de ${kind}`)
    if (input.ownTmdbId === null) {
      // Sem id proprio nao ha chave. Recusar e o unico desfecho honesto: o id
      // da serie rotularia a midia de TODAS as temporadas igual.
      throw new PermanentJobError(
        'missing_own_tmdb_id',
        `sync_media de ${kind}: a ${kind === 'season' ? 'temporada' : 'episodio'} nao tem tmdb_id proprio no banco (serie ${String(tmdbId)}, temporada ${String(seasonNumber)}). Rode sync_seasons/sync_episodes antes: sem id proprio a midia seria gravada sob o id da serie e as linhas ficariam indistinguiveis.`,
      )
    }
    const ownTmdbId = input.ownTmdbId

    if (kind === 'season') {
      return {
        entityType: 'season',
        tmdbId: ownTmdbId,
        endpointBase: `/tv/${String(tmdbId)}/season/${String(seasonNumber)}`,
        fetchImages: () => endpoints.getSeasonImages(tmdbId, seasonNumber),
        fetchVideos: () => endpoints.getSeasonVideos(tmdbId, seasonNumber),
      }
    }

    const episodeNumber = requireNumber(input.episodeNumber, 'episodeNumber', 'sync_media de episode')
    return {
      entityType: 'episode',
      tmdbId: ownTmdbId,
      endpointBase: `/tv/${String(tmdbId)}/season/${String(seasonNumber)}/episode/${String(episodeNumber)}`,
      fetchImages: () => endpoints.getEpisodeImages(tmdbId, seasonNumber, episodeNumber),
      fetchVideos: () => endpoints.getEpisodeVideos(tmdbId, seasonNumber, episodeNumber),
    }
  }

  throw new PermanentJobError(
    'unsupported_media_kind',
    `sync_media nao suporta "${kind}": os kinds validos sao movie, tv, person, season e episode.`,
  )
}

/**
 * Busca uma pagina da lista de descoberta pedida.
 *
 * `upcoming` sai do `TmdbReadPort` (`tmdb`), NAO do `TmdbCatalogEndpoints`:
 * `getUpcomingMovies` so existe em endpoints.ts. Chamar `catalogEndpoints
 * .getUpcomingMovies` lancava TypeError e mandava todo sync_lists de "upcoming"
 * para dead-letter. Um erro assim NAO passa mais em silencio: este arquivo entra
 * em `tsconfig.runtime.json`, encadeado por `pnpm typecheck`.
 */
async function fetchDiscoveryPage(
  endpoints: TmdbCatalogEndpoints,
  tmdb: TmdbReadPort,
  input: {
    listType: string
    entityType: 'movie' | 'tv' | 'person'
    locale: string
    country: string | null
    window: string | null
    page: number
  },
): Promise<DiscoveryListPage> {
  const { listType, entityType, locale, country, window, page } = input
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
  if (listType === 'upcoming') return tmdb.getUpcomingMovies({ page, language: locale })
  if (listType === 'now_playing') return endpoints.getNowPlayingMovies(params)
  if (listType === 'airing_today') return endpoints.getAiringTodayTvShows(params)
  if (listType === 'on_the_air') return endpoints.getOnTheAirTvShows(params)
  return entityType === 'movie' ? endpoints.discoverMovies(params) : endpoints.discoverTvShows(params)
}

/**
 * Descobre ids a partir das listas do provider.
 *
 * `person` so tem lista em `trending` (o TMDB nao expoe popular/top_rated de
 * pessoa neste client). A versao anterior fazia `kind === 'person' ? 'movie' :
 * kind` — ou seja, devolvia ids de FILME e o handler os enfileirava como
 * `sync_details` de PESSOA. Isso e corrupcao de catalogo: pessoa 603 nao e o
 * filme 603. Agora falha explicitamente.
 */
async function discoverFromLists(
  endpoints: TmdbCatalogEndpoints,
  tmdb: TmdbReadPort,
  input: {
    strategy: string
    kind: 'movie' | 'tv' | 'person'
    locale: string
    country: string | null
    limit: number | null
    maxPages: number
  },
): Promise<DiscoverIdsOutcome> {
  const { strategy, kind, locale, country, limit, maxPages } = input
  if (kind === 'person' && strategy !== 'trending') {
    throw new PermanentJobError(
      'unsupported_discovery',
      `descoberta de pessoa por "${strategy}" nao existe no provider; use strategy=trending ou daily-exports`,
    )
  }
  const entityType = kind
  const ids = []
  let discovered = 0
  let duplicate = 0
  const seen = new Set()

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetchDiscoveryPage(endpoints, tmdb, {
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
 *
 * ORDEM: POPULARIDADE DECRESCENTE, nunca ordem de arquivo.
 * --------------------------------------------------------
 * O export vem em ordem de `id` (aproximadamente cronologica de cadastro), e
 * `--limit N` e um CORTE DE PREFIXO. Cortar o prefixo da ordem de arquivo
 * sincroniza os N ids mais ANTIGOS do TMDB — curta obscuro de 1913 — enquanto os
 * titulos que o publico procura hoje ficam para o fim da fila. Num espelho
 * incremental isso significa dias de ingestao antes de o primeiro nome
 * reconhecivel entrar, e link interno de materia que nao resolve nesse meio
 * tempo.
 *
 * O proprio export ja carrega `popularity` por linha (verificado no export de
 * 2026-08-10: presente em movie/tv/person), entao ordenar NAO custa uma unica
 * chamada de API nem um byte de cota — e so nao jogar fora um campo que ja veio.
 *
 * `buildSyncQueue` e o ordenador canonico e ja era usado pelo caminho NDJSON de
 * `bin/discover-ids.ts`; o pipeline da fila usava outro caminho e por isso nao
 * herdava a ordem. Ele dedupa por `(kind, tmdbId)`, ordena por popularidade
 * desc (nulls por ultimo) com desempate por `tmdbId` asc — ordem TOTAL, entao
 * duas execucoes sobre o mesmo export produzem exatamente a mesma fila — e
 * reaplica `classifyAdult` como rede secundaria.
 */
async function discoverFromDailyExports(
  kind: 'movie' | 'tv' | 'person',
  limit: number | null,
  now: () => Date,
  fetchText: ((url: string) => Promise<string>) | undefined,
): Promise<DiscoverIdsOutcome> {
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

  // Todo o resto (filtro anti-adulto, dedup, ORDEM por popularidade, corte) e
  // puro e vive em `discovery/export-discovery.ts`, onde tem teste proprio.
  return discoverIdsFromExportText({
    text,
    kind,
    hasAdultField: file.hasAdultField,
    limit,
  })
}
