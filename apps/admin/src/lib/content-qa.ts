/**
 * content-qa.ts — QA editorial e cobertura. PURO (sem rede/DB/IO/import de runtime).
 * Fase 7D.
 *
 * Diagnostica o que IMPEDE conteudo de aparecer/indexar/ter qualidade minima no
 * Cinerie. NAO escreve, NAO decide indexacao — so descreve problemas com severidade.
 * Reusa as regras ja espelhadas do app publico: `public-readiness` (exibicao/
 * indexacao, ja travado por public-readiness-mirror) e `editorial-status` (review/
 * licenca/corpo, travado por editorial-status-mirror). Nao duplica regra critica.
 *
 * O resultado e SEGURO para exibir: so categorias/severidades/mensagens fixas +
 * um score inteiro. NUNCA inclui o corpo completo, o conteudo do bloco, nem segredo.
 */

import {
  isBlockedReview,
  isDisplayableLicense,
  isPendingReview,
  isPublishableReview,
  MIN_ARTICLE_BODY_CHARS,
} from "./editorial-status";
import {
  evaluateArticlePublicReadiness,
  isPublishFirstLanguage,
  type ArticleReadinessInput,
  type ReadinessLevel,
} from "./public-readiness";

/* ------------------------------------------------------------------ */
/* Severidade e categorias                                             */
/* ------------------------------------------------------------------ */

export type QaSeverity = "critical" | "warning" | "info" | "success";

/** Ordem de gravidade (para "pior severidade"). */
const SEVERITY_RANK: Record<QaSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
  success: 0,
};

export type QaCategory =
  | "missing_slug"
  | "unsafe_slug"
  | "missing_title"
  | "short_title"
  | "missing_body"
  | "thin_body"
  | "missing_published_at"
  | "pending_review"
  | "rejected_review"
  | "blocked_license"
  | "display_not_allowed"
  | "forced_noindex"
  | "index_ready"
  | "visible_but_noindex"
  | "non_pt_br"
  | "content_block_empty"
  | "content_block_pending"
  | "content_block_rejected"
  | "content_block_unknown_entity"
  | "duplicate_slug_candidate"
  | "stale_content";

const CATEGORY_SEVERITY: Record<QaCategory, QaSeverity> = {
  missing_slug: "critical",
  unsafe_slug: "critical",
  missing_title: "critical",
  short_title: "warning",
  missing_body: "critical",
  thin_body: "warning",
  missing_published_at: "warning",
  pending_review: "warning",
  rejected_review: "critical",
  blocked_license: "critical",
  display_not_allowed: "critical",
  forced_noindex: "warning",
  index_ready: "success",
  visible_but_noindex: "info",
  non_pt_br: "warning",
  content_block_empty: "critical",
  content_block_pending: "warning",
  content_block_rejected: "critical",
  content_block_unknown_entity: "critical",
  duplicate_slug_candidate: "info",
  stale_content: "info",
};

const CATEGORY_MESSAGE: Record<QaCategory, string> = {
  missing_slug: "Sem slug (nao ha URL publica).",
  unsafe_slug: "Slug inseguro (quebraria a rota publica).",
  missing_title: "Sem titulo.",
  short_title: "Titulo muito curto.",
  missing_body: "Sem corpo proprio.",
  thin_body: "Corpo fino (abaixo do minimo anti-thin).",
  missing_published_at: "Sem publishedAt.",
  pending_review: "Revisao pendente (nao publicavel ainda).",
  rejected_review: "Revisao bloqueada/arquivada.",
  blocked_license: "Licenca nao exibivel.",
  display_not_allowed: "display_allowed=false.",
  forced_noindex: "index_status=noindex (fora do indice).",
  index_ready: "Pronto para indexar.",
  visible_but_noindex: "Exibivel, mas fora do indice (noindex).",
  non_pt_br: "Idioma en/es (nasce noindex ate revisao).",
  content_block_empty: "Bloco sem conteudo.",
  content_block_pending: "Bloco com revisao pendente.",
  content_block_rejected: "Bloco bloqueado/arquivado.",
  content_block_unknown_entity: "Bloco aponta para entidade inexistente.",
  duplicate_slug_candidate: "Slug reutilizado em mais de uma traducao.",
  stale_content: "Conteudo possivelmente desatualizado.",
};

