/**
 * import-movie.ts — Orquestra o import de um filme por TMDB id.
 *
 * Fluxo: cache.getOrFetch -> (se changed) normalize + upsert; (senao) touch.
 * Sempre grava em api_sync_logs; nunca relanca (pipeline-safe).
 */

import { readMovieDisplayFields } from '../display-fields.js'
import { normalizeMovie } from '../normalizers/movie.js'
import {
  emptyDetailWatchReport,
  ingestWatchProvidersFromDetail,
} from '../watch-providers/from-detail.js'
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

/**
 * Rotulo de `params` da CHAVE de `api_cache` — NAO e o `append_to_response` da
 * requisicao.
 *
 * `buildCacheKey` (`src/utils/cache-key.ts`) usa `params` so para montar
 * `requestKey`/`paramsHash`; o `fetcher` e chamado SEM argumentos. Quem decide o
 * append de verdade e `getMovie`, que usa o `MOVIE_APPEND` RICO de
 * `api-clients/tmdb/src/append-to-response.ts` — 13 sub-recursos, entre eles
 * `watch/providers`, `images`, `videos` e `release_dates`.
 *
 * Consequencia pratica, e o motivo deste comentario existir: "acrescentar
 * `watch/providers` aqui" NAO faz o TMDB devolver nada de novo (ja devolve) e
 * ainda invalidaria toda linha de `api_cache` — um refetch do catalogo inteiro
 * em troca de zero oferta.
 */
const MOVIE_CACHE_KEY_APPEND = 'external_ids,credits'

/** Importa um filme; devolve um ImportResult (status success/failed/aborted). */
export async function importMovie(ctx: ImportContext, tmdbId: number): Promise<ImportResult> {
  const endpoint = `/movie/${tmdbId}`
  const startedMs = ctx.now().getTime()

  try {
    const result = await ctx.cache.getOrFetch({
      endpoint,
      params: { append_to_response: MOVIE_CACHE_KEY_APPEND },
      fetcher: () => ctx.tmdb.getMovie(tmdbId),
    })
    const now = ctx.now()
    const timestamps = { lastSyncedAt: now, staleAfter: ctx.staleAfter(now) }
    const quotaCost = result.fromCache ? 0 : 1

    if (!result.changed) {
      await ctx.store.touchMovie(tmdbId, timestamps)
      // O payload nao mudou, mas a DISPONIBILIDADE dele pode nunca ter sido
      // materializada (entidade promovida do bruto, ou sincronizada antes de
      // existir esta ponte). Ingerir tambem aqui e o que faz uma passada de
      // recuperacao funcionar com o cache quente — pular seria devolver `ok`
      // sem gravar uma unica oferta, exatamente o silencio que se esta curando.
      const watch = await ingestWatchProvidersFromDetail({
        entityType: 'movie',
        tmdbId,
        entityId: null,
        payload: result.data,
        sink: ctx.watch,
        now: ctx.now,
      })
      await ctx.syncLog.write({
        endpoint,
        status: 'success',
        itemsProcessed: 1,
        durationMs: ctx.now().getTime() - startedMs,
        quotaCost,
        payloadHash: result.payloadHash,
      })
      return {
        entityType: 'movie',
        tmdbId,
        status: 'success',
        changed: false,
        created: false,
        id: null,
        quotaCost,
        watch,
      }
    }

    const normalized = normalizeMovie(result.data)
    const outcome = await ctx.store.upsertMovie({
      movie: normalized.movie,
      externalIds: normalized.externalIds,
      cast: normalized.cast,
      crew: normalized.crew,
      castPresent: normalized.castPresent,
      crewPresent: normalized.crewPresent,
      recommendations: normalized.recommendations,
      recommendationsPresent: normalized.recommendationsPresent,
      timestamps,
    })
    // Disponibilidade a partir do MESMO payload que ja esta em maos: zero
    // chamada nova ao TMDB, zero cota. Toda linha nasce `display_allowed=false`
    // (invariante 6) — quem grava e o `WatchOfferStore` do reprocessamento.
    const watch = await ingestWatchProvidersFromDetail({
      entityType: 'movie',
      tmdbId,
      entityId: outcome.id,
      payload: result.data,
      sink: ctx.watch,
      now: ctx.now,
    })
    await ctx.syncLog.write({
      endpoint,
      status: 'success',
      itemsProcessed: 1,
      itemsCreated: outcome.created ? 1 : 0,
      itemsUpdated: outcome.created ? 0 : 1,
      durationMs: ctx.now().getTime() - startedMs,
      quotaCost,
      payloadHash: result.payloadHash,
    })
    return {
      entityType: 'movie',
      tmdbId,
      status: 'success',
      changed: true,
      created: outcome.created,
      id: outcome.id,
      quotaCost,
      display: readMovieDisplayFields(result.data),
      watch,
    }
  } catch (error) {
    const info = describeError(error)
    const status = info.aborted ? 'aborted' : 'failed'
    await ctx.syncLog.write({
      endpoint,
      status,
      errorCode: info.code,
      itemsProcessed: 1,
      durationMs: ctx.now().getTime() - startedMs,
    })
    return {
      entityType: 'movie',
      tmdbId,
      status,
      changed: false,
      created: false,
      id: null,
      quotaCost: 0,
      // O detalhe nem chegou: nao ha payload de onde reconhecer oferta. O
      // desfecho declarado impede que a falha do detalhe seja lida como
      // "este titulo nao tem onde assistir".
      watch: emptyDetailWatchReport('unrecognized'),
      error: info.message,
    }
  }
}
