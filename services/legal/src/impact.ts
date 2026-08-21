/**
 * impact.ts — QUANTAS linhas esta leva vai ocultar, dito ANTES de escrever.
 *
 * POR QUE ESTE MODULO EXISTE. O `review` de 2026-08-20 imprimiu
 * `licencas: create=0 supersede=72 keep=4` e nada mais. O operador leu um plano
 * que parecia inofensivo — "72 licencas ganham versao nova" — e apertou
 * `--confirm`. O que o plano NAO disse foi o unico numero que importava: 453
 * notas e 874 ofertas iam sair da tela naquele mesmo comando.
 *
 * Um plano que nao diz quantas linhas vai ocultar nao e um plano. Este modulo e
 * a parte PURA dessa conta: recebe o plano ja calculado e um censo das linhas
 * penduradas em cada decisao (lido do banco por `readDecisionBindings`, em
 * `apply.ts`) e devolve, separados, o que e CARREGADO para a licenca nova e o
 * que e OCULTADO — com o motivo, fonte a fonte.
 *
 * Puro de proposito: sem Prisma, sem rede, testavel sem banco.
 */

import type { AuthorizationPlan, DecisionCarry, EntryPlan } from "./plan.js";

/** Censo de UMA decisao: quantas linhas exibiveis apontam para ela hoje. */
export interface DecisionBinding {
  /** `external_ratings` com `display_allowed = true`. */
  readonly ratings: number;
  /** `watch_availability` com `display_allowed = true`. */
  readonly offers: number;
}

/** Uma decisao que sai de cena levando linhas junto (para o bem ou para o mal). */
export interface ImpactedDecision {
  readonly label: string;
  readonly useCase: string;
  readonly territory: string | null;
  readonly fromDecisionId: string;
  readonly ratings: number;
  readonly offers: number;
  /** Vazio quando `carried`. */
  readonly reason: string;
}

export interface AuthorizationImpact {
  /** Linhas que passam a apontar para a decisao nova (continuam na tela). */
  readonly carried: readonly ImpactedDecision[];
  /** Linhas que NINGUEM assume: saem da tela quando o apply escrever. */
  readonly hidden: readonly ImpactedDecision[];
  readonly summary: {
    readonly carriedRatings: number;
    readonly carriedOffers: number;
    readonly hiddenRatings: number;
    readonly hiddenOffers: number;
  };
}

const EMPTY: DecisionBinding = { ratings: 0, offers: 0 };

function impacted(entry: EntryPlan, carry: DecisionCarry, binding: DecisionBinding): ImpactedDecision {
  return {
    label: entry.label,
    useCase: carry.useCase,
    territory: carry.territory,
    fromDecisionId: carry.fromDecisionId,
    ratings: binding.ratings,
    offers: binding.offers,
    reason: carry.reason,
  };
}

/**
 * Cruza o plano com o censo de linhas. Decisoes sem nenhuma linha pendurada nao
 * entram no relatorio — o operador precisa ver o que MUDA na tela, nao as 60
 * decisoes de `storage` que nunca tiveram dado apontando para elas.
 */
export function planAuthorizationImpact(
  plan: AuthorizationPlan,
  bindings: ReadonlyMap<string, DecisionBinding>,
): AuthorizationImpact {
  const carried: ImpactedDecision[] = [];
  const hidden: ImpactedDecision[] = [];
  const summary = { carriedRatings: 0, carriedOffers: 0, hiddenRatings: 0, hiddenOffers: 0 };

  for (const entry of plan.entries) {
    for (const carry of entry.carries) {
      const binding = bindings.get(carry.fromDecisionId) ?? EMPTY;
      if (binding.ratings === 0 && binding.offers === 0) continue;
      const row = impacted(entry, carry, binding);
      if (carry.verdict === "carry") {
        carried.push(row);
        summary.carriedRatings += binding.ratings;
        summary.carriedOffers += binding.offers;
      } else {
        hidden.push(row);
        summary.hiddenRatings += binding.ratings;
        summary.hiddenOffers += binding.offers;
      }
    }
  }

  return { carried, hidden, summary };
}

/** `true` quando esta leva tira alguma coisa da tela. */
export function impactHidesRows(impact: AuthorizationImpact): boolean {
  return impact.summary.hiddenRatings > 0 || impact.summary.hiddenOffers > 0;
}