/** Severidade padrao de uma categoria de QA. */
export function getQaSeverity(category: QaCategory): QaSeverity {
  return CATEGORY_SEVERITY[category];
}

export interface QaIssue {
  readonly category: QaCategory;
  readonly severity: QaSeverity;
  readonly message: string;
}

/** Monta uma `QaIssue` a partir da categoria (mensagem/severidade fixas). */
export function buildQaIssue(category: QaCategory): QaIssue {
  return { category, severity: CATEGORY_SEVERITY[category], message: CATEGORY_MESSAGE[category] };
}

/* ------------------------------------------------------------------ */
/* Qualidade de campos                                                */
/* ------------------------------------------------------------------ */

/** Minimo de caracteres para um titulo nao ser considerado curto. */
export const MIN_TITLE_CHARS = 12;

/** Slug inseguro: caracteres que quebrariam a rota (`/ \ : ? #`) ou `..`. */
const UNSAFE_SLUG_PATTERN = /[/\\:?#]/;

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t === "" ? null : t;
}

export interface SlugQuality {
  readonly missing: boolean;
  readonly unsafe: boolean;
}

export function evaluateSlugQuality(slug: string | null | undefined): SlugQuality {
  const value = trimToNull(slug);
  if (value === null) return { missing: true, unsafe: false };
  return { missing: false, unsafe: UNSAFE_SLUG_PATTERN.test(value) || value.includes("..") };
}

export interface TitleQuality {
  readonly missing: boolean;
  readonly short: boolean;
  readonly length: number;
}

export function evaluateTitleQuality(title: string | null | undefined): TitleQuality {
  const value = trimToNull(title);
  if (value === null) return { missing: true, short: false, length: 0 };
  return { missing: false, short: value.length < MIN_TITLE_CHARS, length: value.length };
}

export interface BodyQuality {
  readonly missing: boolean;
  readonly thin: boolean;
  readonly sufficient: boolean;
}

export function evaluateBodyQuality(bodyChars: number): BodyQuality {
  const chars = Number.isFinite(bodyChars) && bodyChars > 0 ? Math.trunc(bodyChars) : 0;
  if (chars <= 0) return { missing: true, thin: false, sufficient: false };
  if (chars < MIN_ARTICLE_BODY_CHARS) return { missing: false, thin: true, sufficient: false };
  return { missing: false, thin: false, sufficient: true };
}

/* ------------------------------------------------------------------ */
/* Riscos por dimensao (issues compostas)                             */
/* ------------------------------------------------------------------ */

/** Issues de risco de REVISAO. */
export function evaluateReviewRisk(reviewStatus: string): QaIssue[] {
  if (isBlockedReview(reviewStatus)) return [buildQaIssue("rejected_review")];
  if (isPendingReview(reviewStatus)) return [buildQaIssue("pending_review")];
  return [];
}

/** Issues de risco de LICENCA/DISPLAY. */
export function evaluateLicenseRisk(licenseStatus: string, displayAllowed: boolean): QaIssue[] {
  const issues: QaIssue[] = [];
  if (!isDisplayableLicense(licenseStatus)) issues.push(buildQaIssue("blocked_license"));
  if (displayAllowed !== true) issues.push(buildQaIssue("display_not_allowed"));
  return issues;
}

