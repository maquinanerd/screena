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
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

const TV_APPEND = 'external_ids,credits'

/** Importa uma serie + temporadas + episodios; devolve um ImportResult. */
export async function importTvShow(ctx: ImportContext, tmdbId: number): Promise<ImportResult> {
  const endpoint = `/tv/${tmdbId}`
  const startedMs = ctx.now().getTime()
  let quotaCost = 0

  try {
    const result = await ctx.cache.getOrFetch({
      endpoint,
      params: { append_to_response: TV_APPEND },
      fetcher: () => ctx.tmdb.getTvShow(tmdbId),
    })
    quotaCost += result.fromCache ? 0 : 1

    const now = ctx.now()
    const timestamps = { lastSyncedAt: now, staleAfter: ctx.staleAfter(now) }
    const normalized = normalizeTvShow(result.data)

    let created = false
    let id: string | null = null
    if (result.changed) {
      const outcome = await ctx.store.upsertTvShow({
        tvShow: normalized.tvShow,
        externalIds: normalized.externalIds,
        cast: normalized.cast,
        crew: normalized.crew,
        timestamps,
      })
      created = outcome.created
      id = outcome.id
    } else {
      await ctx.store.touchTvShow(tmdbId, timestamps)
    }

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
      error: info.message,
    }
  }
}
