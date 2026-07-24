/**
 * Politica de INDEXABILIDADE das entidades de catalogo — camada que produz as
 * linhas de `page_indexability_decisions`.
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * `page_indexability_decisions` e LIDA pelo sitemap, pelos loaders publicos e
 * pelo resolver de SEO — e nunca foi ESCRITA por nenhum processo. Uma tabela
 * lida e nao escrita nao e um gate: e decoracao. As clausulas
 * `NOT EXISTS (... decision <> 'index')` espalhadas pelo sitemap nunca
 * excluiram uma linha sequer, porque nao ha linha nenhuma.
 *
 * Este modulo e o MOTOR da decisao. Ele nao decide sozinho a politica geral —
 * essa mora em `resolvePageSeo` (licenca -> idioma -> caso tecnico -> index) e
 * continua sendo a fonte unica. O que este modulo acrescenta e o que
 * `resolvePageSeo` nao tem como saber: os gates ESPECIFICOS de cada tipo de
 * entidade do catalogo.
 *
 *   filme/serie : precisa de slug canonico e de titulo
 *   temporada   : herda a serie — serie nao publicavel, temporada nao publicavel
 *   episodio    : idem, pela serie
 *   pessoa      : precisa de credito em obra publicavel (ver `person-eligibility`)
 *
 * DETERMINISMO: a mesma entidade no mesmo estado produz SEMPRE a mesma decisao
 * e a mesma razao. E isso que permite ao produtor detectar "nada mudou" e nao
 * gravar uma linha nova — sem determinismo, cada execucao viraria churn.
 *
 * NAO LIGA INDEXACAO. Produzir a decisao e registrar o que a politica diz; a
 * chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada e e uma
 * decisao humana separada.
 *
 * MODULO PURO: sem banco, sem rede, sem relogio.
 */

import { evaluatePersonEligibility } from "./person-eligibility.js";
import { resolvePageSeo, type DisplayedRating } from "./resolver.js";

/**
 * Versao da politica, gravada em `policy_version`.
 *
 * Mudou a regra? Suba a versao. E o que permite distinguir "a entidade mudou"
 * de "a regra mudou" ao auditar por que uma decisao virou outra.
 */
export const CATALOG_POLICY_VERSION = "catalog-indexability-v1";

/** Origem gravada em `decision_origin`. */
export const CATALOG_DECISION_ORIGIN = "catalog_policy_engine";

/** Tipos de entidade de catalogo que recebem decisao. */
export type CatalogDecisionEntityType = "movie" | "tv" | "season" | "episode" | "person";

/**
 * Razao ESTRUTURADA da decisao. String livre em `reason` seria impossivel de
 * agregar no censo ("quantas bloqueadas por falta de slug?").
 */
export type CatalogDecisionReason =
  | "eligible"
  | "missing_slug"
  | "missing_title"
  | "missing_translation"
  | "no_eligible_credit"
  | "parent_not_publishable"
  | "language_not_published"
  | "blocked_license"
  | "insufficient_data";

/** Fatos ja apurados sobre UMA entidade. */
export interface CatalogEntityFacts {
  readonly entityType: CatalogDecisionEntityType;
  readonly language: string;
  /** Existe slug canonico no idioma? Para temporada/episodio, o da serie. */
  readonly hasCanonicalSlug: boolean;
  /** Titulo/nome nao vazio. */
  readonly hasTitle: boolean;
  /** Existe linha em `entity_translations` no idioma. */
  readonly hasTranslation: boolean;
  /**
   * Creditos em obra publicavel. So consultado para `person`; ver
   * `person-eligibility.ts` para a regra e o porque.
   */
  readonly publishableCreditCount?: number;
  /** Para temporada/episodio: a SERIE dona e publicavel? */
  readonly parentPublishable?: boolean;
  /** Ratings exibidos, com flag de licenca (invariante 6). */
  readonly displayedRatings?: readonly DisplayedRating[];
}

/** Decisao produzida, pronta para virar linha de `page_indexability_decisions`. */
export interface CatalogIndexabilityDecision {
  readonly decision: "index" | "noindex" | "draft" | "blocked";
  readonly reason: CatalogDecisionReason;
  /** Texto humano estavel (log, censo, auditoria). */
  readonly explanation: string;
  readonly policyVersion: string;
  readonly origin: string;
}

