/**
 * types.ts — Contratos do Cinerie Score.
 *
 * ATENCAO — leia antes de mexer: NAO existe formula aqui, e isso e deliberado.
 * Escala, fontes, pesos, tratamento de critics vs audience, votos minimos,
 * ausencia de fonte, arredondamento e explicacao sao decisao de PRODUTO,
 * humana, pendente em docs/product/cinerie-score-decision.md. Inventar
 * qualquer um desses numeros aqui produziria uma nota que ninguem aprovou e
 * que o usuario leria como se fosse editorial. Enquanto a decisao nao existir,
 * o engine devolve `blocked_by_decision` — que e um resultado de PRIMEIRA
 * CLASSE, nao um erro.
 */

/** Uma nota de entrada do calculo, ja licenciada. */
export interface CinerieScoreRatingInput {
  /** Fonte editorial (imdb, rotten_tomatoes, ...). Nunca o provider tecnico. */
  readonly source: string;
  /** Natureza da nota: critics | audience | editorial. */
  readonly type: string;
  /** Valor na escala da PROPRIA fonte (nunca reescalado na entrada). */
  readonly value: number;
  /** Denominador da escala da fonte (imdb=10, rotten_tomatoes=100, ...). */
  readonly best: number;
  /** Votos/criticas. `null` = desconhecido — nunca zero fabricado. */
  readonly count: number | null;
  /**
   * DataUsageDecision que autoriza DERIVAR desta nota. Obrigatorio: uma nota
   * sem decisao de uso nao entra no calculo (seria derivar de dado que ninguem
   * autorizou derivar).
   */
  readonly licenseDecisionId: string;
}

/** Entrada completa do calculo para uma entidade. */
export interface CinerieScoreInput {
  readonly entityId: string;
  readonly ratings: readonly CinerieScoreRatingInput[];
}

/** Contribuicao de uma fonte ao resultado (a "explicacao" exigida). */
export interface CinerieScoreExplanationEntry {
  readonly source: string;
  readonly normalized: number;
  readonly weight: number;
}

/** Resultado de um calculo BEM-SUCEDIDO. */
export interface CinerieScoreResult {
  readonly value: number;
  readonly scale: number;
  readonly version: string;
  readonly inputsHash: string;
  readonly explanation: readonly CinerieScoreExplanationEntry[];
  /** ISO-8601. */
  readonly calculatedAt: string;
}

/**
 * Por que um calculo foi bloqueado. Todos colapsam para o status de banco
 * `blocked_by_decision`, mas o motivo especifico e o que torna o bloqueio
 * diagnosticavel em vez de misterioso.
 */
export type CinerieScoreBlockedReason =
  /** Nao ha DataUsageDecision para `cinerie_score_display`. O estado de hoje. */
  | "no-decision"
  /** Ha decisao, mas nao e a vigente. */
  | "decision-not-current"
  /** A decisao existe mas nao chegou a `approved_for_display`. */
  | "decision-stage-not-approved"
  /** A decisao nao autoriza obra derivada (o Cinerie Score e derivado). */
  | "decision-derivative-not-allowed"
  /** A decisao esta fora da vigencia (ainda nao valida ou ja expirada). */
  | "decision-out-of-validity"
  /** A decisao aprovou uma versao de formula que nao esta registrada. */
  | "formula-not-registered"
  /** Alguma nota de entrada nao carrega decisao de uso. */
  | "rating-without-license-decision";

/** Resultado de um calculo BLOQUEADO. */
export interface CinerieScoreBlocked {
  readonly status: "blocked_by_decision";
  readonly reason: CinerieScoreBlockedReason;
  /** Texto humano para `cinerie_score_calculations.blocked_reason`. */
  readonly blockedReason: string;
  readonly version: string;
  readonly inputsHash: string;
  readonly calculatedAt: string;
}

/** Resultado de um calculo REALIZADO. */
export interface CinerieScoreCalculated {
  readonly status: "calculated";
  readonly result: CinerieScoreResult;
}

/** Saida do engine: sempre um dos dois, nunca excecao por falta de decisao. */
export type CinerieScoreOutcome = CinerieScoreCalculated | CinerieScoreBlocked;

/**
 * A decisao de uso que autoriza (ou nao) calcular e exibir o Cinerie Score.
 * Espelha `data_usage_decisions` — o engine nao consulta o banco; quem chama
 * projeta a linha para ca.
 */
export interface CinerieScoreDecisionInput {
  readonly useCase: string;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly isCurrent: boolean;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
  /**
   * Versao da formula que ESTA decisao aprovou (`data_usage_decisions.policy_version`).
   * E o elo de versionamento: nao se calcula com uma formula que a decisao nao
   * aprovou. Trocar a formula exige nova decisao — nunca um deploy silencioso.
   */
  readonly policyVersion: string;
}

/** Uma formula versionada. O registro de producao esta VAZIO de proposito. */
export interface CinerieScoreFormula {
  readonly version: string;
  compute(
    input: CinerieScoreInput,
    context: { readonly inputsHash: string; readonly now: Date },
  ): CinerieScoreResult;
}
