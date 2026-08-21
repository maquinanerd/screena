/**
 * stalled.ts — FILA PARADA E DEFEITO, e defeito silencioso e o pior tipo.
 *
 * Nucleo PURO do alerta. Recebe o mesmo `QueueSchedule[]` que o painel usa e
 * devolve os alertas; quem os emite (log estruturado, `/status`, readiness) sao
 * os adapters. A DECISAO tem teste sem banco e sem relogio.
 *
 * ============================================================================
 * O LIMIAR, E POR QUE ELE E 2x
 * ============================================================================
 * Uma fila vencida NAO e um alerta: o agendador acorda em ciclos e sempre ha
 * algo vencido por alguns minutos. Alertar em `overdueRatio > 0` produziria
 * ruido constante, e alerta que grita sempre e alerta que ninguem le.
 *
 * `2x o intervalo` significa: a fila perdeu DUAS janelas inteiras. Uma janela
 * perdida cabe em manutencao, deploy ou um upstream fora do ar por algumas
 * horas; duas seguidas nao acontecem por acaso. E o limiar que o dono pediu, e
 * ele e o mesmo para todas as filas porque e RELATIVO ao intervalo de cada uma:
 * 2h para a fila de 1h, 60 dias para a mensal.
 *
 * ============================================================================
 * NUNCA-RODOU E ALERTA, MAS DE OUTRO TIPO
 * ============================================================================
 * `never_ran` e `stalled` pedem acoes diferentes: o primeiro e "isto nunca foi
 * ligado" (config/deploy), o segundo e "isto parou de funcionar" (upstream,
 * cota, crash). Colapsa-los no mesmo rotulo mandaria o operador procurar uma
 * queda que nunca houve.
 *
 * PORA: uma fila nunca-rodada so vira alerta depois de uma CARENCIA
 * (`graceHours`). Sem isso, todo deploy novo nasceria com onze alertas
 * vermelhos — e um painel que nasce vermelho ensina o dono a ignorar vermelho.
 */

import type { QueueSchedule } from './due.js'
import type { SchedulerQueue } from './rhythms.js'

/** Multiplo do intervalo a partir do qual a fila e considerada PARADA. */
export const STALL_THRESHOLD_RATIO = 2

/**
 * Carencia, em horas, para uma fila que nunca rodou.
 *
 * 6h: cabe uma subida, uma migracao e um primeiro ciclo de qualquer fila cujo
 * intervalo seja menor que isso, sem pintar o painel de vermelho no deploy.
 */
export const NEVER_RAN_GRACE_HOURS = 6

const HOUR_MS = 60 * 60 * 1000

/** Por que a fila esta em alerta. */
export type StallKind = 'never_ran' | 'stalled'

/** Um alerta de fila parada. */
export interface StallAlert {
  readonly queue: SchedulerQueue
  readonly kind: StallKind
  /** Atraso em multiplos do intervalo. `Infinity` em `never_ran`. */
  readonly overdueRatio: number
  readonly intervalHours: number
  readonly lastSuccessAt: Date | null
  /** Uma linha pronta para o log e para a tela. Nunca vazia. */
  readonly message: string
}

/** Fatos externos de que o alerta precisa e que o `QueueSchedule` nao carrega. */
export interface StallContext {
  readonly now: Date
  /**
   * Quando ESTE processo subiu. A carencia de `never_ran` conta a partir daqui:
   * um container que subiu ha 2 minutos nao pode acusar fila parada.
   */
  readonly startedAt: Date
}

function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'infinito'
  return `${(ratio + 1).toFixed(1)}x o intervalo`
}

/**
 * Os alertas, a partir das filas ja avaliadas.
 *
 * Devolve LISTA (possivelmente vazia), nunca lanca: um alerta que derruba o
 * processo transformaria "uma fila parou" em "tudo parou".
 */
export function detectStalledQueues(
  schedules: readonly QueueSchedule[],
  context: StallContext,
): readonly StallAlert[] {
  const uptimeHours = (context.now.getTime() - context.startedAt.getTime()) / HOUR_MS
  const alerts: StallAlert[] = []

  for (const entry of schedules) {
    if (entry.lastSuccessAt === null) {
      if (uptimeHours < NEVER_RAN_GRACE_HOURS) continue
      alerts.push({
        queue: entry.queue,
        kind: 'never_ran',
        overdueRatio: Number.POSITIVE_INFINITY,
        intervalHours: entry.intervalHours,
        lastSuccessAt: null,
        message:
          `fila "${entry.queue}" NUNCA rodou com sucesso, e o processo esta de pe ha ` +
          `${uptimeHours.toFixed(1)}h (carencia de ${NEVER_RAN_GRACE_HOURS}h vencida). ` +
          `Intervalo declarado: ${entry.intervalHours}h.`,
      })
      continue
    }

    if (entry.overdueRatio + 1 < STALL_THRESHOLD_RATIO) continue

    alerts.push({
      queue: entry.queue,
      kind: 'stalled',
      overdueRatio: entry.overdueRatio,
      intervalHours: entry.intervalHours,
      lastSuccessAt: entry.lastSuccessAt,
      message:
        `fila "${entry.queue}" PARADA: ultimo sucesso em ` +
        `${entry.lastSuccessAt.toISOString()}, ou seja ${formatRatio(entry.overdueRatio)} ` +
        `de ${entry.intervalHours}h. Limiar: ${STALL_THRESHOLD_RATIO}x.`,
    })
  }

  return alerts
}

/** O destino de um alerta. O servico passa o proprio logger estruturado. */
export interface StallAlertSink {
  log(level: 'error', event: string, fields: Record<string, unknown>): void
}

/** O nome do evento. Fixo: e por ele que se filtra o log e se monta o aviso. */
export const STALL_ALERT_EVENT = 'scheduler_queue_stalled'

/**
 * EMITE os alertas. Uma linha `error` por fila em alerta.
 *
 * Existe como funcao (em vez de tres linhas dentro do laco do servico) por um
 * motivo so: para ter TESTE. O requisito do dono e "teste que reprova se o
 * alerta nao sair", e um alerta que so existe dentro de um `while (true)` de um
 * bin nao tem como reprovar coisa nenhuma.
 *
 * Devolve quantos saiu: o chamador registra o numero na readiness, e um alerta
 * que nao sai vira um zero visivel em vez de silencio.
 */
export function emitStallAlerts(
  alerts: readonly StallAlert[],
  sink: StallAlertSink,
): number {
  for (const alert of alerts) {
    sink.log('error', STALL_ALERT_EVENT, {
      queue: alert.queue,
      kind: alert.kind,
      // `Infinity` nao sobrevive a JSON.stringify (vira `null`). Converter aqui,
      // explicitamente, evita um campo que aparece como `null` sem que ninguem
      // saiba se e "infinito" ou "nao medido".
      overdueRatio: Number.isFinite(alert.overdueRatio) ? alert.overdueRatio : null,
      intervalHours: alert.intervalHours,
      lastSuccessAt: alert.lastSuccessAt === null ? null : alert.lastSuccessAt.toISOString(),
      message: alert.message,
    })
  }
  return alerts.length
}
