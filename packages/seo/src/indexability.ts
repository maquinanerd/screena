/**
 * Decisao de indexabilidade (gate anti-thin + governanca de licenca/idioma).
 *
 * Reune as invariantes que decidem se uma pagina publica pode ser indexada:
 *
 *  - Invariante 5: pagina fina recebe noindex. Sem >= 2 blocos de valor proprios
 *    (alem de dado cru de API), estrutura confiavel e baixo thin score, nao indexa.
 *  - Invariante 6: dados sem licenca clara (display_allowed=false) nao aparecem em
 *    pagina indexavel. Qualquer rating bloqueado torna a pagina 'blocked'.
 *  - Invariante 7: pt-BR publica primeiro; en/es nascem em draft/noindex ate
 *    revisao humana.
 *
 * Funcoes puras e deterministas: sem rede, banco, IO, Date ou Math.random.
 */

/**
 * Limiar de "thin content". Paginas com thinContentScore acima deste valor sao
 * consideradas finas demais para indexar (mesmo cumprindo os demais requisitos).
 * Escala assumida: 0 (rico) a 1 (totalmente fino).
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
  /** Schema.org / dados estruturados confiaveis estao presentes e validos. */
  hasReliableStructuredData: boolean;
  /** Quantidade de blocos de valor proprios distintos (ver countValueBlocks). */
  valueBlocksCount: number;
  /** Ratings exibidos na pagina, cada um com seu flag de licenca. */
  displayedRatings: DisplayedRating[];
  /** Pontuacao de conteudo fino: 0 (rico) a 1 (fino). Comparada a THIN_THRESHOLD. */
  thinContentScore: number;
  /** review_status dos content_blocks esta em estado permitido para publicar. */
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
  /** True se a pagina tem >= 2 blocos de valor proprios (gate anti-thin). */
  hasUniqueValue: boolean;
  /** True se nenhum rating exibido tem licenca bloqueada (display_allowed=false). */
  allRatingsLicensed: boolean;
}

/**
 * Numero minimo de blocos de valor proprios para uma pagina nao ser considerada
 * fina (invariante 5).
 */
const MIN_VALUE_BLOCKS = 2;

/**
 * Codigos de idioma que publicam primeiro no MVP (invariante 7).
 */
const PUBLISH_FIRST_LANGUAGES: ReadonlySet<string> = new Set(["pt-BR", "pt"]);

/**
 * Avalia a indexabilidade de uma pagina aplicando as invariantes 5, 6 e 7.
 *
 * Ordem de precedencia (do mais restritivo ao menos):
 *  1. Algum rating com licenca bloqueada  -> 'blocked' (invariante 6).
 *  2. Idioma fora de pt-BR/pt             -> 'draft'   (invariante 7).
 *  3. Gate anti-thin satisfeito           -> 'index'   (invariante 5).
 *  4. Caso contrario                      -> 'noindex' (invariante 5), com
 *     motivo apontando o requisito que faltou.
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

  // 2. Invariante 7: en/es (qualquer idioma != pt-BR/pt) nascem em draft/noindex.
  if (!PUBLISH_FIRST_LANGUAGES.has(input.language)) {
    return {
      decision: "draft",
      reason: `Idioma '${input.language}' nao publica primeiro no MVP; nasce em draft/noindex ate revisao humana (invariante 7).`,
      hasUniqueValue,
      allRatingsLicensed,
    };
  }

  // 3. Gate anti-thin (invariante 5): so indexa se todos os requisitos baterem.
  const meetsStructuredData = input.hasReliableStructuredData;
  const meetsValueBlocks = hasUniqueValue;
  const meetsThin = input.thinContentScore <= THIN_THRESHOLD;
  const meetsReview = input.reviewStatusOk;

  if (meetsStructuredData && meetsValueBlocks && meetsThin && meetsReview) {
    return {
      decision: "index",
      reason:
        "Dados estruturados confiaveis, >= 2 blocos de valor proprios, conteudo nao fino e review_status permitido — pagina indexavel (invariante 5).",
      hasUniqueValue,
      allRatingsLicensed,
    };
  }

  // 4. Pagina fina/incompleta: noindex com motivo do primeiro requisito faltante.
  const missing: string[] = [];
  if (!meetsStructuredData) {
    missing.push("dados estruturados confiaveis ausentes");
  }
  if (!meetsValueBlocks) {
    missing.push(
      `menos de ${MIN_VALUE_BLOCKS} blocos de valor proprios (atual: ${input.valueBlocksCount})`,
    );
  }
  if (!meetsThin) {
    missing.push(
      `thinContentScore ${input.thinContentScore} acima do limiar ${THIN_THRESHOLD}`,
    );
  }
  if (!meetsReview) {
    missing.push("review_status nao permitido para publicar");
  }

  return {
    decision: "noindex",
    reason: `Pagina fina/incompleta — nao indexa (invariante 5). Faltou: ${missing.join("; ")}.`,
    hasUniqueValue,
    allRatingsLicensed,
  };
}
