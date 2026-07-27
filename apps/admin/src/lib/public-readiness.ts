/**
 * public-readiness.ts — Validacao de PRONTIDAO PUBLICA de artigos/content_blocks
 * para o admin editorial. PURO (sem rede/DB/IO/import de runtime).
 *
 * Responde a pergunta do editor: "isso ja pode aparecer no site publico da Cinerie,
 * e ja pode indexar?". NAO decide nada no banco, NAO publica, NAO chama API — so
 * descreve o estado atual espelhando as regras REAIS do app publico.
 *
 * ESPELHAMENTO (nao duplicar regra critica): as constantes de review/licenca/corpo
 * vem de `./editorial-status` — que ja e travado contra
 * `apps/web/src/lib/news-presenter.ts` por `tests/admin/editorial-status-mirror.test.ts`.
 * A composicao de prontidao aqui e travada contra o pipeline publico real
 * (`isPublishableArticle` + `evaluateArticleIndexability`) por
 * `tests/admin/public-readiness-mirror.test.ts`. Regras publicas confirmadas
 * (apps/web/src/server/news-pages.ts + news-presenter.ts):
 *   - EXIBIR (render 200): idioma pt-BR + review publicavel + licenca exibivel +
 *     display_allowed + slug + titulo + publishedAt (isPublishableArticle);
 *   - INDEXAR: exibivel + corpo suficiente (>= MIN_ARTICLE_BODY_CHARS) +
 *     index_status = 'index' (evaluateArticleIndexability so REBAIXA, nunca forca).
 */

import {
  MIN_ARTICLE_BODY_CHARS,
  isBlockedReview,
  isDisplayableLicense,
  isPendingReview,
  isPublishableReview,
} from "./editorial-status";

/* ------------------------------------------------------------------ */
/* Constantes publicas (espelham apps/web/src/lib/site.ts)             */
/* ------------------------------------------------------------------ */

/** Origin publico canonico (sem barra final). Espelha SITE_URL do apps/web. */
export const PUBLIC_SITE_ORIGIN = "https://cinerie.com";

/** Caminho da listagem de noticias pt-BR (com barra final). Espelha NEWS_INDEX_PATH. */
export const NEWS_INDEX_PATH = "/pt/noticias/";

/** Idiomas que publicam primeiro no MVP (invariante 7). */
const PUBLISH_FIRST_LANGUAGES: ReadonlySet<string> = new Set(["pt-BR", "pt"]);

/**
 * `published_at` ainda no futuro (materia agendada/embargada).
 *
 * Espelha a regra de `evaluateArticlePublication` (@screena/seo), que e a fonte
 * unica do gate publico. Aqui a regra e reimplementada de proposito: o admin e
 * PURO e nao importa runtime do app publico — e `tests/admin/public-readiness-
 * mirror.test.ts` trava as duas implementacoes uma contra a outra, entao uma
 * divergencia falha o build em vez de virar um painel mentiroso.
 *
 * Fail-closed: data ilegivel ou relogio ilegivel contam como "ainda nao
 * publicado".
 */
function isFuturePublication(publishedAtIso: string | null, nowIso: string): boolean {
  const published = trimToNull(publishedAtIso);
  if (published === null) return false; // ausencia e tratada por "sem publishedAt"
  const publishedMs = Date.parse(published);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(publishedMs)) return true;
  if (Number.isNaN(nowMs)) return true;
  return publishedMs > nowMs;
}

/* ------------------------------------------------------------------ */
/* Tipos                                                              */
/* ------------------------------------------------------------------ */

/**
 * Nivel de prontidao (badge). Para artigo cobre os 4 estados; para content_block
 * `visible_noindex` nao e usado (bloco nao e uma pagina).
 */
export type ReadinessLevel = "index_ready" | "visible_noindex" | "review_pending" | "blocked";

/** Resultado de prontidao publica (seguro para exibir — sem segredo/payload). */
export interface PublicReadiness {
  readonly level: ReadinessLevel;
  /** Pode aparecer publicamente (render 200). */
  readonly canDisplay: boolean;
  /** Pode ser indexado (robots index). */
  readonly canIndex: boolean;
  /** Lista determinista de problemas (motivos), em ordem fixa. */
  readonly issues: readonly string[];
  /** Motivo principal (primeiro problema) ou `null` se pronto. */
  readonly primaryIssue: string | null;
  /** URL publica calculada (so pt-BR/pt com slug seguro); `null` caso contrario. */
  readonly publicUrl: string | null;
}

/** Fatos de uma versao de artigo para avaliar prontidao. */
export interface ArticleReadinessInput {
  readonly reviewStatus: string;
  readonly licenseStatus: string;
  readonly displayAllowed: boolean;
  readonly slug: string | null;
  readonly title: string | null;
  readonly publishedAtIso: string | null;
  /** Numero de caracteres do corpo (apos trim). O texto do corpo NAO e necessario. */
  readonly bodyChars: number;
  readonly indexStatus: string;
  readonly languageCode: string;
}

