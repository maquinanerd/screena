/**
 * editorial-status.ts — Classificacao e agregacao de estado editorial. PURO.
 *
 * Sem rede, sem DB, sem IO, SEM imports: recebe fatos ja lidos do PostgreSQL
 * (pela camada server-only) e devolve status/contagens deterministicos para o
 * admin editorial em modo SOMENTE LEITURA. Nunca escreve, nunca publica, nunca
 * decide indexacao — apenas descreve o estado atual.
 *
 * As constantes de licenca/revisao espelham as regras confiaveis do app publico
 * (`apps/web/src/lib/news-presenter.ts` + `.claude/rules/seo.md` /
 * `entity-writer.md`). O espelhamento e travado por
 * `tests/admin/editorial-status-mirror.test.ts` para evitar divergencia — este
 * modulo continua sem depender de `apps/web` em runtime (fronteira limpa).
 */

/* ------------------------------------------------------------------ */
/* Constantes de dominio (espelham @screena/db enums + regras)         */
/* ------------------------------------------------------------------ */

/** ReviewStatus publicaveis: bloco/versao apto a exibir/indexar (rules/seo.md). */
export const PUBLISHABLE_REVIEW_STATUSES = ["human_reviewed", "published"] as const;

/** ReviewStatus que travam exibicao (bloqueado ou arquivado). */
export const BLOCKED_REVIEW_STATUSES = ["blocked", "archived"] as const;

/** ReviewStatus pendentes de revisao humana (nao bloqueados, ainda nao aptos). */
export const PENDING_REVIEW_STATUSES = [
  "draft",
  "ai_generated",
  "needs_review",
  "needs_update",
] as const;

/** LicenseStatus que permitem exibir em pagina publica (invariante 6). */
export const DISPLAYABLE_LICENSE_STATUSES = ["official", "licensed", "third_party"] as const;

/** Corpo minimo (chars, apos trim) para um artigo nao ser considerado fino. */
export const MIN_ARTICLE_BODY_CHARS = 200;

/** Limite padrao de linhas por listagem read-only (evita leitura ilimitada). */
export const ADMIN_LIST_LIMIT = 100;

/* ------------------------------------------------------------------ */
/* Tipos                                                              */
/* ------------------------------------------------------------------ */

/** Veredito de dashboard/listagem para uma versao de artigo. */
export type ArticleAdminStatus = "publishable" | "noindex" | "blocked";

/** Veredito para um content_block. */
export type ContentBlockAdminStatus = "publishable" | "pending" | "blocked";

/** Grupo agregado de versoes de artigo (saida de um groupBy do Prisma). */
export interface ArticleGroup {
  reviewStatus: string;
  indexStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
  count: number;
}

/** Contagens do dashboard para versoes de artigo. Particao exata (soma = total). */
export interface ArticleCounts {
  total: number;
  publishable: number;
  noindex: number;
  blocked: number;
}

/** Grupo agregado de content_blocks por reviewStatus. */
export interface ContentBlockGroup {
  reviewStatus: string;
  count: number;
}

/** Contagens do dashboard para content_blocks. Particao exata (soma = total). */
export interface ContentBlockCounts {
  total: number;
  publishable: number;
  pending: number;
  blocked: number;
}

/** Fatos de uma versao de artigo para o classificador de linha (listagem). */
export interface ArticleRowInput {
  reviewStatus: string;
  indexStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
  slug: string | null;
  title: string | null;
  publishedAtIso: string | null;
  body: string | null;
}

