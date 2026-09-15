/**
 * lap.ts — A VOLTA de uma fila: quantos dias ela leva para passar pelo universo
 * inteiro dela. Modulo PURO.
 *
 * ============================================================================
 * POR QUE A VOLTA, E NAO O INTERVALO
 * ============================================================================
 * O intervalo diz quando a fila ACORDA. A volta diz quando ela TERMINA. Uma fila
 * "diaria" com teto de 200 sobre um universo de 67 mil leva 336 dias para fechar
 * — e o painel do EasyPanel dizia verde, porque ela acordava todo dia. Duas
 * filas deste projeto estiveram exatamente assim.
 *
 * Esta formula ja vivia dentro de um teste (`batch-limit.test.ts`), onde nao
 * servia a ninguem que abre o painel. Mora aqui para que o teste e a tela usem
 * a MESMA conta.
 *
 * ============================================================================
 * TRES RESPOSTAS QUE NAO SAO NUMERO, E NENHUMA DELAS E ZERO
 * ============================================================================
 *  - `not_applicable`: a fila nao tem universo que se percorra (trending sao 4
 *    listas; o `/changes` e uma janela). Dizer "0 dias" seria mentira confortavel.
 *  - `undeterminable`: o universo existe e NAO esta no banco (o export diario do
 *    TMDB), ou o teto nao pode ser lido daqui.
 *  - `never`: o teto e zero. A volta nao fecha nunca.
 */

/** Acima disto a volta sai em VERMELHO. Decisao do dono (2026-09-15). */
export const LAP_ALERT_DAYS = 30

/** O universo de uma fila, como o painel o mediu. */
export type LapUniverse =
  | { readonly kind: 'counted'; readonly items: number }
  | { readonly kind: 'not_applicable'; readonly reason: string }
  | { readonly kind: 'undeterminable'; readonly reason: string }

/** Entrada da conta. */
export interface LapInput {
  readonly universe: LapUniverse
  /** Itens por ciclo. `null` = nao foi possivel saber. */
  readonly perCycle: number | null
  /** Horas entre ciclos. */
  readonly intervalHours: number
}

/** A volta. */
export type LapResult =
  | {
      readonly kind: 'days'
      readonly days: number
      readonly perDay: number
      /** `true` acima de {@link LAP_ALERT_DAYS}. */
      readonly alert: boolean
    }
  | { readonly kind: 'never'; readonly reason: string }
  | { readonly kind: 'not_applicable'; readonly reason: string }
  | { readonly kind: 'undeterminable'; readonly reason: string }

/** Dias para uma volta: `universo / (teto * ciclos por dia)`. */
export function lapDays(universe: number, perCycle: number, intervalHours: number): number {
  const cyclesPerDay = 24 / intervalHours
  return universe / (perCycle * cyclesPerDay)
}

/**
 * A volta de uma fila. Nunca lanca, nunca devolve NaN nem Infinity em `days`.
 */
export function computeLap(input: LapInput): LapResult {
  if (input.universe.kind !== 'counted') return input.universe
  if (input.perCycle === null) {
    return { kind: 'undeterminable', reason: 'o teto por ciclo nao pode ser apurado' }
  }
  if (!Number.isFinite(input.intervalHours) || input.intervalHours <= 0) {
    return { kind: 'undeterminable', reason: 'intervalo da fila invalido' }
  }
  const items = Math.max(0, input.universe.items)
  const perDay = input.perCycle * (24 / input.intervalHours)
  if (items === 0) return { kind: 'days', days: 0, perDay, alert: false }
  if (!Number.isFinite(input.perCycle) || input.perCycle <= 0) {
    return { kind: 'never', reason: 'teto por ciclo zero: a volta nao fecha' }
  }
  const days = lapDays(items, input.perCycle, input.intervalHours)
  return { kind: 'days', days, perDay, alert: days > LAP_ALERT_DAYS }
}

/**
 * A volta MEDIDA: universo sobre o ritmo observado (itens por dia).
 *
 * Existe porque o teto global do agendador e variavel do `screen-cron` e nao se
 * le de fora dele. O que se le e o que a fila de fato fez.
 */
export function computeMeasuredLap(universe: LapUniverse, observedPerDay: number | null): LapResult {
  if (universe.kind !== 'counted') return universe
  if (observedPerDay === null) {
    return { kind: 'undeterminable', reason: 'nenhuma execucao registrada na janela medida' }
  }
  const items = Math.max(0, universe.items)
  if (items === 0) return { kind: 'days', days: 0, perDay: observedPerDay, alert: false }
  if (!Number.isFinite(observedPerDay) || observedPerDay <= 0) {
    return { kind: 'never', reason: 'a fila nao processou nada na janela medida' }
  }
  const days = items / observedPerDay
  return { kind: 'days', days, perDay: observedPerDay, alert: days > LAP_ALERT_DAYS }
}
