/**
 * due.ts — QUEM RODA AGORA, e em que ordem. Nucleo PURO do agendador.
 *
 * Recebe a tabela de ritmos, o ultimo sucesso de cada fila e `now`; devolve as
 * filas vencidas, ordenadas. Sem banco, sem rede, sem `new Date()` proprio —
 * cada fronteira de intervalo tem teste em vez de esperar um dia passar.
 *
 * ============================================================================
 * AS TRES DECISOES QUE ESTE MODULO TOMA
 * ============================================================================
 *
 * 1. FILA QUE NUNCA RODOU ESTA VENCIDA. `lastSuccessAt = null` nao e "espere um
 *    intervalo": e uma plataforma recem-subida que ainda nao sincronizou nada.
 *    Esperar 30 dias pela primeira execucao de `people` seria um mes de silencio
 *    indistinguivel de defeito.
 *
 * 2. A ORDEM E POR ATRASO RELATIVO, NAO POR INTERVALO. Uma fila diaria atrasada
 *    2 dias (200% do intervalo) vai na frente de uma mensal atrasada 3 dias
 *    (10%). Ordenar pelo atraso ABSOLUTO daria a vitoria eterna para a fila mais
 *    lenta; ordenar pelo intervalo daria para a mais rapida. O que importa e
 *    quem esta mais longe do proprio compromisso.
 *
 * 3. EMPATE SE RESOLVE PELA ORDEM DA TABELA, NUNCA PELO NOME. Duas filas nunca
 *    rodadas empatam em atraso infinito; desempatar por alfabeto colocaria
 *    `awards` na frente de `watch_offers` sem nenhuma razao. A ordem de `RHYTHMS`
 *    ja e a de urgencia declarada, do que estraga mais rapido para o que estraga
 *    mais devagar.
 */

import { activeAwardsWindows } from './awards-window.js'
import { effectiveIntervalHours, RHYTHMS, type Rhythm, type SchedulerQueue } from './rhythms.js'

const HOUR_MS = 60 * 60 * 1000

/** O ultimo sucesso de uma fila, como o adapter o leu. */
export interface QueueLastRun {
  readonly queue: SchedulerQueue
  /** Ultima execucao BEM-SUCEDIDA. `null` = nunca rodou. */
  readonly lastSuccessAt: Date | null
  /** Ultima tentativa, com ou sem sucesso. `null` = nunca tentou. */
  readonly lastAttemptAt: Date | null
}

/** Uma fila avaliada contra o relogio. */
export interface QueueSchedule {
  readonly queue: SchedulerQueue
  readonly rhythm: Rhythm
  /** Intervalo vigente (ja com a sazonalidade aplicada). */
  readonly intervalHours: number
  readonly lastSuccessAt: Date | null
  /** Quando a fila fica devida. `null` quando nunca rodou (devida agora). */
  readonly dueAt: Date | null
  readonly due: boolean
  /**
   * Atraso em MULTIPLOS do intervalo. `0` = em dia; `1` = um intervalo inteiro
   * atrasada; `Infinity` = nunca rodou.
   *
   * E este numero, e nao o atraso em horas, que ordena e que dispara o alerta.
   */
  readonly overdueRatio: number
  /** Por que o intervalo e este. Vazio quando nao ha nada sazonal em jogo. */
  readonly seasonNote: string
}

/** Entrada da avaliacao. */
export interface EvaluateInput {
  readonly now: Date
  readonly lastRuns: readonly QueueLastRun[]
  /** Permite testar um subconjunto; default = a tabela inteira. */
  readonly rhythms?: readonly Rhythm[]
}

function lastRunFor(
  lastRuns: readonly QueueLastRun[],
  queue: SchedulerQueue,
): QueueLastRun | undefined {
  return lastRuns.find((run) => run.queue === queue)
}

/**
 * Avalia TODAS as filas (nao so as devidas): o painel precisa mostrar tambem o
 * que esta em dia, senao "nada aparece" fica indistinguivel de "o agendador
 * morreu".
 */
export function evaluateSchedule(input: EvaluateInput): readonly QueueSchedule[] {
  const rhythms = input.rhythms ?? RHYTHMS
  const windows = activeAwardsWindows(input.now)
  const inSeason = windows.length > 0
  const seasonNames = windows.map((w) => w.name).join(', ')

  return rhythms.map((rhythm) => {
    const intervalHours = effectiveIntervalHours(rhythm, inSeason)
    const seasonNote =
      rhythm.cadence === 'seasonal'
        ? inSeason
          ? `janela ativa: ${seasonNames}`
          : 'fora de temporada'
        : ''

    const run = lastRunFor(input.lastRuns, rhythm.queue)
    const lastSuccessAt = run?.lastSuccessAt ?? null

    if (lastSuccessAt === null) {
      return {
        queue: rhythm.queue,
        rhythm,
        intervalHours,
        lastSuccessAt: null,
        dueAt: null,
        due: true,
        overdueRatio: Number.POSITIVE_INFINITY,
        seasonNote,
      }
    }

    const dueAt = new Date(lastSuccessAt.getTime() + intervalHours * HOUR_MS)
    const elapsedHours = (input.now.getTime() - lastSuccessAt.getTime()) / HOUR_MS
    // Fronteira `>=`: exatamente na hora de vencer, ja venceu.
    const due = input.now.getTime() >= dueAt.getTime()
    const overdueRatio = Math.max(0, elapsedHours / intervalHours - 1)

    return {
      queue: rhythm.queue,
      rhythm,
      intervalHours,
      lastSuccessAt,
      dueAt,
      due,
      overdueRatio,
      seasonNote,
    }
  })
}

/**
 * As filas devidas, da mais atrasada para a menos.
 *
 * `Infinity` (nunca rodou) fica no topo por construcao. O desempate e a posicao
 * na tabela — ver a decisao (3) no cabecalho.
 */
export function selectDueQueues(input: EvaluateInput): readonly QueueSchedule[] {
  const rhythms = input.rhythms ?? RHYTHMS
  const order = new Map(rhythms.map((rhythm, index) => [rhythm.queue, index]))
  return evaluateSchedule(input)
    .filter((entry) => entry.due)
    .sort((a, b) => {
      if (a.overdueRatio !== b.overdueRatio) return b.overdueRatio - a.overdueRatio
      return (order.get(a.queue) ?? 0) - (order.get(b.queue) ?? 0)
    })
}
