/**
 * worker-lifecycle.ts — Encerramento gracioso e orcamento de lease. PURO.
 *
 * DOIS PROBLEMAS QUE PARECEM UM SO.
 *
 * 1. SIGTERM no meio de um ciclo. O orquestrador manda o sinal e espera alguns
 *    segundos antes do SIGKILL. Se o worker reclamar eventos NOVOS nessa janela,
 *    eles morrem com lease aberta e ficam presos ate ela expirar — atraso puro,
 *    sem ganho nenhum. A regra: depois do sinal, TERMINE o que ja foi
 *    reclamado e nao reclame mais nada.
 *
 * 2. Trabalho maior que a lease. Se um evento demora mais do que o lease dura,
 *    outro worker o reclama e os dois projetam ao mesmo tempo. Como nao ha
 *    renovacao de lease no protocolo da outbox, a defesa e nao COMECAR trabalho
 *    que provavelmente nao cabe no tempo restante.
 */

export type ShutdownPhase = 'running' | 'draining' | 'stopped'

export interface ShutdownState {
  readonly phase: ShutdownPhase
  /** Instante do primeiro sinal, para medir a drenagem. */
  readonly signalledAtIso: string | null
}

export const INITIAL_SHUTDOWN: ShutdownState = { phase: 'running', signalledAtIso: null }

/**
 * Aplica um sinal de encerramento.
 *
 * O SEGUNDO sinal NAO acelera nada aqui — quem insiste em `Ctrl+C` espera o
 * processo morrer, e o orquestrador ja tem o SIGKILL para isso. Encurtar a
 * drenagem no segundo sinal deixaria eventos com lease aberta justamente no
 * caso em que alguem esta com pressa.
 */
export function applyShutdownSignal(state: ShutdownState, nowIso: string): ShutdownState {
  if (state.phase !== 'running') return state
  return { phase: 'draining', signalledAtIso: nowIso }
}

/** Pode reclamar um lote NOVO? Somente enquanto ninguem pediu para parar. */
export function mayClaimMore(state: ShutdownState): boolean {
  return state.phase === 'running'
}

/** O ciclo atual deve ser terminado mesmo em drenagem — nunca abandonado. */
export function mustFinishCurrentBatch(state: ShutdownState): boolean {
  return state.phase !== 'stopped'
}

export interface LeaseBudget {
  readonly leaseMs: number
  /** Margem para ack/fail depois do trabalho terminar. */
  readonly safetyMarginMs: number
}

export const DEFAULT_LEASE_BUDGET: LeaseBudget = {
  leaseMs: 60_000,
  // 10s cobrem o ack, o refresh do modelo derivado e uma rede lenta.
  safetyMarginMs: 10_000,
}

/**
 * Ainda ha tempo de lease para COMECAR mais um evento?
 *
 * Chamado antes de cada item do lote. Sem isto, um lote de 10 eventos com uma
 * lease de 60s comecaria o decimo faltando 2s — e o trabalho terminaria depois
 * de outro worker ja ter reclamado o mesmo evento.
 */
export function hasLeaseBudget(input: {
  readonly claimedAtIso: string
  readonly nowIso: string
  readonly budget?: LeaseBudget
  /** Duracao observada do item mais lento ate agora, quando conhecida. */
  readonly estimatedItemMs?: number
}): boolean {
  const budget = input.budget ?? DEFAULT_LEASE_BUDGET
  const claimedAt = Date.parse(input.claimedAtIso)
  const now = Date.parse(input.nowIso)
  // Relogio ilegivel: fail-closed. Continuar as cegas e o unico desfecho que
  // pode causar projecao dupla.
  if (!Number.isFinite(claimedAt) || !Number.isFinite(now)) return false

  const elapsed = now - claimedAt
  const remaining = budget.leaseMs - elapsed - budget.safetyMarginMs
  const needed = input.estimatedItemMs ?? 0
  return remaining > needed
}

/**
 * Tempo maximo de espera pela drenagem.
 *
 * Fica abaixo do `stopGracePeriod` tipico do orquestrador (30s) de proposito:
 * queremos sair por decisao propria, com as leases devolvidas, e nao por
 * SIGKILL no meio de uma escrita.
 */
export const DRAIN_TIMEOUT_MS = 25_000

export function drainExceeded(state: ShutdownState, nowIso: string): boolean {
  if (state.signalledAtIso === null) return false
  const signalled = Date.parse(state.signalledAtIso)
  const now = Date.parse(nowIso)
  if (!Number.isFinite(signalled) || !Number.isFinite(now)) return true
  return now - signalled >= DRAIN_TIMEOUT_MS
}
