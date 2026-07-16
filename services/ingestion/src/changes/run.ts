/**
 * run.ts — Execucao do incremental TMDB `/changes` (Backend A §4).
 *
 * O planner (`discovery/changes-plan.ts`) ja existia e so montava a requisicao.
 * Aqui esta a EXECUCAO: pagina a lista de mudancas, enfileira o re-sync dos ids
 * alterados e avanca o checkpoint.
 *
 * INVARIANTE CENTRAL: o checkpoint SO avanca depois do COMMIT do lote. Enfileirar
 * os jobs da pagina e gravar o checkpoint acontecem na MESMA transacao
 * (`ChangesCheckpointPort.commit`). Se o processo morre no meio de uma pagina, o
 * checkpoint continua na pagina anterior e a retomada reprocessa aquela pagina —
 * seguro porque o enqueue e idempotente (idempotency_key deterministica).
 *
 * PURO de IO proprio: fetch, checkpoint, relogio e metricas sao injetados.
 */

import { CATALOG_METRIC_NAMES, type MetricsSink } from '../metrics/index.js'
import { buildIdempotencyKey } from '../catalog-jobs/idempotency.js'
import type { EnqueueCatalogJobInput } from '../catalog-jobs/store-port.js'
import type { StructuredLogger } from '../catalog-jobs/handler.js'
import {
  CHANGES_MAX_WINDOW_DAYS,
  formatChangesDate,
  type ChangesKind,
} from '../discovery/changes-plan.js'

/** Estado persistido do checkpoint de changes. */
export interface ChangesCheckpointState {
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  /** Janela ja processada, ex.: "2026-07-10:2026-07-16". */
  readonly cursor: string | null
}

/** Commit ATOMICO: jobs do lote + avanco do checkpoint na mesma transacao. */
export interface ChangesCommitInput {
  readonly job: string
  readonly paramsHash: string
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  readonly cursor: string
  readonly enqueue: readonly EnqueueCatalogJobInput[]
}

/** Porta do checkpoint de changes. */
export interface ChangesCheckpointPort {
  read(job: string, paramsHash: string): Promise<ChangesCheckpointState | null>
  /**
   * Grava os jobs E o checkpoint numa UNICA transacao. Retorna quantos jobs
   * foram criados de fato (enqueue repetido = noop idempotente).
   */
  commit(input: ChangesCommitInput): Promise<{ enqueued: number }>
}

/** Uma pagina de `/changes` (subconjunto defensivo). */
export interface ChangesPage {
  readonly results?: ReadonlyArray<{ id?: number | null; adult?: boolean | null }>
  readonly page?: number | null
  readonly total_pages?: number | null
}

/** Dependencias do executor. */
export interface ChangesRunDeps {
  fetchChanges(
    kind: ChangesKind,
    params: { start_date: string; end_date: string; page: number },
  ): Promise<ChangesPage>
  readonly checkpoint: ChangesCheckpointPort
  readonly metrics: MetricsSink
  readonly log?: StructuredLogger
  readonly now?: () => Date
}

/** Opcoes de um ciclo de changes. */
export interface ChangesRunOptions {
  readonly kinds?: readonly ChangesKind[]
  /** Inicio da janela (default: end - 1 dia). */
  readonly from?: Date
  /** Fim da janela (default: agora). */
  readonly to?: Date
  /** Teto de paginas por kind (piloto/CI). */
  readonly maxPages?: number
  /** Retoma do checkpoint (default true). false => recomeca a janela. */
  readonly resume?: boolean
  readonly runId?: string
}

/** Relatorio por kind. */
export interface ChangesKindReport {
  readonly kind: ChangesKind
  readonly pages: number
  readonly changedIds: number
  readonly enqueued: number
  readonly done: boolean
  readonly skipped: boolean
}

/** Relatorio do ciclo. */
export interface ChangesRunReport {
  readonly window: { readonly from: string; readonly to: string }
  readonly kinds: readonly ChangesKindReport[]
  readonly totalEnqueued: number
}

const DEFAULT_KINDS: readonly ChangesKind[] = ['movie', 'tv', 'person']
const DAY_MS = 24 * 60 * 60 * 1000

/** Nome canonico do job de checkpoint (espelha `job='changes:movie'` do schema). */
export function changesJobName(kind: ChangesKind): string {
  return `changes:${kind}`
}

/** Hash estavel dos params da janela (identidade do checkpoint). */
export function changesParamsHash(from: string, to: string): string {
  return `${from}:${to}`
}

/**
 * Extrai os ids alterados de uma pagina. Descarta id invalido e, por seguranca
 * (fail-closed), qualquer item marcado `adult: true`.
 */
