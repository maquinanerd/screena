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
import { computeRawPayloadHashAndSize, decideRawOutcome } from './hash-decision.js'
import { fetchWithRetry, isCircuitOpenError, type RetryCounters, type RetryOptions } from './retry.js'
import { fetchByKind } from './supported-kinds.js'
import type {
  ItemOutcome,
  KindCounts,
  PayloadSizeStats,
  PilotLimits,
  PilotSelection,
  RawDetailSource,
  RawEntityKey,
  RawEntityStore,
  RawSyncAbortReason,
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
  /**
   * Teto EFETIVO de requisicoes de fetch do run (safety valve). Ao atingi-lo, o
   * lote para de INICIAR novos itens (degradacao graciosa; itens em voo
   * terminam) e o relatorio marca `aborted`/`request-ceiling`. `undefined` =
   * sem teto extra alem do limite natural (selecionados x maxAttempts). A
   * checagem e por item (nao por tentativa), entao ha overshoot BOUNDED de ate
   * `concurrency * (maxAttempts - 1)` requisicoes: cada um dos ate `concurrency`
   * itens ja em voo pode concluir seus retries apos o teto ser cruzado — finito,
   * nunca ilimitado. E um teto suave (soft), nao um corte exato.
   */
  readonly maxRequests?: number
  /** Observabilidade por item. */
  readonly onItem?: (item: QueueItem, outcome: ItemOutcome) => void
}

/**
 * Controle mutavel do lote (parada precoce + contagem de requisicoes). Comutativo
 * com a concorrencia: os campos so acumulam/monotonizam, entao o pool nao altera
 * o desfecho agregado.
 */
