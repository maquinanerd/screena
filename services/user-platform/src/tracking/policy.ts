/**
 * Politica pura de tracking (Backend C, unidade C4).
 *
 * PURO: sem rede, sem DB, sem relogio. Constantes de politica + helpers de
 * progresso/conclusao/tolerancia + gate de mutacao por estado da conta.
 *
 * LACUNA REGISTRADA: as decisoes de produto e o schema NAO definem limiar de
 * conclusao automatica, tolerancia de posicao > duracao nem tolerancia de
 * evento futuro. Os valores abaixo sao POLITICA DE DOMINIO explicita (sem
 * campo persistente, sem migration), flagados para confirmacao humana e usados
 * pela MESMA fonte em codigo e teste (nunca numero magico espalhado).
 *
 * O gate de conta NAO duplica regra: delega para privacy/deletion.assertCanMutate
 * (funcao pura e estavel), que so libera conta `active`.
 */

import type { DomainResult } from "../core/result.js";
import { assertCanMutate } from "../privacy/deletion.js";
import type { UserStatus } from "../core/types.js";

// ---------------------------------------------------------------------------
// Constantes de politica (LACUNA — confirmar com humano)
// ---------------------------------------------------------------------------

/** Fracao de progresso a partir da qual um episodio pode ser auto-concluido. */
export const AUTO_COMPLETION_THRESHOLD_FRACTION = 0.95;

/** Tolerancia (segundos) para posicao ligeiramente acima da duracao (skew/arredondamento). */
export const OVER_DURATION_TOLERANCE_SECONDS = 5;

/** Tolerancia (segundos) para evento com occurredAt no futuro (clock skew do cliente). */
export const FUTURE_EVENT_TOLERANCE_SECONDS = 300;

// ---------------------------------------------------------------------------
// Gate de mutacao por estado da conta (reusa privacy; nao duplica)
// ---------------------------------------------------------------------------

/**
 * Toda mutacao de tracking exige conta `active`. Conta pending_deletion,
 * deleted ou disabled e bloqueada (fail-closed). Delegado a privacy.
 */
export function assertTrackingMutationAllowed(accountStatus: UserStatus): DomainResult<true> {
  return assertCanMutate(accountStatus);
}

// ---------------------------------------------------------------------------
// Progresso / conclusao / tolerancia (helpers puros)
// ---------------------------------------------------------------------------

/**
 * Fracao de progresso 0..1 (clampada). Sem duracao valida (null/<=0) => 0
 * (evita divisao por zero e NaN). Posicao acima da duracao clampa em 1.
 */
export function computeProgressFraction(
  progressSeconds: number | null,
  durationSeconds: number | null,
): number {
  if (
    progressSeconds === null ||
    durationSeconds === null ||
    !Number.isFinite(progressSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    progressSeconds <= 0
  ) {
    return 0;
  }
  return Math.min(1, progressSeconds / durationSeconds);
}

/**
 * true quando a posicao excede a duracao ALEM da tolerancia explicita. Dentro
 * da tolerancia e aceitavel (skew/arredondamento).
 */
export function exceedsOverDurationTolerance(
  progressSeconds: number,
  durationSeconds: number,
): boolean {
  return progressSeconds > durationSeconds + OVER_DURATION_TOLERANCE_SECONDS;
}

/**
 * true quando o progresso atinge o limiar de auto-conclusao. Fronteira
 * INCLUSIVA (fraction >= threshold). Sem duracao valida => false.
 */
export function reachesAutoCompletion(
  progressSeconds: number | null,
  durationSeconds: number | null,
): boolean {
  const fraction = computeProgressFraction(progressSeconds, durationSeconds);
  return durationSeconds !== null && durationSeconds > 0 && fraction >= AUTO_COMPLETION_THRESHOLD_FRACTION;
}

/**
 * true quando o evento esta no futuro ALEM da tolerancia em `now`. Eventos
 * dentro da tolerancia sao aceitos; muito no futuro sao rejeitados.
 */
export function isFutureBeyondTolerance(occurredAt: Date, now: Date): boolean {
  return occurredAt.getTime() > now.getTime() + FUTURE_EVENT_TOLERANCE_SECONDS * 1000;
}
