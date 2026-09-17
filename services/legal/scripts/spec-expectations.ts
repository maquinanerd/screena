/**
 * spec-expectations.ts — O que o `STATIC_AUTHORIZATION` VIGENTE declara, em
 * contagens, para os validadores de banco real conferirem.
 *
 * POR QUE ISTO EXISTE. `validate-source-authorization-supersede.ts` e
 * `validate-source-authorization-legacy-grants.ts` nasceram em 2026-08-12 com as
 * contagens de producao escritas como literais: 8 licencas vigentes, 13
 * decisoes, 5 `rating_display`/BR, 10 decisoes legadas, plano
 * supersede=5/keep=3/create=10. Batiam com o spec daquele dia (47634d8) — e
 * deixaram de bater sem ninguem ver, porque nenhum dos dois roda na CI:
 *
 *   - 86b9996 (2026-08-13) Letterboxd e FilmAffinity perdem a exibicao: -2 decisoes `rating_display`;
 *   - 2f6996e (2026-08-13) a premiacao ganha licenca e decisao: +1 licenca, +1 decisao;
 *   - 3d6250a (2026-08-14) o video do TMDB ganha licenca e decisao: +1 licenca, +1 decisao;
 *   - 3eb22ed (2026-08-20) o IMDb ganha a decisao `cinerie_score_display`: +1 decisao.
 *
 * Em 2026-09-16 os dois reprovavam (11/16 e 10/18) so por contagem, com o laco
 * de escrita correto. Trocar 8 por 10 adiaria a proxima reprovacao falsa para a
 * proxima mudanca de licenca. Com a contagem saindo do spec, a expectativa muda
 * junto com a licenca, e o que continua reprovando e o que o spec NAO explica:
 * defeito do laco, do plano ou do banco.
 *
 * Nao decide licenca nenhuma e nao le banco: so conta o que o spec declara.
 */

import {
  CINERIE_TERRITORY,
  type AuthorizationEntry,
  type DecisionTarget,
} from "../src/authorization-spec.js";

export interface SpecExpectations {
  /** Uma licenca vigente por entrada. */
  readonly licenses: number;
  /** Decisoes de todas as entradas. */
  readonly decisions: number;
  /** Decisoes `rating_display` no territorio do produto com `display_allowed`. */
  readonly ratingDisplayBR: number;
  /** Decisoes `rating_display`, em qualquer territorio. */
  readonly ratingDisplay: number;
  /** Licencas de `rating`: uma por fonte editorial declarada, exibivel ou revogada. */
  readonly ratingLicenses: number;
  /** Decisoes penduradas nas licencas de `rating`. */
  readonly ratingDecisions: number;
  /** Das decisoes de `rating`, as que concedem algo (display, storage ou derivada). */
  readonly ratingGrants: number;
}

const isRatingDisplay = (d: DecisionTarget): boolean => d.useCase === "rating_display";

export function specExpectations(entries: readonly AuthorizationEntry[]): SpecExpectations {
  const decisions = entries.flatMap((e) => e.decisions);
  const rating = entries.filter((e) => e.license.contentType === "rating");
  const ratingDecisions = rating.flatMap((e) => e.decisions);
  return {
    licenses: entries.length,
    decisions: decisions.length,
    ratingDisplayBR: decisions.filter(
      (d) => isRatingDisplay(d) && d.territory === CINERIE_TERRITORY && d.displayAllowed,
    ).length,
    ratingDisplay: decisions.filter(isRatingDisplay).length,
    ratingLicenses: rating.length,
    ratingDecisions: ratingDecisions.length,
    ratingGrants: ratingDecisions.filter((d) => d.displayAllowed || d.storageAllowed || d.derivativeAllowed)
      .length,
  };
}

/** Uma linha, impressa antes dos checks: de onde saem os numeros esperados. */
export function describeSpecExpectations(e: SpecExpectations): string {
  return (
    `[spec] STATIC_AUTHORIZATION vigente: ${e.licenses} licencas (${e.ratingLicenses} de rating), ` +
    `${e.decisions} decisoes (${e.ratingDecisions} sob rating, ${e.ratingGrants} delas concedendo), ` +
    `${e.ratingDisplayBR} rating_display/${CINERIE_TERRITORY} display=true`
  );
}
