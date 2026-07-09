/**
 * changes-plan.ts — Contrato do incremental via `/changes` do TMDB. Modulo PURO.
 *
 * O TMDB expoe listas de mudancas para `movie`, `tv` e `person`
 * (`/movie/changes`, `/tv/changes`, `/person/changes`) numa janela de datas
 * (default ~24h, maximo 14 dias). Este modulo MONTA o plano de requests; NAO
 * executa nada — o sync raw incremental e P0-00d. Os demais tipos de descoberta
 * (collection/network/company/keyword) NAO tem endpoint de `/changes`; para
 * eles, so o snapshot diario dos Daily ID Exports os cobre.
 */

import type { TmdbDiscoveryKind } from './id-exports.js'

/** Tipos que possuem endpoint de `/changes` no TMDB. */
export type ChangesKind = Extract<TmdbDiscoveryKind, 'movie' | 'tv' | 'person'>

/** Tipos suportados pelo incremental (`/changes`). */
export const CHANGES_KINDS: readonly ChangesKind[] = ['movie', 'tv', 'person']

/** Janela maxima aceita pelo TMDB em `/changes` (14 dias). */
export const CHANGES_MAX_WINDOW_DAYS = 14

/** Janela default do incremental (24h). */
export const CHANGES_DEFAULT_WINDOW_DAYS = 1

/** Plano de UMA request de changes: path + janela `start_date`/`end_date` (YYYY-MM-DD). */
export interface ChangesRequestPlan {
  readonly kind: ChangesKind
  readonly path: string
  readonly startDate: string
  readonly endDate: string
}

/** Formata a data (em UTC) como `YYYY-MM-DD` (formato aceito pelo `/changes`). */
export function formatChangesDate(date: Date): string {
  const yyyy = String(date.getUTCFullYear())
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Monta o plano de requests de `/changes` para a janela `[start, end]`. PURO e
 * NAO executa. Lanca se `end < start` ou se a janela exceder o maximo do TMDB
 * (14 dias) — o chamador nunca deve montar uma janela invalida.
 */
export function planChangesRequests(
  start: Date,
  end: Date,
  kinds: readonly ChangesKind[] = CHANGES_KINDS,
): ChangesRequestPlan[] {
  const spanMs = end.getTime() - start.getTime()
  if (spanMs < 0) {
    throw new Error('planChangesRequests: `end` anterior a `start`.')
  }
  const spanDays = spanMs / (24 * 60 * 60 * 1000)
  if (spanDays > CHANGES_MAX_WINDOW_DAYS) {
    throw new Error(
      `planChangesRequests: janela de ${spanDays} dias excede o maximo de ${CHANGES_MAX_WINDOW_DAYS} dias do TMDB.`,
    )
  }

  const startDate = formatChangesDate(start)
  const endDate = formatChangesDate(end)
  return kinds.map((kind) => ({
    kind,
    path: `/${kind}/changes`,
    startDate,
    endDate,
  }))
}
