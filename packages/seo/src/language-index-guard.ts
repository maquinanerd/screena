/**
 * language-index-guard.ts — Trava de indexacao por idioma (invariantes 7/9).
 *
 * Modulo PURO. Materializa, na fronteira de aplicacao, a regra que o schema
 * nao trava sozinho: uma pagina so pode receber `decision = 'index'` se o
 * idioma publica/indexa por padrao (languages.index_default = true) OU se ha
 * uma regra EXPLICITA de revisao aprovando aquela versao.
 *
 * No MVP, apenas pt-BR tem index_default = true; en/es nascem draft/noindex e
 * so passam a index apos revisao humana registrada. Sem esta trava, um worker
 * poderia gravar decision='index' para en/es por engano.
 */

/**
 * Decisao registrada em page_indexability_decisions (inclui 'stale', que e
 * fruto de invalidacao posterior — por isso e mais amplo que o resultado de
 * evaluateIndexability).
 */
export type PageDecision = "index" | "noindex" | "draft" | "stale" | "blocked";

/**
 * Entrada da trava de idioma para uma decisao de indexabilidade.
 */
export interface LanguageIndexGateInput {
  /** Decisao proposta para a pagina. */
  readonly decision: PageDecision;
  /** languages.index_default do idioma da pagina (so pt-BR = true no MVP). */
  readonly languageIndexDefault: boolean;
  /** Regra explicita de revisao aprovando a indexacao deste idioma (en/es revisado). */
  readonly hasExplicitReviewApproval?: boolean;
}

/**
 * True quando a decisao de indexabilidade e PERMITIDA para o idioma.
 *
 * Regra: qualquer decisao diferente de 'index' e sempre permitida (nao indexa).
 * 'index' so e permitido se o idioma indexa por padrao OU ha aprovacao
 * explicita de revisao.
 */
export function isIndexDecisionAllowedForLanguage(input: LanguageIndexGateInput): boolean {
  if (input.decision !== "index") {
    return true;
  }
  return input.languageIndexDefault === true || input.hasExplicitReviewApproval === true;
}

/**
 * Versao "assercao": lanca Error quando a decisao 'index' e proibida para o
 * idioma (idioma nao-default sem aprovacao de revisao). Use na fronteira de
 * escrita de page_indexability_decisions.
 */
export function assertIndexDecisionForLanguage(input: LanguageIndexGateInput): void {
  if (!isIndexDecisionAllowedForLanguage(input)) {
    throw new Error(
      "decisao 'index' proibida: idioma nao indexa por padrao (index_default=false) e " +
        "nao ha aprovacao explicita de revisao (invariantes 7/9).",
    );
  }
}