interface RunControl {
  stopped: boolean
  reason: RawSyncAbortReason | null
  requests: number
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

/** Acumulador mutavel de tamanho de payload (bytes UTF-8 da serializacao canonica). */
interface SizeAccum {
  count: number
  sumBytes: number
  maxBytes: number
  minBytes: number
}

function emptySizeAccum(): SizeAccum {
  return { count: 0, sumBytes: 0, maxBytes: 0, minBytes: 0 }
}

/** Registra UMA amostra de tamanho (comutativo — seguro sob concorrencia). */
function recordSize(acc: SizeAccum, bytes: number): void {
  if (acc.count === 0) {
    acc.maxBytes = bytes
    acc.minBytes = bytes
  } else {
    if (bytes > acc.maxBytes) acc.maxBytes = bytes
    if (bytes < acc.minBytes) acc.minBytes = bytes
  }
  acc.count += 1
  acc.sumBytes += bytes
}

/** Combina acumuladores (para o total entre tipos), preservando exatidao. */
function mergeAccums(accs: readonly SizeAccum[]): SizeAccum {
  const out = emptySizeAccum()
  for (const a of accs) {
    if (a.count === 0) continue
    if (out.count === 0) {
      out.maxBytes = a.maxBytes
      out.minBytes = a.minBytes
    } else {
      if (a.maxBytes > out.maxBytes) out.maxBytes = a.maxBytes
      if (a.minBytes < out.minBytes) out.minBytes = a.minBytes
    }
    out.count += a.count
    out.sumBytes += a.sumBytes
  }
  return out
}

/** Finaliza um acumulador em estatistica publica (avg arredondado; zeros se vazio). */
function finalizeSize(acc: SizeAccum): PayloadSizeStats {
  return {
    count: acc.count,
    avgBytes: acc.count === 0 ? 0 : Math.round(acc.sumBytes / acc.count),
    maxBytes: acc.count === 0 ? 0 : acc.maxBytes,
    minBytes: acc.count === 0 ? 0 : acc.minBytes,
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
  shouldContinue?: () => boolean,
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0
  async function drain(): Promise<void> {
    while (cursor < items.length) {
      // Parada precoce (teto de requisicoes / breaker): nao INICIA novos itens.
      // Itens ja em voo terminam; os nao iniciados contam como `notProcessed`.
      if (shouldContinue && !shouldContinue()) return
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
  size: SizeAccum,
  retryCounters: RetryCounters,
  retryOptions: RetryOptions,
  control: RunControl,
): Promise<void> {
  const key: RawEntityKey = {
    entityType: kind,
    tmdbId: item.tmdbId,
    baseLanguage: options.baseLanguage,
  }
  try {
    const payload = await fetchWithRetry(
      () => fetchByKind(options.source, kind, item.tmdbId),
      retryOptions,
      retryCounters,
    )
    // Hash + tamanho na MESMA serializacao canonica (uma passada so).
    const { hash: payloadHash, bytes } = computeRawPayloadHashAndSize(payload)
    const existingHash = await options.store.readHash(key)
    const outcome = decideRawOutcome(existingHash, payloadHash)

    // O worker JA buscou o payload para hashear; o tamanho vale em create/update
    // E skip (todo desfecho que teve payload). `failed` (fetch/store) nao entra.
    if (outcome === 'skip') {
      counts.skipped += 1
      recordSize(size, bytes)
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
    recordSize(size, bytes)
    options.onItem?.(item, outcome)
  } catch (error) {
    // Circuito aberto = fonte degradada: para o lote (graciosamente) para nao
    // marretar 300 itens contra um breaker aberto. Retomavel — nada foi gravado.
    if (isCircuitOpenError(error)) {
      control.stopped = true
      if (control.reason === null) control.reason = 'circuit-open'
    }
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
  const perKindSize: Record<SupportedRawKind, SizeAccum> = {
    movie: emptySizeAccum(),
    tv: emptySizeAccum(),
    person: emptySizeAccum(),
  }
  const retryCounters: RetryCounters = { retries: 0, rate429: 0 }
  const control: RunControl = { stopped: false, reason: null, requests: 0 }

  if (options.dryRun) {
    // Plano: nao toca source/store. So sinaliza o que seria processado.
    for (const item of options.selection.selected) {
      options.onItem?.(item, 'planned')
    }
  } else {
    const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    const maxRequests = options.maxRequests ?? null
    // `onAttempt` conta cada tentativa de fetch (teto efetivo + quota honesta),
    // preservando um `onAttempt` do chamador se houver.
    const retryOptions: RetryOptions = {
      ...options.retry,
      onAttempt: () => {
        control.requests += 1
        options.retry.onAttempt?.()
      },
    }
    // Para de iniciar itens quando o breaker abriu (via processItem) ou o teto de
    // requisicoes foi atingido. Checagem por item (overshoot bounded — ver doc).
    const shouldContinue = (): boolean => {
      if (control.stopped) return false
      if (maxRequests !== null && control.requests >= maxRequests) {
        control.stopped = true
        control.reason = 'request-ceiling'
        return false
      }
      return true
    }
    await forEachConcurrent(
      options.selection.selected,
      concurrency,
      async (item) => {
        // `selected` so contem tipos suportados (garantido pelo seletor).
        const kind = item.kind as SupportedRawKind
        await processItem(
          item,
          kind,
          options,
          perKind[kind],
          perKindSize[kind],
          retryCounters,
          retryOptions,
          control,
        )
      },
      shouldContinue,
    )
  }

  const totals = sumCounts(sumCounts(perKind.movie, perKind.tv), perKind.person)
  const payloadSizes: Record<SupportedRawKind, PayloadSizeStats> = {
    movie: finalizeSize(perKindSize.movie),
    tv: finalizeSize(perKindSize.tv),
    person: finalizeSize(perKindSize.person),
  }
  const payloadSizesTotal = finalizeSize(
    mergeAccums([perKindSize.movie, perKindSize.tv, perKindSize.person]),
  )
  const durationMs = Math.max(0, options.now().getTime() - startedMs)

  // Itens que NAO foram processados (so acontece em apply abortado): selecionados
  // menos os que consumiram um desfecho. Retomaveis (nada gravado para eles).
  const processedCount = totals.created + totals.updated + totals.skipped + totals.failed
  const notProcessed = options.dryRun
    ? 0
    : Math.max(0, options.selection.selected.length - processedCount)

  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    baseLanguage: options.baseLanguage,
    limits: options.limits,
    perKindSelected: { ...options.selection.perKindSelected },
    perKind,
    totals,
    payloadSizes,
    payloadSizesTotal,
    unsupportedSkipped: options.selection.unsupportedSkipped,
    unsupportedByKind: { ...options.selection.unsupportedByKind },
    retries: retryCounters.retries,
    rate429: retryCounters.rate429,
    requests: control.requests,
    notProcessed,
    aborted: control.stopped,
    abortReason: control.reason,
    scanned: options.selection.scanned,
    selected: options.selection.selected.length,
    durationMs,
  }
}