/** Fatos de um content_block para avaliar prontidao. */
export interface ContentBlockReadinessInput {
  readonly reviewStatus: string;
  readonly contentChars: number;
  readonly languageCode: string;
}

/* ------------------------------------------------------------------ */
/* Helpers puros                                                      */
/* ------------------------------------------------------------------ */

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `true` se o idioma publica no MVP (pt-BR/pt). */
export function isPublishFirstLanguage(languageCode: string): boolean {
  return PUBLISH_FIRST_LANGUAGES.has(languageCode);
}

/** `true` se o corpo tem tamanho suficiente (anti-thin), pela contagem de chars. */
export function isSufficientBodyChars(bodyChars: number): boolean {
  return Number.isFinite(bodyChars) && bodyChars >= MIN_ARTICLE_BODY_CHARS;
}

/**
 * Monta a URL publica pt-BR de um artigo (`.../pt/noticias/{slug}/`). Retorna
 * `null` para idioma nao-pt-BR, slug ausente/vazio ou slug com caracteres que
 * quebrariam a rota (`/ \ : ? #` ou `..`) — espelha a validacao de
 * `apps/web/src/lib/site.ts#detailPath`.
 */
export function buildPublicArticleUrl(
  slug: string | null,
  languageCode: string,
): string | null {
  if (!isPublishFirstLanguage(languageCode)) return null;
  const value = trimToNull(slug);
  if (value === null) return null;
  if (/[/\\:?#]/.test(value) || value.includes("..")) return null;
  return `${PUBLIC_SITE_ORIGIN}${NEWS_INDEX_PATH}${value}/`;
}

/* ------------------------------------------------------------------ */
/* Nivel de prontidao (derivado das portas)                            */
/* ------------------------------------------------------------------ */

/**
 * Deriva o nivel a partir das portas ja calculadas. Ordem: pronto p/ indexar ->
 * visivel (noindex) -> bloqueio duro -> revisao pendente -> bloqueio (dado
 * faltando).
 */
export function getReadinessLevel(gates: {
  canDisplay: boolean;
  canIndex: boolean;
  hardBlocked: boolean;
  reviewPending: boolean;
}): ReadinessLevel {
  if (gates.canIndex) return "index_ready";
  if (gates.canDisplay) return "visible_noindex";
  if (gates.hardBlocked) return "blocked";
  if (gates.reviewPending) return "review_pending";
  return "blocked";
}

/**
 * Lista determinista de problemas de um artigo (ordem fixa). Cada gate que falha
 * vira um item; sem segredo. Itens de corpo/index so afetam INDEXACAO, os demais
 * afetam EXIBICAO tambem.
 */
export function buildReadinessIssues(
  input: ArticleReadinessInput,
  nowIso: string,
): string[] {
  const issues: string[] = [];
  if (isBlockedReview(input.reviewStatus)) {
    issues.push("review_status bloqueado/arquivado");
  } else if (!isPublishableReview(input.reviewStatus)) {
    issues.push("revisao pendente (review_status nao publicavel)");
  }
  if (!isDisplayableLicense(input.licenseStatus)) issues.push("license_status nao exibivel");
  if (input.displayAllowed !== true) issues.push("display_allowed=false");
  if (trimToNull(input.slug) === null) issues.push("sem slug");
  if (trimToNull(input.title) === null) issues.push("sem titulo");
  if (trimToNull(input.publishedAtIso) === null) {
    issues.push("sem publishedAt");
  } else if (isFuturePublication(input.publishedAtIso, nowIso)) {
    issues.push("publicacao agendada (published_at no futuro)");
  }
  if (!isPublishFirstLanguage(input.languageCode)) {
    issues.push("idioma nao publica no MVP (pt-BR primeiro; en/es nascem noindex)");
  }
  if (!isSufficientBodyChars(input.bodyChars)) {
    issues.push(`corpo insuficiente (< ${MIN_ARTICLE_BODY_CHARS} caracteres)`);
  }
  if (input.indexStatus !== "index") issues.push("index_status != index");
  return issues;
}

/* ------------------------------------------------------------------ */
/* Avaliacao de prontidao                                             */
/* ------------------------------------------------------------------ */

/**
 * Avalia a prontidao publica de UMA versao de artigo. `canDisplay` espelha
 * `isPublishableArticle` do apps/web (mais o gate de idioma pt-BR do MVP);
 * `canIndex` espelha `evaluateArticleIndexability` (corpo suficiente + index_status=index).
 */
export function evaluateArticlePublicReadiness(
  input: ArticleReadinessInput,
  nowIso: string,
): PublicReadiness {
  const reviewPublishable = isPublishableReview(input.reviewStatus);
  const licenseOk = isDisplayableLicense(input.licenseStatus);
  const displayOk = input.displayAllowed === true;
  const hasSlug = trimToNull(input.slug) !== null;
  const hasTitle = trimToNull(input.title) !== null;
  const hasPublishedAt = trimToNull(input.publishedAtIso) !== null;
  // Agendada: data preenchida mas ainda no futuro. O editor precisa ver isso
  // como "ainda nao esta no ar", nao como "pronto" — senao o painel afirma uma
  // publicacao que o site publico corretamente esconde.
  const publicationReached = hasPublishedAt && !isFuturePublication(input.publishedAtIso, nowIso);
  const languageOk = isPublishFirstLanguage(input.languageCode);
  const bodyOk = isSufficientBodyChars(input.bodyChars);
  const indexRequested = input.indexStatus === "index";

  const canDisplay =
    reviewPublishable &&
    licenseOk &&
    displayOk &&
    hasSlug &&
    hasTitle &&
    publicationReached &&
    languageOk;
  const canIndex = canDisplay && bodyOk && indexRequested;

  const hardBlocked = isBlockedReview(input.reviewStatus) || !licenseOk || !displayOk;
  const reviewPending = isPendingReview(input.reviewStatus);

  const issues = buildReadinessIssues(input, nowIso);

  return {
    level: getReadinessLevel({ canDisplay, canIndex, hardBlocked, reviewPending }),
    canDisplay,
    canIndex,
    issues,
    primaryIssue: issues[0] ?? null,
    publicUrl: buildPublicArticleUrl(input.slug, input.languageCode),
  };
}

/**
 * Avalia a prontidao de UM content_block. Bloco nao e pagina: ou esta pronto para
 * contar como valor publico (review publicavel + conteudo + idioma MVP), ou
 * pendente de revisao, ou bloqueado (review travado/arquivado ou conteudo vazio).
 */
export function evaluateContentBlockPublicReadiness(
  input: ContentBlockReadinessInput,
): PublicReadiness {
  const contentOk = Number.isFinite(input.contentChars) && input.contentChars > 0;
  const reviewPublishable = isPublishableReview(input.reviewStatus);
  const languageOk = isPublishFirstLanguage(input.languageCode);

  const canDisplay = reviewPublishable && contentOk && languageOk;
  const hardBlocked = isBlockedReview(input.reviewStatus) || !contentOk;
  const reviewPending = isPendingReview(input.reviewStatus);

  const issues: string[] = [];
  if (isBlockedReview(input.reviewStatus)) {
    issues.push("review_status bloqueado/arquivado");
  } else if (!reviewPublishable) {
    issues.push("revisao pendente (review_status nao publicavel)");
  }
  if (!contentOk) issues.push("conteudo vazio");
  if (!languageOk) {
    issues.push("idioma nao publica no MVP (pt-BR primeiro; en/es nascem noindex)");
  }

  // Bloco nao produz `visible_noindex`; canIndex acompanha canDisplay.
  const level = getReadinessLevel({
    canDisplay,
    canIndex: canDisplay,
    hardBlocked,
    reviewPending,
  });

  return {
    level,
    canDisplay,
    canIndex: canDisplay,
    issues,
    primaryIssue: issues[0] ?? null,
    publicUrl: null,
  };
}

/* ------------------------------------------------------------------ */
/* Rotulos e variantes (pt-BR)                                        */
/* ------------------------------------------------------------------ */

/** Variante de badge (a cor NUNCA e o unico sinal; sempre com rotulo textual). */
export type ReadinessBadgeVariant = "ok" | "info" | "hold" | "blocked";

export function readinessBadgeVariant(level: ReadinessLevel): ReadinessBadgeVariant {
  switch (level) {
    case "index_ready":
      return "ok";
    case "visible_noindex":
      return "info";
    case "review_pending":
      return "hold";
    case "blocked":
      return "blocked";
  }
}

const ARTICLE_READINESS_LABELS: Record<ReadinessLevel, string> = {
  index_ready: "Pronto para indexar",
  visible_noindex: "Visível, mas noindex",
  review_pending: "Revisão pendente",
  blocked: "Bloqueado",
};

const CONTENT_BLOCK_READINESS_LABELS: Record<ReadinessLevel, string> = {
  index_ready: "Pronto (conta como valor)",
  visible_noindex: "Visível, mas noindex",
  review_pending: "Revisão pendente",
  blocked: "Bloqueado",
};

export function articleReadinessLabel(level: ReadinessLevel): string {
  return ARTICLE_READINESS_LABELS[level];
}

export function contentBlockReadinessLabel(level: ReadinessLevel): string {
  return CONTENT_BLOCK_READINESS_LABELS[level];
}