/** Issues de risco de INDEXACAO (index_status + idioma). */
export function evaluateIndexingRisk(indexStatus: string, languageCode: string): QaIssue[] {
  const issues: QaIssue[] = [];
  if (indexStatus === "noindex") issues.push(buildQaIssue("forced_noindex"));
  if (!isPublishFirstLanguage(languageCode)) issues.push(buildQaIssue("non_pt_br"));
  return issues;
}

/* ------------------------------------------------------------------ */
/* Score e resumo                                                     */
/* ------------------------------------------------------------------ */

const SCORE_WEIGHT: Record<QaSeverity, number> = {
  critical: 25,
  warning: 8,
  info: 0,
  success: 0,
};

/**
 * Teto de score quando ha QUALQUER issue critical. Conteudo com um bloqueio real
 * (sem slug/titulo, licenca bloqueada, display negado, etc.) nao pode aparecer
 * publicamente — entao o score nunca fica na faixa "bom/regular", por mais que
 * seja o unico problema. Evita superestimar conteudo bloqueado.
 */
export const CRITICAL_SCORE_CEILING = 40;

/** Calcula um score 0..100 a partir das issues (critico pesa mais e limita o teto). */
export function calculateQaScore(issues: readonly QaIssue[]): number {
  let penalty = 0;
  let hasCritical = false;
  for (const issue of issues) {
    penalty += SCORE_WEIGHT[issue.severity];
    if (issue.severity === "critical") hasCritical = true;
  }
  let score = 100 - penalty;
  if (hasCritical && score > CRITICAL_SCORE_CEILING) score = CRITICAL_SCORE_CEILING;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.trunc(score);
}

/** Pior severidade presente nas issues (ou `success` se nao houver problema). */
export function worstSeverity(issues: readonly QaIssue[]): QaSeverity {
  let worst: QaSeverity = "success";
  for (const issue of issues) {
    if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst]) worst = issue.severity;
  }
  return worst;
}

export interface QaSummary {
  readonly bySeverity: Record<QaSeverity, number>;
  readonly byCategory: Partial<Record<QaCategory, number>>;
  readonly total: number;
}

/** Sumariza um conjunto de issues por severidade e por categoria. */
export function summarizeQaIssues(issues: readonly QaIssue[]): QaSummary {
  const bySeverity: Record<QaSeverity, number> = { critical: 0, warning: 0, info: 0, success: 0 };
  const byCategory: Partial<Record<QaCategory, number>> = {};
  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
  }
  return { bySeverity, byCategory, total: issues.length };
}

/* ------------------------------------------------------------------ */
/* Avaliacao de artigo                                                */
/* ------------------------------------------------------------------ */

/** Entrada de QA de artigo (superset do readiness + updatedAt para stale). */
export interface ArticleQaInput extends ArticleReadinessInput {
  readonly updatedAtIso?: string | null;
}

/** Opcoes de avaliacao (ex.: referencia de "agora" para stale — sem usar Date interno). */
export interface QaOptions {
  /** ISO de referencia ("agora"), passado pela camada server; sem isso, sem stale. */
  readonly nowIso?: string;
  /** Dias apos os quais um conteudo e considerado stale. */
  readonly staleDays?: number;
}

/** Dias padrao para considerar conteudo stale. */
export const DEFAULT_STALE_DAYS = 180;
const MS_PER_DAY = 86_400_000;

function isStale(updatedAtIso: string | null | undefined, nowIso: string, staleDays: number): boolean {
  const updated = trimToNull(updatedAtIso ?? null);
  if (updated === null) return false;
  const updatedMs = Date.parse(updated);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(updatedMs) || Number.isNaN(nowMs)) return false;
  return nowMs - updatedMs > staleDays * MS_PER_DAY;
}

export interface ArticleQaResult {
  readonly issues: QaIssue[];
  readonly score: number;
  readonly severity: QaSeverity;
  readonly readinessLevel: ReadinessLevel;
}

/**
 * Avalia a QA de UMA versao de artigo: qualidade de campos + riscos de revisao/
 * licenca/indexacao + desfecho de prontidao (index_ready/visible_but_noindex).
 * Deterministico; `stale` so quando `nowIso` e fornecido.
 */