function decided(
  decision: CatalogIndexabilityDecision["decision"],
  reason: CatalogDecisionReason,
  explanation: string,
): CatalogIndexabilityDecision {
  return {
    decision,
    reason,
    explanation,
    policyVersion: CATALOG_POLICY_VERSION,
    origin: CATALOG_DECISION_ORIGIN,
  };
}

/**
 * Decide a indexabilidade de UMA entidade de catalogo.
 *
 * PRECEDENCIA (do mais restritivo ao menos), alinhada com `resolvePageSeo`:
 *
 *   1. licenca bloqueada            -> blocked   (invariante 6)
 *   2. idioma nao publicado         -> draft     (invariante 7)
 *   3. caso tecnico (slug/titulo)   -> noindex
 *   4. gate especifico do tipo      -> noindex
 *   5. caso contrario               -> index     (invariante 5, indexacao total)
 *
 * Os passos 1 e 2 vem da fonte unica; 3 e 4 sao o que este modulo acrescenta.
 */
export function decideCatalogIndexability(
  facts: CatalogEntityFacts,
): CatalogIndexabilityDecision {
  // (1) e (2): delega a fonte unica. `hasReliableStructuredData` recebe os
  // gates tecnicos deste modulo para que a precedencia seja avaliada de uma vez
  // so — licenca e idioma continuam vencendo o caso tecnico.
  const technicallyValid = facts.hasCanonicalSlug && facts.hasTitle;
  const shared = resolvePageSeo({
    language: facts.language,
    hasReliableStructuredData: technicallyValid,
    displayedRatings: [...(facts.displayedRatings ?? [])],
    valueBlocksCount: 0,
    thinContentScore: 0,
    reviewStatusOk: true,
    isPublished: true,
    explicitlyExcluded: false,
    isStale: false,
  });

  if (shared.decision === "blocked") {
    return decided("blocked", "blocked_license", shared.reason);
  }
  if (shared.decision === "draft") {
    return decided("draft", "language_not_published", shared.reason);
  }

  // (3) caso tecnico: sem rota ou sem titulo nao ha pagina que sustente index.
  if (!facts.hasCanonicalSlug) {
    return decided(
      "noindex",
      "missing_slug",
      "entidade sem slug canonico no idioma: nao ha rota publica.",
    );
  }
  if (!facts.hasTitle) {
    return decided(
      "noindex",
      "missing_title",
      "entidade sem titulo: nao sustenta H1, metadata nem schema.",
    );
  }

  // (4) gates especificos por tipo.
  if (facts.entityType === "person") {
    const eligibility = evaluatePersonEligibility({
      name: facts.hasTitle ? "x" : "",
      hasCanonicalSlug: facts.hasCanonicalSlug,
      publishableCreditCount: facts.publishableCreditCount ?? 0,
    });
    if (!eligibility.eligible) {
      return decided("noindex", "no_eligible_credit", eligibility.explanation);
    }
  }
  if (facts.entityType === "season" || facts.entityType === "episode") {
    if (facts.parentPublishable !== true) {
      return decided(
        "noindex",
        "parent_not_publishable",
        "a serie dona nao e publicavel: temporada/episodio herda a exclusao.",
      );
    }
  }
  if (!facts.hasTranslation) {
    // Traducao ausente nao e caso tecnico duro (a ficha crua ainda renderiza),
    // mas indexar pagina sem o texto do idioma e publicar meia pagina.
    return decided(
      "noindex",
      "missing_translation",
      "entidade sem traducao no idioma: a pagina indexaria sem o texto localizado.",
    );
  }

  // (5) indexacao total.
  return decided("index", "eligible", shared.reason);
}

/**
 * Uma decisao ANTERIOR ja persistida, para comparacao.
 */
export interface PersistedCatalogDecision {
  readonly decision: string;
  readonly reason: string | null;
  readonly policyVersion: string | null;
}

/**
 * True quando a decisao nova difere da persistida e portanto PRECISA de uma
 * linha nova.
 *
 * Compara decisao, razao E versao da politica: se so a versao mudou, o registro
 * precisa ser reemitido mesmo com o mesmo veredito — e assim que se audita
 * "esta decisao foi tomada sob qual regra?". Sem essa comparacao o produtor
 * gravaria uma linha por execucao (churn) ou nunca atualizaria (mentira).
 */
export function decisionChanged(
  next: CatalogIndexabilityDecision,
  previous: PersistedCatalogDecision | null,
): boolean {
  if (previous === null) return true;
  return (
    previous.decision !== next.decision ||
    previous.reason !== next.reason ||
    previous.policyVersion !== next.policyVersion
  );
}
