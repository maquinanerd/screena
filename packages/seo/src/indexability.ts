/**
 * Decisao de indexabilidade (governanca de licenca/idioma + indexacao total).
 *
 * Reune as invariantes que decidem se uma pagina publica pode ser indexada:
 *
 *  - Invariante 5 (politica 2026-07): INDEXACAO TOTAL. Toda entidade
 *    sincronizada e indexada; `noindex` fica so para casos tecnicos (404, erro,
 *    entidade sem slug/traducao/dados estruturados confiaveis). Conteudo
 *    editorial proprio (blocos de valor) deixou de ser pre-requisito de
 *    indexacao e passou a ser alavanca de qualidade/ranqueamento.
 *  - Invariante 6: dados sem licenca clara (display_allowed=false) nao aparecem
 *    em pagina indexavel. Qualquer rating bloqueado torna a pagina 'blocked'.
 *  - Invariante 7 (politica 2026-07): pt-BR publica primeiro; en/es publicam e
 *    indexam quando completos, controlados por PUBLISHED_LOCALES. Um locale fora
 *    de PUBLISHED_LOCALES resolve para 'draft' (ainda nao completo), nunca por
 *    ser "estrangeiro".
 *
 * Funcoes puras e deterministas: sem rede, banco, IO, Date ou Math.random.
 */

import { PUBLISHED_LOCALES } from "@screena/config";

/**
 * Limiar historico de "thin content". NAO gate mais indexacao (invariante 5,
 * politica 2026-07 — indexacao total). Mantido apenas como sinal informativo de
 * qualidade/ranqueamento; a decisao de `index` nao depende dele.
 */
export const THIN_THRESHOLD = 0.5;

/**
 * Rating exibido na pagina, com o flag de licenca relevante para indexabilidade.
 * Espelha a coluna display_allowed de external_ratings / source_licenses.
 */
export interface DisplayedRating {
  /** Mapeia external_ratings.display_allowed / source_licenses.display_allowed. */
  licenseDisplayAllowed: boolean;
}

/**
 * Entrada agregada para a decisao de indexabilidade de uma pagina.
 *
 * Todos os campos ja vem resolvidos pelo chamador (a partir do PostgreSQL):
 * esta funcao nao consulta nada, apenas aplica as regras.
 */
export interface IndexabilityInput {
  /** Codigo de idioma da pagina, ex.: 'pt-BR', 'pt', 'en', 'es'. */
  language: string;
  /**
   * Dados estruturados confiaveis (slug/traducao/schema.org validos) estao
   * presentes. `false` = caso tecnico (entidade sem slug/traducao) -> noindex.
   */
  hasReliableStructuredData: boolean;
  /**
   * Quantidade de blocos de valor proprios distintos (ver countValueBlocks).
   * Informativo (sinal de qualidade/ranqueamento) — NAO gate mais a indexacao.
   */
  valueBlocksCount: number;
  /** Ratings exibidos na pagina, cada um com seu flag de licenca. */
  displayedRatings: DisplayedRating[];
  /**
   * Pontuacao de conteudo fino: 0 (rico) a 1 (fino). Informativo — NAO gate mais
   * a indexacao (invariante 5, politica 2026-07).
   */
  thinContentScore: number;
  /**
   * review_status dos content_blocks esta em estado permitido para publicar.
   * Informativo para exibicao de blocos — NAO gate mais a indexacao da pagina.
   */
  reviewStatusOk: boolean;
}

/**
 * Decisao final de indexabilidade.
 *
 * Espelha page_indexability_decisions: 'index' | 'noindex' | 'draft' | 'blocked'.
 * ('stale' nao e produzido por esta funcao; e fruto de invalidacao posterior.)
 */
export type IndexabilityDecision = "index" | "noindex" | "draft" | "blocked";

/**
 * Resultado detalhado da avaliacao de indexabilidade.
 */