/** Resultado do classificador de linha: veredito + lacunas de campo. */
export interface ArticleClassification {
  status: ArticleAdminStatus;
  /** Lacunas de campo que um revisor precisaria preencher (nao mudam o status). */
  issues: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                      */
/* ------------------------------------------------------------------ */

function includes(set: readonly string[], value: string): boolean {
  return set.includes(value);
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** ReviewStatus apto a publicar/indexar (human_reviewed | published). */
export function isPublishableReview(reviewStatus: string): boolean {
  return includes(PUBLISHABLE_REVIEW_STATUSES, reviewStatus);
}

/** ReviewStatus que trava exibicao (blocked | archived). */
export function isBlockedReview(reviewStatus: string): boolean {
  return includes(BLOCKED_REVIEW_STATUSES, reviewStatus);
}

/** ReviewStatus pendente de revisao (draft | ai_generated | needs_review | needs_update). */
export function isPendingReview(reviewStatus: string): boolean {
  return includes(PENDING_REVIEW_STATUSES, reviewStatus);
}

/** LicenseStatus que permite exibir em pagina publica (invariante 6). */
export function isDisplayableLicense(licenseStatus: string): boolean {
  return includes(DISPLAYABLE_LICENSE_STATUSES, licenseStatus);
}

/** Corpo proprio suficiente (>= MIN_ARTICLE_BODY_CHARS apos trim). */
export function isSufficientBody(body: string | null): boolean {
  const value = trimToNull(body);
  return value !== null && value.length >= MIN_ARTICLE_BODY_CHARS;
}

/* ------------------------------------------------------------------ */
/* Classificacao (particao coarse: bloqueado | publicavel | noindex)   */
/* ------------------------------------------------------------------ */

/**
 * Veredito coarse de uma versao de artigo por dimensoes de licenca/display/
 * revisao/index (SEM corpo/campos). Mesma logica usada no dashboard e na
 * listagem, garantindo particao exata entre as duas superficies.
 */
function articleStatusOf(input: {
  reviewStatus: string;
  indexStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
}): ArticleAdminStatus {
  const licenseOk = isDisplayableLicense(input.licenseStatus);
  const blocked =
    !licenseOk ||
    input.displayAllowed !== true ||
    input.indexStatus === "blocked" ||
    isBlockedReview(input.reviewStatus);
  if (blocked) return "blocked";
  if (isPublishableReview(input.reviewStatus) && input.indexStatus === "index") {
    return "publishable";
  }
  return "noindex";
}

/**
 * Classifica uma versao de artigo para a listagem: status coarse + lacunas de
 * campo (sem slug/titulo/data/corpo). As lacunas sao diagnostico para o revisor
 * e NAO alteram o status (as colunas cruas ja mostram os enums).
 */
export function classifyArticle(input: ArticleRowInput): ArticleClassification {
  const status = articleStatusOf(input);
  const issues: string[] = [];
  if (trimToNull(input.slug) === null) issues.push("sem slug");
  if (trimToNull(input.title) === null) issues.push("sem titulo");
  if (trimToNull(input.publishedAtIso) === null) issues.push("sem data");
  if (!isSufficientBody(input.body)) issues.push("corpo insuficiente");
  return { status, issues };
}

/** Veredito de um content_block por reviewStatus (particao exata). */
export function classifyContentBlock(reviewStatus: string): ContentBlockAdminStatus {
  if (isBlockedReview(reviewStatus)) return "blocked";
  if (isPublishableReview(reviewStatus)) return "publishable";
  return "pending";
}

/* ------------------------------------------------------------------ */
/* Agregacao (contagens reais a partir de groupBy do Prisma)           */
/* ------------------------------------------------------------------ */

function safeCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

/**
 * Agrega grupos de versoes de artigo em contagens de dashboard. Como cada grupo
 * carrega a contagem total daquela combinacao de enums, o resultado sao numeros
 * REAIS (nada amostrado). Banco vazio -> todos zero.
 */
export function aggregateArticleGroups(groups: ArticleGroup[]): ArticleCounts {
  const counts: ArticleCounts = { total: 0, publishable: 0, noindex: 0, blocked: 0 };
  for (const group of groups) {
    const n = safeCount(group.count);
    if (n === 0) continue;
    counts.total += n;
    const status = articleStatusOf(group);
    counts[status] += n;
  }
  return counts;
}

/**
 * Agrega grupos de content_blocks por reviewStatus em contagens de dashboard.
 * Numeros REAIS; banco vazio -> todos zero.
 */
export function aggregateContentBlockGroups(groups: ContentBlockGroup[]): ContentBlockCounts {
  const counts: ContentBlockCounts = { total: 0, publishable: 0, pending: 0, blocked: 0 };
  for (const group of groups) {
    const n = safeCount(group.count);
    if (n === 0) continue;
    counts.total += n;
    counts[classifyContentBlock(group.reviewStatus)] += n;
  }
  return counts;
}

/* ------------------------------------------------------------------ */
/* Formatacao leve (rotulos pt-BR)                                     */
/* ------------------------------------------------------------------ */

const ARTICLE_STATUS_LABELS: Record<ArticleAdminStatus, string> = {
  publishable: "Publicavel",
  noindex: "Noindex",
  blocked: "Bloqueado",
};

const CONTENT_BLOCK_STATUS_LABELS: Record<ContentBlockAdminStatus, string> = {
  publishable: "Publicavel",
  pending: "Pendente",
  blocked: "Bloqueado",
};

export function articleStatusLabel(status: ArticleAdminStatus): string {
  return ARTICLE_STATUS_LABELS[status];
}

export function contentBlockStatusLabel(status: ContentBlockAdminStatus): string {
  return CONTENT_BLOCK_STATUS_LABELS[status];
}

/** Variante semantica de badge (a cor NUNCA e o unico sinal; sempre com rotulo). */
export type BadgeVariant = "ok" | "hold" | "blocked";

export function articleBadgeVariant(status: ArticleAdminStatus): BadgeVariant {
  if (status === "publishable") return "ok";
  if (status === "blocked") return "blocked";
  return "hold";
}

export function contentBlockBadgeVariant(status: ContentBlockAdminStatus): BadgeVariant {
  if (status === "publishable") return "ok";
  if (status === "blocked") return "blocked";
  return "hold";
}

/** Formata ISO em `YYYY-MM-DD`; entrada invalida/ausente -> "—". */
export function formatIsoDate(iso: string | null): string {
  const value = trimToNull(iso);
  if (value === null) return "—";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? "—";
}
