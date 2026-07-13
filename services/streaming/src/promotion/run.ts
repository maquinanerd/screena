/**
 * run.ts — Orquestracao PURA da revisao e da promocao. Sem Prisma, sem rede.
 *
 * `runReview` lista candidatas (ja filtradas por provider/pais no store) e anexa
 * a decisao de cada uma. `runPromotion` recebe ids EXPLICITOS, avalia cada oferta
 * pelos guardrails e — SO com `confirm` — chama o store para virar o gate
 * `display_allowed` das elegiveis. Sem `confirm`, nada e mutado (dry-run).
 *
 * O store reafirma provider/pais/estado no `WHERE` do update; aqui a garantia e
 * de fluxo: nenhuma linha rejeitada entra na lista passada ao store, e o store
 * so e chamado quando `confirm` e ha ao menos uma elegivel.
 */

import type { SyncLogPort } from '../ports.js'
import {
  evaluatePromotionEligibility,
  evaluateRevocationEligibility,
} from './guardrails.js'
import type { PromotionCandidate } from './types.js'

/** Consulta de listagem (o store aplica os filtros no banco). */
export interface ReviewQuery {
  readonly providerApi: string
  readonly countryCode: string
  /** `null` = filme e serie. */
  readonly entityType: string | null
  /** `null` = qualquer entidade. */
  readonly entityId: string | null
  readonly limit: number
}

/** Resultado de uma mutacao no store. */
export interface StoreMutationOutcome {
  readonly updated: number
}

/**
 * Porta de acesso a `watch_availability` para revisao/promocao.
 *
 * `listCandidates` e filtrada por provider/pais no banco (a listagem NUNCA traz
 * outro fornecedor). `promote`/`revoke` reafirmam provider/pais/estado no
 * `WHERE` — defesa em profundidade contra qualquer id fora do escopo.
 */
export interface ReviewStorePort {
  listCandidates(query: ReviewQuery): Promise<readonly PromotionCandidate[]>
  findByIds(ids: readonly string[]): Promise<readonly PromotionCandidate[]>
  /** Vira `display_allowed=true` (WHERE provider=SA, country=BR, allowed=false). */
  promote(ids: readonly string[]): Promise<StoreMutationOutcome>
  /** Vira `display_allowed=false` (WHERE provider=SA, allowed=true). */
  revoke(ids: readonly string[]): Promise<StoreMutationOutcome>
}

/** Uma candidata com a decisao anexada. */
export interface EvaluatedCandidate {
  readonly candidate: PromotionCandidate
  readonly eligible: boolean
  /** Motivo (promocao ou reversao) quando `eligible=false`; senao `null`. */
  readonly reason: string | null
}

/** Resumo de contagens de qualquer ciclo. */
export interface PromotionSummary {
  readonly found: number
  readonly eligible: number
  readonly rejected: number
  /** Contagem por motivo, ordem de primeira aparicao. */
  readonly byReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>
}

/** Resultado da revisao (read-only). */
export interface ReviewResult {
  readonly kind: string | null
  readonly country: string
  readonly entityId: string | null
  readonly evaluated: readonly EvaluatedCandidate[]
  readonly summary: PromotionSummary
}

/** Resultado da promocao/reversao. */
export interface PromotionResult {
  readonly mode: 'promote' | 'revoke'
  readonly confirm: boolean
  readonly country: string
  readonly idsRequested: readonly string[]
  readonly idsFound: readonly string[]
  /** Ids pedidos que nao existem em `watch_availability`. */
  readonly idsMissing: readonly string[]
  readonly evaluated: readonly EvaluatedCandidate[]
  readonly eligibleIds: readonly string[]
  /** Quantas linhas o banco realmente mutou (0 em dry-run). */
  readonly updated: number
  readonly summary: PromotionSummary
}