export interface IndexabilityResult {
  /** Decisao final aplicavel a pagina. */
  decision: IndexabilityDecision;
  /** Motivo legivel (pt-BR) explicando a decisao — util para logs/auditoria. */
  reason: string;
  /**
   * True se a pagina tem >= 2 blocos de valor proprios. Sinal informativo de
   * qualidade — NAO decide mais indexacao (invariante 5, politica 2026-07).
   */
  hasUniqueValue: boolean;
  /** True se nenhum rating exibido tem licenca bloqueada (display_allowed=false). */
  allRatingsLicensed: boolean;
}

/**
 * Numero de blocos de valor proprios a partir do qual a pagina e considerada
 * "rica" (sinal informativo `hasUniqueValue`). Nao e mais gate de indexacao.
 */
const MIN_VALUE_BLOCKS = 2;

/**
 * Locales publicados/indexaveis (invariante 7, politica 2026-07). Fonte de
 * verdade: PUBLISHED_LOCALES em @screena/config. Um locale fora deste conjunto
 * resolve para 'draft' (ainda nao completo).
 */
const PUBLISHED_LOCALE_SET: ReadonlySet<string> = new Set(PUBLISHED_LOCALES);

/**
 * Avalia a indexabilidade de uma pagina aplicando as invariantes 5, 6 e 7.
 *
 * Ordem de precedencia (do mais restritivo ao menos):
 *  1. Algum rating com licenca bloqueada     -> 'blocked' (invariante 6).
 *  2. Idioma fora de PUBLISHED_LOCALES        -> 'draft'   (invariante 7).
 *  3. Caso tecnico (sem dados estruturados
 *     confiaveis / sem slug / sem traducao)   -> 'noindex' (invariante 5).
 *  4. Caso contrario                          -> 'index'   (invariante 5:
 *     indexacao total — entidade sincronizada, licenciada e em idioma
 *     publicado indexa, independentemente da quantidade de blocos de valor).
 *
 * Pura e determinista: nao usa Date nem Math.random.
 */
export function evaluateIndexability(input: IndexabilityInput): IndexabilityResult {
  const allRatingsLicensed = input.displayedRatings.every(
    (rating) => rating.licenseDisplayAllowed,
  );
  const hasUniqueValue = input.valueBlocksCount >= MIN_VALUE_BLOCKS;

  // 1. Invariante 6: licenca bloqueada impede a pagina indexavel por completo.
  if (!allRatingsLicensed) {
    return {
      decision: "blocked",
      reason:
        "Ha pelo menos um rating exibido sem permissao de exibicao (display_allowed=false); invariante 6 impede pagina indexavel.",
      hasUniqueValue,
      allRatingsLicensed,
    };
  }

  // 2. Invariante 7: locale ainda nao publicado (fora de PUBLISHED_LOCALES).
  if (!PUBLISHED_LOCALE_SET.has(input.language)) {
    return {
      decision: "draft",
      reason: `Idioma '${input.language}' ainda nao esta em PUBLISHED_LOCALES; resolve em draft/noindex ate o idioma estar completo e revisado (invariante 7).`,
      hasUniqueValue,
      allRatingsLicensed,
    };
  }

  // 3. Caso tecnico: sem dados estruturados/slug/traducao confiaveis -> noindex.
  if (!input.hasReliableStructuredData) {
    return {
      decision: "noindex",
      reason:
        "Caso tecnico: entidade sem dados estruturados/slug/traducao confiaveis — nao indexa (invariante 5).",
      hasUniqueValue,
      allRatingsLicensed,
    };
  }

  // 4. Indexacao total (invariante 5, politica 2026-07): entidade sincronizada,
  //    licenciada e em idioma publicado indexa. Blocos de valor sao alavanca de
  //    ranqueamento, nao pre-requisito.
  return {
    decision: "index",
    reason:
      "Entidade sincronizada, licenciada e em idioma publicado — indexacao total (invariante 5, politica 2026-07). Conteudo editorial e alavanca de ranqueamento, nao pre-requisito.",
    hasUniqueValue,
    allRatingsLicensed,
  };
}
