/**
 * run-outcome.ts — O DESFECHO DE UMA EXECUCAO, e a regra de falha parcial. PURO.
 *
 * ============================================================================
 * A REGRA: LOTE QUE PROCESSA 300 DE 500 NAO E "CONCLUIDO"
 * ============================================================================
 * Um lote que reporta sucesso porque nao lancou excecao e a falha silenciosa
 * classica desta plataforma: o operador ve "ok", a fila avanca o carimbo de
 * ultimo sucesso, e os 200 que faltaram desaparecem do mundo. No ciclo seguinte
 * eles ate voltam a ser candidatos — mas ninguem soube que ficaram para tras, e
 * ninguem soube POR QUE.
 *
 * Por isso `classifyRun` decide o status a partir das CONTAGENS, nunca da
 * ausencia de excecao:
 *
 *   processados == planejados  e  falhas == 0  -> `success`
 *   processados  > 0           e  faltou algo  -> `partial`  (e `partial` NAO
 *                                                 avanca `lastSuccessAt`)
 *   processados == 0           e  planejados>0 -> `failure`
 *   planejados  == 0                           -> `success` (nada a fazer e um
 *                                                 desfecho legitimo, e precisa
 *                                                 ser distinguivel de "quebrou")
 *
 * ============================================================================
 * POR QUE `partial` NAO AVANCA O ULTIMO SUCESSO
 * ============================================================================
 * Se avancasse, uma fila que processa 1 de 500 todo ciclo pareceria saudavel
 * para sempre e o alerta de fila parada NUNCA dispararia — o pior dos dois
 * mundos: nada funciona e o painel esta verde. Com `partial` sem avancar, a
 * fila envelhece, cruza o limiar de 2x e ACUSA.
 *
 * ============================================================================
 * MOTIVO OBRIGATORIO
 * ============================================================================
 * `partial` e `failure` exigem `reasons` nao-vazio. Um desfecho ruim sem motivo
 * e um desfecho que ninguem consegue agir sobre — e a construcao devolve um
 * motivo sintetico dizendo exatamente isso, em vez de aceitar o vazio.
 */

import type { SchedulerQueue } from './rhythms.js'

/** Status de uma execucao. */
export type RunStatus = 'success' | 'partial' | 'failure'

/** Uma razao contada. `count` agrega ocorrencias identicas. */
export interface RunReason {
  readonly code: string
  readonly detail: string
  readonly count: number
}

/** O que uma execucao gastou de cada fornecedor. */
export interface RunSpend {
  readonly providerApi: string
  readonly requests: number
}

/** O desfecho completo de uma execucao. */
export interface RunOutcome {
  readonly queue: SchedulerQueue
  readonly status: RunStatus
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly durationMs: number
  /** Quantas entidades o lote PRETENDIA tocar. */
  readonly planned: number
  /** Quantas realmente processou. */
  readonly processed: number
  /** Quantas falharam. */
  readonly failed: number
  /** Quantas foram puladas por politica (frescor, cota, escopo). */
  readonly skipped: number
  readonly spend: readonly RunSpend[]
  readonly reasons: readonly RunReason[]
  /** `true` so em `success`: e o unico caso que avanca o carimbo da fila. */
  readonly advancesLastSuccess: boolean
}

/** Os numeros crus de uma execucao, antes de virar desfecho. */
export interface RunTally {
  readonly queue: SchedulerQueue
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly planned: number
  readonly processed: number
  readonly failed: number
  readonly skipped: number
  readonly spend?: readonly RunSpend[]
  readonly reasons?: readonly RunReason[]
}

const MISSING_REASON: RunReason = {
  code: 'reason_not_reported',
  detail:
    'a execucao terminou incompleta e NAO reportou motivo. Isto e defeito do chamador: ' +
    'desfecho ruim sem motivo nao pode ser agido. Corrija quem chamou classifyRun.',
  count: 1,
}

/**
 * Classifica uma execucao. Determinista, sem relogio proprio.
 *
 * `processed + failed + skipped` nao precisa fechar com `planned`: um lote pode
 * terminar antes (circuito aberto, cota, shutdown). E justamente essa sobra que
 * caracteriza o parcial — por isso a comparacao e com `planned`, e nao uma
 * conferencia de soma.
 */
export function classifyRun(tally: RunTally): RunOutcome {
  const durationMs = Math.max(0, tally.finishedAt.getTime() - tally.startedAt.getTime())
  const spend = tally.spend ?? []
  const reported = tally.reasons ?? []

  const accountedFor = tally.processed + tally.failed + tally.skipped
  const complete = accountedFor >= tally.planned && tally.failed === 0

  let status: RunStatus
  if (tally.planned === 0) status = 'success'
  else if (complete) status = 'success'
  else if (tally.processed > 0 || tally.skipped > 0) status = 'partial'
  else status = 'failure'

  const reasons =
    status === 'success' ? reported : reported.length > 0 ? reported : [MISSING_REASON]

  return {
    queue: tally.queue,
    status,
    startedAt: tally.startedAt,
    finishedAt: tally.finishedAt,
    durationMs,
    planned: tally.planned,
    processed: tally.processed,
    failed: tally.failed,
    skipped: tally.skipped,
    spend,
    reasons,
    advancesLastSuccess: status === 'success',
  }
}

/**
 * Uma linha para o log/painel. NUNCA colapsa parcial em concluido.
 *
 * O texto e a barreira final contra o desfecho mudo: mesmo que alguem ignore o
 * campo `status`, a linha diz "300/500" e lista os motivos.
 */
export function describeRun(outcome: RunOutcome): string {
  const head =
    outcome.status === 'success'
      ? outcome.planned === 0
        ? 'nada a fazer'
        : `concluido ${outcome.processed}/${outcome.planned}`
      : outcome.status === 'partial'
        ? `INCOMPLETO ${outcome.processed}/${outcome.planned} (falhas ${outcome.failed}, pulados ${outcome.skipped})`
        : `FALHOU (0 de ${outcome.planned})`
  const spend =
    outcome.spend.length === 0
      ? 'cota: nenhuma'
      : `cota: ${outcome.spend.map((s) => `${s.providerApi}=${s.requests}`).join(' ')}`
  const reasons =
    outcome.reasons.length === 0
      ? ''
      : ` · motivos: ${outcome.reasons.map((r) => `${r.code}x${r.count}`).join(' ')}`
  return `${outcome.queue}: ${head} · ${outcome.durationMs}ms · ${spend}${reasons}`
}
