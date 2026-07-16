/**
 * sync-external-ids-handler.ts — `sync_external_ids` (Backend A §9).
 *
 * Ids externos (imdb/tvdb/wikidata/facebook/...) de movie|tv|person|episode.
 *
 * ID externo NAO e rating (invariante 2): este job so grava identidade. Nenhuma
 * nota, escala ou rotulo passa por aqui — quem quiser a nota do IMDb usa o
 * caminho de ratings, com `rating_source` proprio e licenca.
 *
 * Identidade que muda upstream ATUALIZA o valor, mas nunca APAGA o anterior por
 * conta propria: remover id externo e decisao com politica, nao efeito colateral
 * de um sync. Mudanca de imdb_id reprojeta a busca (o documento carrega link).
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import type { CatalogExternalIdsSyncPort } from './ports.js'
import { validateSyncExternalIdsInput, type SyncExternalIdsInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_external_ids`. */
export interface SyncExternalIdsResult {
  readonly entityType: string
  readonly tmdbId: number
  readonly upserted: number
  readonly changed: number
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncExternalIdsHandlerDeps {
  readonly externalIdsSync: CatalogExternalIdsSyncPort
}

/** Handler de `sync_external_ids`. */
export class SyncExternalIdsHandler
  implements CatalogJobHandler<SyncExternalIdsInput, SyncExternalIdsResult>
{
  readonly type = 'sync_external_ids' as const

  constructor(private readonly deps: SyncExternalIdsHandlerDeps) {}

  validateInput(value: unknown): SyncExternalIdsInput {
    return validateSyncExternalIdsInput(value)
  }

  async execute(
    context: CatalogJobContext,
    input: SyncExternalIdsInput,
  ): Promise<SyncExternalIdsResult> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.externalIdsSync.syncExternalIds({
        kind: input.entityType,
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        episodeNumber: input.episodeNumber,
        signal: context.signal,
      })

      context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.upserted, {
        job_type: this.type,
        entity_type: input.entityType,
        result: outcome.skipped ? 'skipped' : 'success',
      })

      if (outcome.changed > 0) {
        context.log.log('info', 'catalog_external_identity_changed', {
          jobId: context.jobId,
          entityType: input.entityType,
          changed: outcome.changed,
        })
      }

      return {
        entityType: input.entityType,
        tmdbId: input.tmdbId,
        upserted: outcome.upserted,
        changed: outcome.changed,
        skipped: outcome.skipped,
        skipReason: outcome.skipReason,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: input.entityType,
        error_class: classifySafeError(error),
      })
      throw error
    }
  }
}