export function evaluateArticleQa(input: ArticleQaInput, options: QaOptions = {}): ArticleQaResult {
  const readiness = evaluateArticlePublicReadiness(input);
  const issues: QaIssue[] = [];

  const slugQ = evaluateSlugQuality(input.slug);
  if (slugQ.missing) issues.push(buildQaIssue("missing_slug"));
  else if (slugQ.unsafe) issues.push(buildQaIssue("unsafe_slug"));

  const titleQ = evaluateTitleQuality(input.title);
  if (titleQ.missing) issues.push(buildQaIssue("missing_title"));
  else if (titleQ.short) issues.push(buildQaIssue("short_title"));

  const bodyQ = evaluateBodyQuality(input.bodyChars);
  if (bodyQ.missing) issues.push(buildQaIssue("missing_body"));
  else if (bodyQ.thin) issues.push(buildQaIssue("thin_body"));

  if (trimToNull(input.publishedAtIso) === null) issues.push(buildQaIssue("missing_published_at"));

  issues.push(...evaluateReviewRisk(input.reviewStatus));
  issues.push(...evaluateLicenseRisk(input.licenseStatus, input.displayAllowed));
  issues.push(...evaluateIndexingRisk(input.indexStatus, input.languageCode));

  if (readiness.canIndex) issues.push(buildQaIssue("index_ready"));
  else if (readiness.canDisplay) issues.push(buildQaIssue("visible_but_noindex"));

  if (options.nowIso !== undefined && isStale(input.updatedAtIso, options.nowIso, options.staleDays ?? DEFAULT_STALE_DAYS)) {
    issues.push(buildQaIssue("stale_content"));
  }

  return {
    issues,
    score: calculateQaScore(issues),
    severity: worstSeverity(issues),
    readinessLevel: readiness.level,
  };
}

/* ------------------------------------------------------------------ */
/* Avaliacao de content_block                                         */
/* ------------------------------------------------------------------ */

export interface ContentBlockQaInput {
  readonly reviewStatus: string;
  readonly contentChars: number;
  readonly languageCode: string;
  /** `true` se a entidade referenciada (entityType+entityId) nao existe. */
  readonly entityMissing?: boolean;
}

export interface ContentBlockQaResult {
  readonly issues: QaIssue[];
  readonly score: number;
  readonly severity: QaSeverity;
}

/** Cobertura de UM content_block: conteudo, revisao, idioma, entidade. */
export function evaluateContentBlockCoverage(input: ContentBlockQaInput): QaIssue[] {
  const issues: QaIssue[] = [];
  const hasContent = Number.isFinite(input.contentChars) && input.contentChars > 0;
  if (!hasContent) issues.push(buildQaIssue("content_block_empty"));

  if (isBlockedReview(input.reviewStatus)) issues.push(buildQaIssue("content_block_rejected"));
  else if (isPendingReview(input.reviewStatus)) issues.push(buildQaIssue("content_block_pending"));

  if (!isPublishFirstLanguage(input.languageCode)) issues.push(buildQaIssue("non_pt_br"));
  if (input.entityMissing === true) issues.push(buildQaIssue("content_block_unknown_entity"));
  return issues;
}

/** Avalia a QA de UM content_block. */
export function evaluateContentBlockQa(input: ContentBlockQaInput): ContentBlockQaResult {
  const issues = evaluateContentBlockCoverage(input);
  // Bloco pt-BR publicavel e com conteudo -> saudavel (marca success).
  if (
    issues.length === 0 &&
    isPublishableReview(input.reviewStatus) &&
    isPublishFirstLanguage(input.languageCode)
  ) {
    issues.push(buildQaIssue("index_ready"));
  }
  return { issues, score: calculateQaScore(issues), severity: worstSeverity(issues) };
}
