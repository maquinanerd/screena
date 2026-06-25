/**
 * import-movie.ts — Orquestra o import de um filme por TMDB id.
 *
 * Fluxo: cache.getOrFetch -> (se changed) normalize + upsert; (senao) touch.
 * Sempre grava em api_sync_logs; nunca relanca (pipeline-safe).
 */

import { normalizeMovie } from '../normalizers/movie.js'
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

const MOVIE_APPEND = 'external_ids,credits'

/** Importa um filme; devolve um ImportResult (status success/failed/aborted). */
export async function importMovie(ctx: ImportContext, tmdbId: number): Promise<ImportResult> {
  const endpoint = `/movie/${tmdbId}`
  const startedMs = ctx.now().getTime()

  try {
    const result = await ctx.cache.getOrFetch({
      endpoint,
      params: { append_to_response: MOVIE_APPEND },
      fetcher: () => ctx.tmdb.getMovie(tmdbId),
    })
    const now = ctx.now()
    const timestamps = { lastSyncedAt: now, staleAfter: ctx.staleAfter(now) }
    const quotaCost = result.fromCache ? 0 : 1

    if (!result.changed) {
      await ctx.store.touchMovie(tmdbId, timestamps)
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
      }
    }

    const normalized = normalizeMovie(result.data)
    const outcome = await ctx.store.upsertMovie({
      movie: normalized.movie,
      externalIds: normalized.externalIds,
      cast: normalized.cast,
      crew: normalized.crew,
      timestamps,
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
      error: info.message,
    }
  }
}
