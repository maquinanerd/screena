/**
 * sync-seasons-handler.ts — `sync_seasons` (Backend A §11).
 *
 * Detalhe das temporadas de UMA serie e, quando pedido, enfileira um
 * `sync_episodes` e um `sync_media` de temporada por temporada existente.
 *
 * As temporadas enfileiradas sao as que o provider REPORTOU (`seasonNumbers`),
 * nunca um intervalo 1..N adivinhado: series tem temporada 0 (especiais) e
 * lacunas, e inventar numero geraria job para temporada inexistente.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { buildIdempotencyKey } from '../idempotency.js'
import type { CatalogJobStorePort } from '../store-port.js'
import type { CatalogSeasonsSyncPort } from './ports.js'
import { validateSyncSeasonsInput, type SyncSeasonsInput } from './schemas.js'
import { classifySafeError, createEnqueueTally, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_seasons`. */
export interface SyncSeasonsResult {
  readonly tmdbId: number
  readonly seasons: number
  readonly episodes: number
  readonly enqueued: number
  /**
   * Numeros de temporada REPORTADOS pelo provider (inclui 0 = especiais).
   *
   * Faz parte do resultado porque um chamador que nao usa a fila (a CLI
   * `catalog episodes` sem --season) precisa saber QUAIS temporadas existem para
   * processa-las. Sem este campo o consumidor lia `undefined` e nao iterava
   * nenhuma — falha silenciosa.
   */
  readonly seasonNumbers: readonly number[]
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncSeasonsHandlerDeps {
  readonly seasonsSync: CatalogSeasonsSyncPort
  readonly store: CatalogJobStorePort
}

/** Handler de `sync_seasons`. */
export class SyncSeasonsHandler implements CatalogJobHandler<SyncSeasonsInput, SyncSeasonsResult> {
  readonly type = 'sync_seasons' as const

  constructor(private readonly deps: SyncSeasonsHandlerDeps) {}

  validateInput(value: unknown): SyncSeasonsInput {
    return validateSyncSeasonsInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncSeasonsInput): Promise<SyncSeasonsResult> {
    throwIfAborted(context.signal)
    await context.heartbeat()

    let outcome
    try {
      outcome = await this.deps.seasonsSync.syncSeasons({
        tvTmdbId: input.tmdbId,
        locale: input.locale,
        signal: context.signal,
      })
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: 'tv',
        error_class: classifySafeError(error),
      })
      throw error
    }

    context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.seasons, {
      job_type: this.type,
      entity_type: 'season',
      result: outcome.skipped ? 'skipped' : 'success',
    })

    if (outcome.skipped) {
      return {
        tmdbId: input.tmdbId,
        seasons: 0,
        episodes: 0,
        enqueued: 0,
        seasonNumbers: [],
        skipped: true,
        skipReason: outcome.skipReason,
      }
    }

    let enqueued = 0
    const tally = createEnqueueTally()
    if (input.enqueueEpisodes) {
      throwIfAborted(context.signal)
      for (const seasonNumber of outcome.seasonNumbers) {
        const result = await this.deps.store.enqueue({
          jobType: 'sync_episodes',
          entityType: 'season',
          externalId: String(input.tmdbId),
          idempotencyKey: buildIdempotencyKey({
            jobType: 'sync_episodes',
            entityType: 'season',
            externalId: String(input.tmdbId),
            discriminator: `s${seasonNumber}:${input.locale}`,
          }),
          payload: { tmdbId: input.tmdbId, seasonNumber, locale: input.locale },
          priority: 70,
          runId: context.requestId,
        })
        tally.add('sync_episodes', result.created)
        if (result.created) enqueued += 1
        await context.heartbeat()
      }
      tally.flush(context.metrics)
    }

    /**
     * A MIDIA DA TEMPORADA — o trilho que nao existia.
     *
     * `sync_media` recusava `season` ate 2026-08-27, entao nada jamais
     * enfileirou este job e `tmdb_videos` nunca teve uma linha de temporada. A
     * pagina de temporada nao tinha trailer por falta deste laco, nao por
     * falta de dado no TMDB nem de licenca (a entrada "TMDB (trailers)" existe
     * desde 13/08/2026).
     *
     * Custo: 1 job e 2 requisicoes (`/images` + `/videos`) por temporada.
     * Prioridade 75 — atras de `sync_episodes` (70), porque o trailer enriquece
     * uma pagina que os episodios primeiro precisam POVOAR.
     */
    if (input.enqueueSeasonMedia) {
      throwIfAborted(context.signal)
      for (const seasonNumber of outcome.seasonNumbers) {
        const result = await this.deps.store.enqueue({
          jobType: 'sync_media',
          entityType: 'season',
          externalId: String(input.tmdbId),
          idempotencyKey: buildIdempotencyKey({
            jobType: 'sync_media',
            entityType: 'season',
            externalId: String(input.tmdbId),
            discriminator: `s${seasonNumber}:${input.locale}`,
          }),
          // `tmdbId` e o da SERIE (e assim que o TMDB endereca a URL); o id
          // proprio da temporada — a CHAVE de gravacao — o adapter resolve no
          // banco. Ver `buildMediaTarget`.
          payload: {
            entityType: 'season',
            tmdbId: input.tmdbId,
            seasonNumber,
            locale: input.locale,
          },
          priority: 75,
          runId: context.requestId,
        })
        if (result.created) enqueued += 1
        await context.heartbeat()
      }
    }

    return {
      tmdbId: input.tmdbId,
      seasons: outcome.seasons,
      episodes: outcome.episodes,
      enqueued,
      seasonNumbers: outcome.seasonNumbers,
      skipped: false,
      skipReason: null,
    }
  }
}
