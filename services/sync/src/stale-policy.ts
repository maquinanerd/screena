/**
 * stale-policy.ts — Politica de frescor (pura) da Screena.
 *
 * `stale_after = last_synced_at + janela`. Janela-alvo do catalogo geral:
 * 7-14 dias (ver .claude/rules/ingestion.md). Funcoes puras, sem rede/DB.
 */

/** Janela padrao de frescor do catalogo geral (7 dias, em ms). */
export const DEFAULT_STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** Calcula `stale_after` a partir de agora + janela. */
export function staleAfterFrom(now: Date, windowMs: number = DEFAULT_STALE_WINDOW_MS): Date {
  return new Date(now.getTime() + windowMs)
}

/** True se o registro esta stale (sem `stale_after` ou ja vencido). */
export function isStale(now: Date, staleAfter: Date | null): boolean {
  if (staleAfter === null) return true
  return now.getTime() > staleAfter.getTime()
}
