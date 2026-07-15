/**
 * indexability.ts — Adaptador de compatibilidade sobre a FONTE UNICA
 * (`resolvePageSeo` em `resolver.ts`).
 *
 * Historicamente `evaluateIndexability` era o motor da decisao. A partir do
 * Prompt 3 (SEO como fonte unica de verdade) o motor passou a ser
 * `resolvePageSeo`, que devolve o contrato completo (robots + sitemap +
 * canonical + policy). Este modulo permanece como ADAPTADOR fino para nao
 * quebrar os consumidores existentes (paginas, presenters, testes de
 * governanca): mesma assinatura, mesma decisao, agora derivada do resolver.
 *
 * Invariantes preservadas (5/6/7). Puro e determinista: sem rede, banco, IO,
 * `Date` ou `Math.random`.
 */

import { resolvePageSeo, type DisplayedRating } from "./resolver.js";

/**
 * Limiar historico de "thin content". NAO gate mais indexacao (invariante 5,
 * politica 2026-07). Mantido apenas como sinal informativo de qualidade.
 */
export const THIN_THRESHOLD = 0.5;

/**
 * Entrada agregada para a decisao de indexabilidade de uma pagina (forma
 * historica; mapeada 1:1 para `PageSeoFacts` do resolver).
 */
export interface IndexabilityInput {
  /** Codigo de idioma da pagina, ex.: 'pt-BR', 'pt', 'en', 'es'. */
  language: string;
  /** Dados estruturados confiaveis presentes. `false` => noindex tecnico. */
  hasReliableStructuredData: boolean;
  /** Blocos de valor proprios (informativo — NAO gate). */
  valueBlocksCount: number;
  /** Ratings exibidos, cada um com seu flag de licenca. */
  displayedRatings: DisplayedRating[];
  /** Pontuacao de conteudo fino 0..1 (informativo — NAO gate). */
  thinContentScore: number;
  /** review_status publicavel (informativo — NAO gate). */
  reviewStatusOk: boolean;
}

/**
 * Decisao final de indexabilidade (forma historica, 4 valores). O resolver
 * produz o superset com `stale`; este adaptador nunca gera `stale` porque a
 * entrada historica nao carrega invalidacao.
 */
export type IndexabilityDecision = "index" | "noindex" | "draft" | "blocked";

/** Resultado detalhado (forma historica). */
export interface IndexabilityResult {
  /** Decisao final aplicavel a pagina. */
  decision: IndexabilityDecision;
  /** Motivo legivel (pt-BR). */
  reason: string;
  /** Informativo: pagina com >= 2 blocos de valor proprios. NAO gate. */
  hasUniqueValue: boolean;
  /** Informativo: nenhum rating exibido com licenca bloqueada. */
  allRatingsLicensed: boolean;
}

/**
 * Avalia a indexabilidade de uma pagina (adaptador sobre `resolvePageSeo`).
 *
 * Precedencia herdada da fonte unica: licenca bloqueada -> `blocked`; idioma
 * fora de PUBLISHED_LOCALES -> `draft`; caso tecnico -> `noindex`; caso
 * contrario -> `index` (indexacao total).
 *
 * Pura e determinista.
 */
export function evaluateIndexability(input: IndexabilityInput): IndexabilityResult {
  const resolution = resolvePageSeo({
    language: input.language,
    hasReliableStructuredData: input.hasReliableStructuredData,
    displayedRatings: input.displayedRatings,
    valueBlocksCount: input.valueBlocksCount,
    thinContentScore: input.thinContentScore,
    reviewStatusOk: input.reviewStatusOk,
    // A forma historica nao carrega estes fatos: sempre publicada, nunca
    // excluida/invalidada, e nunca noticia (o gate de atribuicao roda fora).
    isPublished: true,
    explicitlyExcluded: false,
    isStale: false,
  });
  return {
    // `stale` nunca ocorre por este caminho; o superset colapsa nos 4 valores.
    decision: resolution.decision as IndexabilityDecision,
    reason: resolution.reason,
    hasUniqueValue: resolution.hasUniqueValue,
    allRatingsLicensed: resolution.allRatingsLicensed,
  };
}
