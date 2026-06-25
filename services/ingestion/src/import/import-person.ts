/**
 * import-person.ts — Orquestra o import de uma pessoa por TMDB id.
 */

import { normalizePerson } from '../normalizers/person.js'
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

/** Importa uma pessoa; devolve um ImportResult (status success/failed/aborted). */
export async function importPerson(ctx: ImportContext, tmdbId: number): Promise<ImportResult> {
  const endpoint = `/person/${tmdbId}`
  const startedMs = ctx.now().getTime()

  try {
    const result = await ctx.cache.getOrFetch({
      endpoint,
      params: { append_to_response: 'external_ids' },
      fetcher: () => ctx.tmdb.getPerson(tmdbId),
    })
    const now = ctx.now()
    const quotaCost = result.fromCache ? 0 : 1

    if (!result.changed) {
      await ctx.store.touchPerson(tmdbId, now)
      await ctx.syncLog.write({
        endpoint,
        status: 'success',
        itemsProcessed: 1,
        durationMs: ctx.now().getTime() - startedMs,
        quotaCost,
        payloadHash: result.payloadHash,
      })
      return {
        entityType: 'person',
        tmdbId,
        status: 'success',
        changed: false,
        created: false,
        id: null,
        quotaCost,
      }
    }

    const normalized = normalizePerson(result.data)
    const outcome = await ctx.store.upsertPerson({
      person: normalized.person,
      externalIds: normalized.externalIds,
      lastSyncedAt: now,
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
      entityType: 'person',
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
      entityType: 'person',
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
