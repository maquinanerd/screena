/**
 * import-person.ts — Orquestra o import de uma pessoa por TMDB id.
 */

import { readPersonDisplayFields } from '../display-fields.js'
import { normalizePerson } from '../normalizers/person.js'
import { emptyDetailWatchReport } from '../watch-providers/from-detail.js'
import { describeError } from './errors.js'
import type { ImportContext, ImportResult } from './types.js'

/**
 * Pessoa nao tem "onde assistir": `PERSON_APPEND` nao pede `watch/providers`
 * porque o endpoint nao o oferece. O desfecho e declarado (`not-applicable`) em
 * vez de omitido — zero e um numero, "nao se aplica" e outro, e um relatorio
 * agregado que somasse pessoas como "sem oferta" mentiria sobre a cobertura.
 */
const PERSON_WATCH = emptyDetailWatchReport('not-applicable')

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

    // Ver o cabecalho do mesmo ramo em `import-movie.ts`: "payload inalterado"
    // NAO significa "entidade existe". Com o cache quente de uma tentativa que
    // falhou DEPOIS da escrita em `api_cache`, este ramo tocava zero linhas e
    // reportava sucesso para uma entidade ausente — para sempre, porque o hash
    // nunca mais muda. O booleano de `touch*` agora DECIDE.
    if (!result.changed && (await ctx.store.touchPerson(tmdbId, now))) {
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
        watch: PERSON_WATCH,
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
      display: readPersonDisplayFields(result.data),
      watch: PERSON_WATCH,
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
      watch: PERSON_WATCH,
      error: info.message,
      // Codigo e status viajam junto com a mensagem: quem embrulha este
      // resultado em excecao nao tem outro jeito de saber o que falhou.
      errorCode: info.code,
      ...(info.status === null ? {} : { errorStatus: info.status }),
    }
  }
}
