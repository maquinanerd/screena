/**
 * rating-freshness.ts — Avaliacao PURA de frescor de uma nota externa.
 *
 * Sem rede, sem banco, sem relogio proprio: `now` e sempre injetado, para que o
 * teste possa provar cada fronteira em vez de esperar 30 dias.
 *
 * Por que isto e uma decisao de EXIBICAO, e nao so de agendamento: um trigger
 * so dispara em escrita. Uma nota aprovada em 1º de janeiro continua com
 * `display_allowed = true` para sempre, porque o tempo passar nao e um UPDATE.
 * O guard do banco e a trava de ESCRITA; este modulo e o relogio que o caminho
 * de LEITURA aplica. Os dois sao necessarios — nenhum substitui o outro.
 *
 * Ver RATING_STALE_POLICY em @screena/config para as janelas e a justificativa
 * de cada valor.
 */

import {
  RATING_STALE_POLICY,
  type RatingStalePolicy,
  type RatingStalePolicySource,
} from "@screena/config";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Estado de frescor de uma nota.
 *
 * - `fresh` — dentro da janela de refresh; exibivel.
 * - `needs_refresh` — passou de `refreshAfterHours` mas nao de
 *   `expireAfterHours`. Ainda EXIBIVEL: o dado e valido, so vale reconferir.
 *   Confundir "vale reconferir" com "invalido" tiraria notas boas do ar a cada
 *   atraso de worker.
 * - `expired` — passou de `expireAfterHours`. NAO exibivel: apresentar essa
 *   nota seria afirmar um frescor que nao temos.
 * - `unknown-policy` — a fonte nao tem janela declarada. NAO exibivel (nao
 *   chutamos janela).
 * - `unknown-fetch` — sem `fetchedAt` confiavel. NAO exibivel: sem saber quando
 *   coletamos, nao ha como afirmar que a nota vale.
 */
export type RatingFreshnessState =
  | "fresh"
  | "needs_refresh"
  | "expired"
  | "unknown-policy"
  | "unknown-fetch";

/** Entrada da avaliacao de frescor. */
export interface RatingFreshnessInput {
  readonly ratingSource: string;
  /** Momento da coleta. `null` quando desconhecido. */
  readonly fetchedAt: Date | null;
  /** Relogio injetado (nunca `new Date()` aqui dentro). */
  readonly now: Date;
}

/** Resultado da avaliacao de frescor. */
export interface RatingFreshnessResult {
  readonly state: RatingFreshnessState;
  /** `true` so em `fresh` e `needs_refresh`. */
  readonly displayable: boolean;
  /** Idade em horas na avaliacao; `null` sem `fetchedAt`. */
  readonly ageHours: number | null;
  /** Momento a partir do qual vale re-sync; `null` sem politica/coleta. */
  readonly refreshDueAt: Date | null;
  /** Momento a partir do qual a nota expira; `null` sem politica/coleta. */
  readonly expiresAt: Date | null;
}

/** Politica declarada da fonte, ou `null` quando nao ha. */
export function resolveRatingStalePolicy(ratingSource: string): RatingStalePolicy | null {
  if (!Object.prototype.hasOwnProperty.call(RATING_STALE_POLICY, ratingSource)) return null;
  return RATING_STALE_POLICY[ratingSource as RatingStalePolicySource];
}

/**
 * `stale_after` da nota = coleta + `refreshAfterHours` (a janela de re-sync,
 * conforme .claude/rules/ingestion.md). Devolve `null` quando nao ha politica
 * ou coleta — e o chamador NAO deve inventar um carimbo nesse caso.
 */
export function computeRatingStaleAfter(ratingSource: string, fetchedAt: Date | null): Date | null {
  const policy = resolveRatingStalePolicy(ratingSource);
  if (policy === null || fetchedAt === null) return null;
  return new Date(fetchedAt.getTime() + policy.refreshAfterHours * HOUR_MS);
}

/** Avalia o frescor de uma nota contra a politica versionada da sua fonte. */
export function evaluateRatingFreshness(input: RatingFreshnessInput): RatingFreshnessResult {
  const policy = resolveRatingStalePolicy(input.ratingSource);
  if (policy === null) {
    return {
      state: "unknown-policy",
      displayable: false,
      ageHours: null,
      refreshDueAt: null,
      expiresAt: null,
    };
  }
  if (input.fetchedAt === null || !Number.isFinite(input.fetchedAt.getTime())) {
    return {
      state: "unknown-fetch",
      displayable: false,
      ageHours: null,
      refreshDueAt: null,
      expiresAt: null,
    };
  }

  const fetchedMs = input.fetchedAt.getTime();
  const refreshDueAt = new Date(fetchedMs + policy.refreshAfterHours * HOUR_MS);
  const expiresAt = new Date(fetchedMs + policy.expireAfterHours * HOUR_MS);
  const ageHours = (input.now.getTime() - fetchedMs) / HOUR_MS;

  // Coleta no futuro (relogio torto do upstream / bug de parse) e tratada como
  // desconhecida: idade negativa nao e "fresquissimo", e sinal de dado errado.
  if (ageHours < 0) {
    return { state: "unknown-fetch", displayable: false, ageHours, refreshDueAt, expiresAt };
  }

  // Fronteiras: `>=` em ambas. Exatamente na hora de expirar, ja expirou.
  if (input.now.getTime() >= expiresAt.getTime()) {
    return { state: "expired", displayable: false, ageHours, refreshDueAt, expiresAt };
  }
  if (input.now.getTime() >= refreshDueAt.getTime()) {
    return { state: "needs_refresh", displayable: true, ageHours, refreshDueAt, expiresAt };
  }
  return { state: "fresh", displayable: true, ageHours, refreshDueAt, expiresAt };
}