/** Agrupa motivos preservando a ordem de primeira aparicao. */
export function summarize(evaluated: readonly EvaluatedCandidate[]): PromotionSummary {
  const order: string[] = []
  const counts = new Map<string, number>()
  let eligible = 0

  for (const entry of evaluated) {
    if (entry.eligible) {
      eligible += 1
      continue
    }
    const reason = entry.reason ?? 'unknown'
    const current = counts.get(reason)
    if (current === undefined) {
      order.push(reason)
      counts.set(reason, 1)
    } else {
      counts.set(reason, current + 1)
    }
  }

  return {
    found: evaluated.length,
    eligible,
    rejected: evaluated.length - eligible,
    byReason: order.map((reason) => ({ reason, count: counts.get(reason) ?? 0 })),
  }
}

/** Dependencias da revisao. */
export interface ReviewDeps {
  readonly store: ReviewStorePort
  readonly now: () => Date
}

/** Endpoint logico das linhas de auditoria em `api_sync_logs`. */
export const PROMOTE_LOG_ENDPOINT = 'promote:watch_availability'
export const REVOKE_LOG_ENDPOINT = 'revoke:watch_availability'

/** Executa a revisao (read-only): lista, avalia e resume. */
export async function runReview(
  input: { readonly kind: string | null; readonly country: string; readonly entityId: string | null; readonly limit: number; readonly providerApi: string },
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const now = deps.now()
  const candidates = await deps.store.listCandidates({
    providerApi: input.providerApi,
    countryCode: input.country,
    entityType: input.kind,
    entityId: input.entityId,
    limit: input.limit,
  })

  const evaluated: EvaluatedCandidate[] = candidates.map((candidate) => {
    const decision = evaluatePromotionEligibility(candidate, { now })
    return { candidate, eligible: decision.eligible, reason: decision.reason }
  })

  return {
    kind: input.kind,
    country: input.country,
    entityId: input.entityId,
    evaluated,
    summary: summarize(evaluated),
  }
}

/** Dependencias da promocao/reversao. */
export interface PromotionDeps {
  readonly store: ReviewStorePort
  /** Log tecnico da acao (auditoria leve). So escrito quando muta. */
  readonly syncLog: SyncLogPort
  readonly now: () => Date
}

/**
 * Executa a promocao (ou reversao com `revoke`) por ids EXPLICITOS.
 *
 * Fluxo: busca as linhas dos ids -> avalia cada uma -> em `confirm`, muta apenas
 * as elegiveis e registra 1 linha de auditoria. Sem `confirm`, e dry-run puro:
 * o store de mutacao NUNCA e chamado.
 */
export async function runPromotion(
  input: {
    readonly ids: readonly string[]
    readonly country: string
    readonly confirm: boolean
    readonly revoke: boolean
  },
  deps: PromotionDeps,
): Promise<PromotionResult> {
  const now = deps.now()
  const found = await deps.store.findByIds(input.ids)

  const foundIds = new Set(found.map((row) => row.id))
  const idsMissing = input.ids.filter((id) => !foundIds.has(id))

  const evaluated: EvaluatedCandidate[] = found.map((candidate) => {
    const decision = input.revoke
      ? evaluateRevocationEligibility(candidate)
      : evaluatePromotionEligibility(candidate, { now })
    return { candidate, eligible: decision.eligible, reason: decision.reason }
  })

  const eligibleIds = evaluated.filter((entry) => entry.eligible).map((entry) => entry.candidate.id)

  let updated = 0
  if (input.confirm && eligibleIds.length > 0) {
    const outcome = input.revoke
      ? await deps.store.revoke(eligibleIds)
      : await deps.store.promote(eligibleIds)
    updated = outcome.updated

    // Auditoria leve: 1 linha tecnica por acao efetiva (todo mutacao gera log).
    await deps.syncLog.write({
      endpoint: input.revoke ? REVOKE_LOG_ENDPOINT : PROMOTE_LOG_ENDPOINT,
      status: updated > 0 ? 'success' : 'empty',
      itemsProcessed: eligibleIds.length,
      itemsUpdated: updated,
    })
  }

  return {
    mode: input.revoke ? 'revoke' : 'promote',
    confirm: input.confirm,
    country: input.country,
    idsRequested: input.ids,
    idsFound: found.map((row) => row.id),
    idsMissing,
    evaluated,
    eligibleIds,
    updated,
    summary: summarize(evaluated),
  }
}
