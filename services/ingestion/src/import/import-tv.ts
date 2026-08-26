/**
 * import-tv.ts — Orquestra o import de uma serie (com temporadas e episodios).
 *
 * Sempre normaliza a serie (puro) para obter `seasonNumbers`; faz upsert da
 * serie quando mudou (senao touch); itera as temporadas, cada uma com seu
 * proprio short-circuit de cache. Um unico log por ciclo (endpoint raiz).
 */

import { readTvDisplayFields } from '../display-fields.js'
import { normalizeSeason } from '../normalizers/season.js'
import { normalizeTvShow } from '../normalizers/tv.js'
import {
  emptyDetailWatchReport,
  ingestWatchProvidersFromDetail,
} from '../watch-providers/from-detail.js'
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

/**
 * Rotulo de `params` da CHAVE de `api_cache` — NAO e o `append_to_response` da
 * requisicao. Ver a nota equivalente em `import-movie.ts`: quem decide o append
 * de verdade e `getTvShow`, com o `TV_APPEND` RICO de
 * `api-clients/tmdb/src/append-to-response.ts` (16 sub-recursos, entre eles
 * `watch/providers`).
 */
const TV_CACHE_KEY_APPEND = 'external_ids,credits'

/** Importa uma serie + temporadas + episodios; devolve um ImportResult. */
export async function importTvShow(ctx: ImportContext, tmdbId: number): Promise<ImportResult> {
  const endpoint = `/tv/${tmdbId}`
  const startedMs = ctx.now().getTime()
  let quotaCost = 0
  // Declarado FORA do try: a serie pode ter ganho ofertas e so depois uma
  // temporada estourar. Se o desfecho vivesse dentro do try, o catch reportaria
  // `unrecognized` sobre ofertas que ja estao gravadas — uma mentira no sentido
  // oposto ao que este campo existe para impedir.
  let watch = emptyDetailWatchReport('unrecognized')

  try {
    const result = await ctx.cache.getOrFetch({
      endpoint,
      params: { append_to_response: TV_CACHE_KEY_APPEND },
      fetcher: () => ctx.tmdb.getTvShow(tmdbId),
    })
    quotaCost += result.fromCache ? 0 : 1

    const now = ctx.now()
    const timestamps = { lastSyncedAt: now, staleAfter: ctx.staleAfter(now) }
    const normalized = normalizeTvShow(result.data)

    let created = false
    let id: string | null = null
    // Ver o cabecalho do mesmo ramo em `import-movie.ts`: "payload inalterado"
    // NAO significa "entidade existe". Com o cache quente de uma tentativa que
    // falhou DEPOIS da escrita em `api_cache`, este ramo tocava zero linhas e
    // reportava sucesso para uma entidade ausente — para sempre, porque o hash
    // nunca mais muda. O booleano de `touch*` agora DECIDE.
    const tocou = result.changed ? false : await ctx.store.touchTvShow(tmdbId, timestamps)
    if (result.changed || !tocou) {
      const outcome = await ctx.store.upsertTvShow({
        tvShow: normalized.tvShow,
        externalIds: normalized.externalIds,
        cast: normalized.cast,
        crew: normalized.crew,
        castPresent: normalized.castPresent,
        crewPresent: normalized.crewPresent,
        recommendations: normalized.recommendations,
        recommendationsPresent: normalized.recommendationsPresent,
        genres: normalized.genres,
      countries: normalized.countries,
      countriesPresent: normalized.countriesPresent,
        genresPresent: normalized.genresPresent,
        timestamps,
      })
      created = outcome.created
      id = outcome.id
    }

    // Disponibilidade a partir do MESMO payload que ja esta em maos: zero
    // chamada nova ao TMDB, zero cota. Roda TAMBEM no short-circuit de cache
    // (`id === null`, resolvido pelo tmdbId no sink) — sem isso, re-sincronizar
    // uma serie cujo payload nao mudou devolveria `ok` sem gravar uma oferta.
    // Toda linha nasce `display_allowed=false` (invariante 6).
    watch = await ingestWatchProvidersFromDetail({
      entityType: 'tv',
      tmdbId,
      entityId: id,
      payload: result.data,
      sink: ctx.watch,
      now: ctx.now,
    })

    let seasonsUpserted = 0
    let episodesUpserted = 0
    for (const seasonNumber of normalized.seasonNumbers) {
      const seasonEndpoint = `/tv/${tmdbId}/season/${seasonNumber}`
      const seasonResult = await ctx.cache.getOrFetch({
        endpoint: seasonEndpoint,
        fetcher: () => ctx.tmdb.getTvSeason(tmdbId, seasonNumber),
      })
      quotaCost += seasonResult.fromCache ? 0 : 1
      const seasonNow = ctx.now()

      if (seasonResult.changed) {
        const normalizedSeason = normalizeSeason(seasonResult.data)
        const seasonOutcome = await ctx.store.upsertSeasonWithEpisodes({
          tvShowTmdbId: tmdbId,
          season: normalizedSeason.season,
          episodes: normalizedSeason.episodes,
          lastSyncedAt: seasonNow,
        })
        seasonsUpserted += 1
        episodesUpserted += seasonOutcome.episodesUpserted
      } else {
        await ctx.store.touchSeason(tmdbId, seasonNumber, seasonNow)
      }
    }

    await ctx.syncLog.write({
      endpoint,
      status: 'success',
      itemsProcessed: 1 + normalized.seasonNumbers.length,
      itemsCreated: result.changed && created ? 1 : 0,
      itemsUpdated: result.changed && !created ? 1 : 0,
      durationMs: ctx.now().getTime() - startedMs,
      quotaCost,
      payloadHash: result.payloadHash,
    })
    return {
      entityType: 'tv',
      tmdbId,
      status: 'success',
      changed: result.changed,
      created,
      id,
      quotaCost,
      seasons: seasonsUpserted,
      episodes: episodesUpserted,
      display: readTvDisplayFields(result.data),
      watch,
    }
  } catch (error) {
    const info = describeError(error)
    const status = info.aborted ? 'aborted' : 'failed'
    await ctx.syncLog.write({
      endpoint,
      status,
      errorCode: info.code,
      durationMs: ctx.now().getTime() - startedMs,
      quotaCost,
    })
    return {
      entityType: 'tv',
      tmdbId,
      status,
      changed: false,
      created: false,
      id: null,
      quotaCost,
      // O desfecho REAL da disponibilidade, nao um placeholder: se o detalhe
      // nem chegou ele ainda e `unrecognized`; se as ofertas foram gravadas e a
      // falha veio de uma temporada, o `applied` sobrevive ao catch.
      watch,
      error: info.message,
      // Codigo e status viajam junto com a mensagem: quem embrulha este
      // resultado em excecao nao tem outro jeito de saber o que falhou.
      errorCode: info.code,
      ...(info.status === null ? {} : { errorStatus: info.status }),
    }
  }
}
