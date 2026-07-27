/**
 * article-publication.ts — FONTE UNICA da publicabilidade de um artigo editorial.
 *
 * Existe porque o mesmo gate e consumido por superficies que nao se enxergam:
 * a listagem `/pt/noticias/`, a pagina `/pt/noticias/[slug]/`, o bloco de
 * noticias relacionadas em filme/serie/pessoa, o sitemap, a projecao de busca
 * e o produtor de `page_indexability_decisions`. Antes deste modulo a regra
 * vivia so no presenter do app; qualquer consumidor novo (busca, indexability)
 * teria que reimplementa-la — e uma reimplementacao divergente e exatamente
 * como um rascunho ou uma materia agendada vaza para o publico.
 *
 * PURO e determinista: sem rede, banco, IO, `Date.now()` ou `Math.random()`.
 * O instante de avaliacao e sempre INJETADO (`nowIso`), o que torna o gate
 * testavel no tempo e impede que o relogio do processo vire dependencia oculta.
 *
 * Governanca:
 *  - Invariante 5 (indexacao total): artigo publicado indexa; `noindex` fica
 *    para caso tecnico. Este modulo decide PUBLICABILIDADE (a materia existe
 *    publicamente?), nao ranqueamento.
 *  - Invariante 6 (licenca): `license_status` unknown/blocked ou
 *    `display_allowed=false` derruba o artigo em qualquer superficie publica.
 *  - Atribuicao/linkback exigidos pela licenca sao parte do gate: sem credito,
 *    nao publica.
 */

/** Motivo unico e estavel pelo qual um artigo NAO e publicavel. */
export type ArticleUnpublishableReason =
  | "not_published"
  | "future_scheduled"
  | "missing_slug"
  | "missing_headline"
  | "missing_publication_date"
  | "blocked_license"
  | "display_not_allowed"
  | "missing_required_attribution"
  | "missing_required_linkback"
  | "retracted";

/** Fatos necessarios para decidir se um artigo e publicavel. */
export interface ArticlePublicationInput {
  /** `review_status` da traducao (ArticleTranslation.reviewStatus). */
  readonly reviewStatus: string;
  /** `license_status` do artigo (Article.licenseStatus). */
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly slug: string | null;
  readonly title: string | null;
  /** Data de publicacao efetiva (traducao, com fallback para o artigo). */
  readonly publishedAtIso: string | null;
  readonly requiresAttribution?: boolean;
  readonly requiresLinkback?: boolean;
  readonly sourceName?: string | null;
  readonly sourceUrl?: string | null;
}

export interface ArticlePublicationVerdict {
  readonly publishable: boolean;
  /** Vazio quando publicavel; ordenado e estavel quando nao. */
  readonly reasons: readonly ArticleUnpublishableReason[];
}

/**
 * `review_status` que uma traducao precisa ter para aparecer publicamente.
 * Deliberadamente restrito: `draft`, `ai_generated`, `needs_review` e
 * `needs_update` sao trabalho em andamento; `blocked` e `archived` sao os
 * estados de RETRATACAO/despublicacao e nunca voltam a superficie publica.
 */
export const PUBLICLY_RENDERABLE_ARTICLE_REVIEW_STATUSES = [
  "human_reviewed",
  "published",
] as const;

/** `review_status` que representam retirada editorial deliberada. */
export const RETRACTED_ARTICLE_REVIEW_STATUSES = ["blocked", "archived"] as const;

/** `license_status` que permitem exibir o artigo (invariante 6). */
const DISPLAYABLE_LICENSE_STATUSES = ["official", "licensed", "third_party"] as const;

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Converte um ISO para epoch ms, ou `null` se nao for uma data valida.
 * String vazia, lixo e `Invalid Date` caem todos em `null` — e o chamador
 * trata ausencia de data como NAO publicavel (fail-closed).
 */
function epochMs(iso: string | null): number | null {
  const trimmed = trimToNull(iso);
  if (trimmed === null) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Avalia a publicabilidade de um artigo NO INSTANTE `nowIso`.
 *
 * A regra do agendamento e o ponto mais facil de errar: uma materia com
 * `published_at` no FUTURO tem data preenchida e review `published`, entao um
 * gate que so pergunta "tem data?" a considera publicavel e vaza o embargo.
 * Aqui a data precisa ser <= agora. Igualdade publica (o instante exato de
 * publicacao ja e publico).
 *
 * `nowIso` invalido e tratado como fail-closed: sem instante confiavel para
 * comparar, nenhum artigo com data e liberado.
 */
export function evaluateArticlePublication(
  input: ArticlePublicationInput,
  nowIso: string,
): ArticlePublicationVerdict {
  const reasons: ArticleUnpublishableReason[] = [];

  if (isRetractedArticleReviewStatus(input.reviewStatus)) {
    reasons.push("retracted");
  } else if (!isPubliclyRenderableArticleReviewStatus(input.reviewStatus)) {
    reasons.push("not_published");
  }

  if (!DISPLAYABLE_LICENSE_STATUSES.includes(input.licenseStatus as never)) {
    reasons.push("blocked_license");
  }
  if (input.displayAllowed !== true) reasons.push("display_not_allowed");
  if (trimToNull(input.slug) === null) reasons.push("missing_slug");
  if (trimToNull(input.title) === null) reasons.push("missing_headline");

  const publishedMs = epochMs(input.publishedAtIso);
  const nowMs = epochMs(nowIso);
  if (publishedMs === null) {
    reasons.push("missing_publication_date");
  } else if (nowMs === null || publishedMs > nowMs) {
    // Sem relogio confiavel OU data no futuro: embargo mantido.
    reasons.push("future_scheduled");
  }

  if (input.requiresAttribution === true && trimToNull(input.sourceName) === null) {
    reasons.push("missing_required_attribution");
  }
  if (input.requiresLinkback === true && trimToNull(input.sourceUrl) === null) {
    reasons.push("missing_required_linkback");
  }

  return { publishable: reasons.length === 0, reasons };
}

/** Atalho booleano de `evaluateArticlePublication`. */
export function isArticlePublishable(
  input: ArticlePublicationInput,
  nowIso: string,
): boolean {
  return evaluateArticlePublication(input, nowIso).publishable;
}

export function isPubliclyRenderableArticleReviewStatus(status: string): boolean {
  return PUBLICLY_RENDERABLE_ARTICLE_REVIEW_STATUSES.includes(status as never);
}

export function isRetractedArticleReviewStatus(status: string): boolean {
  return RETRACTED_ARTICLE_REVIEW_STATUSES.includes(status as never);
}

/**
 * Data de publicacao efetiva: a da traducao vence; a do artigo e o fallback.
 * Espelha `resolvePublishedIso` do presenter, aqui como fonte compartilhavel.
 */
export function resolveArticlePublishedIso(
  translationIso: string | null,
  articleIso: string | null,
): string | null {
  return trimToNull(translationIso) ?? trimToNull(articleIso);
}