export function extractChangedIds(page: ChangesPage): number[] {
  const results = Array.isArray(page.results) ? page.results : []
  const ids: number[] = []
  for (const item of results) {
    if (item === null || typeof item !== 'object') continue
    if (item.adult === true) continue // nunca enfileira conteudo adulto
    const id = item.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    ids.push(id)
  }
  return [...new Set(ids)]
}

/** Deriva a janela [from, to], respeitando o maximo de 14 dias do TMDB. */
export function resolveWindow(options: ChangesRunOptions, now: Date): { from: Date; to: Date } {
  const to = options.to ?? now
  const from = options.from ?? new Date(to.getTime() - DAY_MS)
  const maxMs = CHANGES_MAX_WINDOW_DAYS * DAY_MS
  // Janela maior que o teto do TMDB e truncada pelo inicio (nunca lanca).
  const clampedFrom = to.getTime() - from.getTime() > maxMs ? new Date(to.getTime() - maxMs) : from
  return { from: clampedFrom, to }
}

/**
 * Executa o incremental de changes para os kinds pedidos.
 *
 * Por pagina: busca -> extrai ids -> monta os jobs de re-sync -> COMMIT ATOMICO
 * (jobs + checkpoint). O checkpoint nunca avanca sem o lote ter sido gravado.
 */
export async function runChangesSync(
  deps: ChangesRunDeps,
  options: ChangesRunOptions = {},
): Promise<ChangesRunReport> {
  const now = deps.now ?? (() => new Date())
  const kinds = options.kinds ?? DEFAULT_KINDS
  const resume = options.resume ?? true
  const runId = options.runId ?? 'catalog-changes'
  const { from, to } = resolveWindow(options, now())
  const startDate = formatChangesDate(from)
  const endDate = formatChangesDate(to)
  const paramsHash = changesParamsHash(startDate, endDate)
  const cursor = paramsHash

  const reports: ChangesKindReport[] = []
  let totalEnqueued = 0

  for (const kind of kinds) {
    const job = changesJobName(kind)
    const state = resume ? await deps.checkpoint.read(job, paramsHash) : null

    // Janela ja concluida: repetir e noop (idempotencia de janela).
    if (state?.done === true) {
      reports.push({ kind, pages: 0, changedIds: 0, enqueued: 0, done: true, skipped: true })
      deps.log?.log('info', 'catalog_changes_window_already_done', { runId, kind, window: cursor })
      continue
    }

    let page = (state?.lastPage ?? 0) + 1
    let totalPages = state?.totalPages ?? null
    let pages = 0
    let changedIds = 0
    let enqueued = 0
    let done = false

    for (;;) {
      if (options.maxPages !== undefined && pages >= options.maxPages) break
      if (totalPages !== null && page > totalPages) {
        done = true
        break
      }

      const response = await deps.fetchChanges(kind, {
        start_date: startDate,
        end_date: endDate,
        page,
      })
      deps.metrics.increment(CATALOG_METRIC_NAMES.tmdbRequestsTotal, 1, {
        endpoint: `changes:${kind}`,
      })
      const reportedTotal =
        typeof response.total_pages === 'number' && response.total_pages > 0
          ? response.total_pages
          : null
      totalPages = reportedTotal ?? totalPages

      const ids = extractChangedIds(response)
      changedIds += ids.length

      const enqueueInputs: EnqueueCatalogJobInput[] = ids.map((id) => ({
        jobType: 'sync_details',
        entityType: kind,
        externalId: String(id),
        // Discriminador = janela: o mesmo id alterado em janelas diferentes e
        // trabalho novo; na MESMA janela e noop idempotente.
        idempotencyKey: buildIdempotencyKey({
          jobType: 'sync_details',
          entityType: kind,
          externalId: String(id),
          discriminator: cursor,
        }),
        payload: { reason: 'changes', window: cursor },
        priority: 50, // mudanca upstream tem prioridade sobre backfill
        runId,
      }))

      const isLastPage = totalPages !== null && page >= totalPages
      // COMMIT ATOMICO: jobs + checkpoint. Se falhar, o checkpoint NAO avanca.
      const committed = await deps.checkpoint.commit({
        job,
        paramsHash,
        lastPage: page,
        totalPages,
        done: isLastPage,
        cursor,
        enqueue: enqueueInputs,
      })
      enqueued += committed.enqueued
      pages += 1
      done = isLastPage
      deps.log?.log('debug', 'catalog_changes_page_committed', {
        runId,
        kind,
        page,
        ids: ids.length,
        enqueued: committed.enqueued,
      })

      if (isLastPage) break
      page += 1
    }

    totalEnqueued += enqueued
    reports.push({ kind, pages, changedIds, enqueued, done, skipped: false })
    deps.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, enqueued, {
      kind,
      source: 'changes',
    })
  }

  return { window: { from: startDate, to: endDate }, kinds: reports, totalEnqueued }
}
