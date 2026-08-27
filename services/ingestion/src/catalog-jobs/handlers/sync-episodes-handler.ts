/**
 * sync-episodes-handler.ts — `sync_episodes` (Backend A §11).
 *
 * Detalhe + creditos + guest stars + ids externos + stills dos episodios de UMA
 * temporada.
 *
 * `Episode.tmdbId` nulo NAO derruba o lote: sem chave natural, aquele episodio
 * nao tem o que sincronizar. Ele e contado em `skippedNoTmdbId`, ganha metrica
 * propria e o restante da temporada segue. Falhar a temporada inteira por causa
 * de uma linha sem id transformaria um buraco de dado num incidente de fila.
 */

import { CATALOG_METRIC_NAMES } from '../../metrics/index.js'
import type { CatalogJobContext, CatalogJobHandler } from '../handler.js'
import { buildIdempotencyKey } from '../idempotency.js'
import type { CatalogJobStorePort } from '../store-port.js'
import type { CatalogEpisodesSyncPort } from './ports.js'
import { validateSyncEpisodesInput, type SyncEpisodesInput } from './schemas.js'
import { classifySafeError, throwIfAborted } from './support.js'

/** Resultado serializavel do `sync_episodes`. */
export interface SyncEpisodesResult {
  readonly tmdbId: number
  readonly seasonNumber: number
  readonly episodes: number
  readonly cast: number
  readonly guestStars: number
  readonly crew: number
  readonly externalIds: number
  readonly stills: number
  readonly skippedNoTmdbId: number
  /** Episodios que cairam para o resumo da temporada (detalhe falhou). */
  readonly failedDetail: number
  /** `sync_media` de episodio enfileirados (0 quando `enqueueEpisodeMedia` e false). */
  readonly enqueued: number
  /** Numeros de episodio processados, na ordem do provider (nunca `1..N`). */
  readonly episodeNumbers: readonly number[]
  readonly skipped: boolean
  readonly skipReason: string | null
}

/** Dependencias do handler. */
export interface SyncEpisodesHandlerDeps {
  readonly episodesSync: CatalogEpisodesSyncPort
  readonly store: CatalogJobStorePort
}

/** Handler de `sync_episodes`. */
export class SyncEpisodesHandler
  implements CatalogJobHandler<SyncEpisodesInput, SyncEpisodesResult>
{
  readonly type = 'sync_episodes' as const

  constructor(private readonly deps: SyncEpisodesHandlerDeps) {}

  validateInput(value: unknown): SyncEpisodesInput {
    return validateSyncEpisodesInput(value)
  }

  async execute(context: CatalogJobContext, input: SyncEpisodesInput): Promise<SyncEpisodesResult> {
    const startedAt = Date.now()
    throwIfAborted(context.signal)
    await context.heartbeat()

    try {
      const outcome = await this.deps.episodesSync.syncEpisodes({
        tvTmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        locale: input.locale,
        signal: context.signal,
      })

      context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.episodes, {
        job_type: this.type,
        entity_type: 'episode',
        result: outcome.skipped ? 'skipped' : 'success',
      })

      if (outcome.skippedNoTmdbId > 0) {
        // Visivel como metrica propria: buraco de dado upstream, nao falha nossa.
        context.metrics.increment(
          CATALOG_METRIC_NAMES.entitiesSyncedTotal,
          outcome.skippedNoTmdbId,
          { job_type: this.type, entity_type: 'episode', result: 'skipped_no_tmdb_id' },
        )
        context.log.log('warn', 'catalog_episodes_skipped_no_tmdb_id', {
          jobId: context.jobId,
          seasonNumber: input.seasonNumber,
          skipped: outcome.skippedNoTmdbId,
        })
      }

      if (outcome.failedDetail > 0) {
        // Degradacao VISIVEL: o episodio existe, mas sem elenco regular, ids
        // externos nem stills. Contar isso como sucesso limpo repetiria o
        // defeito que este job acabou de sair — reportar zero e chamar de bom.
        context.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, outcome.failedDetail, {
          job_type: this.type,
          entity_type: 'episode',
          result: 'degraded_no_detail',
        })
        context.log.log('warn', 'catalog_episode_detail_failed', {
          jobId: context.jobId,
          seasonNumber: input.seasonNumber,
          degraded: outcome.failedDetail,
        })
      }

      context.metrics.observe(
        CATALOG_METRIC_NAMES.syncDurationSeconds,
        (Date.now() - startedAt) / 1000,
        { job_type: this.type, entity_type: 'episode' },
      )

      /**
       * A MIDIA DO EPISODIO — a galeria de stills.
       *
       * Um job por EPISODIO: e a dimensao mais cara desta leva (12 jobs numa
       * temporada de 12). Existe porque o endpoint proprio
       * (`/…/episode/{e}/images`) vai SEM `language` e devolve o conjunto
       * inteiro de stills, enquanto a copia que vem no append do detalhe chega
       * filtrada pelo idioma do pedido. Os dois gravam na mesma chave unica de
       * `tmdb_images` — rodar os dois nao duplica linha.
       *
       * Enfileira SO os episodios efetivamente processados: um episodio pulado
       * por falta de id nao tem entidade dona, e um job para ele so produziria
       * uma recusa `missing_own_tmdb_id` na fila.
       *
       * Prioridade 80 — a mais baixa do trilho de serie: e enriquecimento de
       * uma sub-pagina, atras do detalhe (70) e do trailer da temporada (75).
       */
      let enqueued = 0
      if (input.enqueueEpisodeMedia && outcome.episodeNumbers.length > 0) {
        throwIfAborted(context.signal)
        // Os numeros REPORTADOS, nunca um intervalo `1..N` adivinhado: existe
        // episodio 0 (especial) e numeracao com lacuna, e o `sync_seasons` ja
        // paga essa licao no proprio cabecalho.
        for (const episodeNumber of outcome.episodeNumbers) {
          const result = await this.deps.store.enqueue({
            jobType: 'sync_media',
            entityType: 'episode',
            externalId: String(input.tmdbId),
            idempotencyKey: buildIdempotencyKey({
              jobType: 'sync_media',
              entityType: 'episode',
              externalId: String(input.tmdbId),
              discriminator: `s${input.seasonNumber}e${episodeNumber}:${input.locale}`,
            }),
            payload: {
              entityType: 'episode',
              tmdbId: input.tmdbId,
              seasonNumber: input.seasonNumber,
              episodeNumber,
              locale: input.locale,
            },
            priority: 80,
            runId: context.requestId,
          })
          if (result.created) enqueued += 1
          await context.heartbeat()
        }
      }

      return {
        tmdbId: input.tmdbId,
        seasonNumber: input.seasonNumber,
        episodes: outcome.episodes,
        cast: outcome.cast,
        guestStars: outcome.guestStars,
        crew: outcome.crew,
        externalIds: outcome.externalIds,
        stills: outcome.stills,
        skippedNoTmdbId: outcome.skippedNoTmdbId,
        failedDetail: outcome.failedDetail,
        enqueued,
        episodeNumbers: outcome.episodeNumbers,
        skipped: outcome.skipped,
        skipReason: outcome.skipReason,
      }
    } catch (error) {
      context.metrics.increment(CATALOG_METRIC_NAMES.jobsFailedTotal, 1, {
        job_type: this.type,
        entity_type: 'episode',
        error_class: classifySafeError(error),
      })
      throw error
    }
  }
}
