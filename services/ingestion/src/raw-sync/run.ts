/**
 * run.ts — Orquestracao PURA do piloto de raw sync (P0-00d). Sem rede, sem DB:
 * opera sobre as portas `RawDetailSource` + `RawEntityStore`, testavel com fakes.
 *
 * Por item suportado (apply):
 *   fetch (com retry/contagem) -> hash estavel -> le hash existente -> decide
 *   create/update/skip -> grava (ou nao, no skip) -> conta desfecho.
 * Erro (permanente ou retries esgotados) -> conta `failed`, NUNCA aborta o lote.
 *
 * Dry-run: NAO chama `source` nem `store` — so marca os selecionados como
 * `planned`. Assim "dry-run nao grava e nao busca" e garantido por construcao.
 *
 * Concorrencia BAIXA e EXPLICITA: pool limitado (default 4); os contadores sao
 * comutativos, entao a contagem final independe da ordem/tamanho do pool.
 */

import type { QueueItem } from '../discovery/sync-queue.js'
import { computeRawPayloadHash, decideRawOutcome } from './hash-decision.js'
import { fetchWithRetry, type RetryCounters, type RetryOptions } from './retry.js'
import { fetchByKind } from './supported-kinds.js'
import type {
  ItemOutcome,
  KindCounts,
  PilotLimits,
  PilotSelection,
  RawDetailSource,
  RawEntityKey,
  RawEntityStore,
  RawSyncReport,
  SupportedRawKind,
} from './types.js'

/** Concorrencia default do pool (baixa e explicita). */
export const DEFAULT_CONCURRENCY = 4

/** Opcoes de uma execucao do piloto. */
export interface RunRawSyncOptions {
  readonly selection: PilotSelection
  readonly source: RawDetailSource
  readonly store: RawEntityStore
  readonly baseLanguage: string
  readonly limits: PilotLimits
  /** Relogio injetavel (determinista em teste). */
  readonly now: () => Date
  /** true = plano (nao toca source/store); false = grava de fato. */
  readonly dryRun: boolean
  /** Tamanho do pool (default `DEFAULT_CONCURRENCY`). */
  readonly concurrency?: number
  /** Politica de retry (obrigatoria — injeta `sleep`). */
  readonly retry: RetryOptions
  /** Observabilidade por item. */
  readonly onItem?: (item: QueueItem, outcome: ItemOutcome) => void
}

function emptyCounts(): KindCounts {
  return { created: 0, updated: 0, skipped: 0, failed: 0 }
}

function sumCounts(a: KindCounts, b: KindCounts): KindCounts {
  return {
    created: a.created + b.created,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
    failed: a.failed + b.failed,
  }
}

/**
 * Executa `worker` sobre `items` com no maximo `concurrency` em voo. Determinismo
 * de contagem: os desfechos so incrementam contadores (comutativo), entao o pool
 * nao altera o resultado agregado.
 */
async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0
  async function drain(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const value = items[index]
      if (value === undefined) continue // inalcancavel (index < length); satisfaz noUncheckedIndexedAccess
      await worker(value, index)
    }
  }
  await Promise.all(Array.from({ length: limit }, () => drain()))
}

/** Processa UM item suportado no modo apply, atualizando os contadores do tipo. */
async function processItem(
  item: QueueItem,
  kind: SupportedRawKind,
  options: RunRawSyncOptions,
  counts: KindCounts,
  retryCounters: RetryCounters,
): Promise<void> {
  const key: RawEntityKey = {
    entityType: kind,
    tmdbId: item.tmdbId,
    baseLanguage: options.baseLanguage,
  }
  try {
    const payload = await fetchWithRetry(
      () => fetchByKind(options.source, kind, item.tmdbId),
      options.retry,
      retryCounters,
    )
    const payloadHash = computeRawPayloadHash(payload)
    const existingHash = await options.store.readHash(key)
    const outcome = decideRawOutcome(existingHash, payloadHash)

    if (outcome === 'skip') {
      counts.skipped += 1
      options.onItem?.(item, 'skip')
      return
    }

    const record = {
      ...key,
      payload,
      payloadHash,
      etag: null,
      lastModified: null,
      fetchedAt: options.now(),
    }
    if (outcome === 'create') {
      await options.store.create(record)
      counts.created += 1
    } else {
      await options.store.update(key, record)
      counts.updated += 1
    }
    options.onItem?.(item, outcome)
  } catch {
    counts.failed += 1
    options.onItem?.(item, 'failed')
  }
}

/**
 * Roda o piloto e devolve o `RawSyncReport` completo (breakdown por tipo +
 * unsupported + retries/429). Combina a selecao (planejado/unsupported) com os
 * desfechos de gravacao.
 */
export async function runRawSyncPilot(options: RunRawSyncOptions): Promise<RawSyncReport> {
  const startedMs = options.now().getTime()
  const perKind: Record<SupportedRawKind, KindCounts> = {
    movie: emptyCounts(),
    tv: emptyCounts(),
    person: emptyCounts(),
  }
  const retryCounters: RetryCounters = { retries: 0, rate429: 0 }

  if (options.dryRun) {
    // Plano: nao toca source/store. So sinaliza o que seria processado.
    for (const item of options.selection.selected) {
      options.onItem?.(item, 'planned')
    }
  } else {
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    await forEachConcurrent(options.selection.selected, concurrency, async (item) => {
      // `selected` so contem tipos suportados (garantido pelo seletor).
      const kind = item.kind as SupportedRawKind
      await processItem(item, kind, options, perKind[kind], retryCounters)
    })
  }

  const totals = sumCounts(sumCounts(perKind.movie, perKind.tv), perKind.person)
  const durationMs = Math.max(0, options.now().getTime() - startedMs)

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    baseLanguage: options.baseLanguage,
    limits: options.limits,
    perKindSelected: { ...options.selection.perKindSelected },
    perKind,
    totals,
    unsupportedSkipped: options.selection.unsupportedSkipped,
    unsupportedByKind: { ...options.selection.unsupportedByKind },
    retries: retryCounters.retries,
    rate429: retryCounters.rate429,
    scanned: options.selection.scanned,
    selected: options.selection.selected.length,
    durationMs,
  }
}
