/**
 * sitemap-presenter.ts — Montagem PURA das entradas do sitemap publico.
 * Sem rede/DB/IO: recebe candidatos ja lidos do PostgreSQL pela camada
 * server-only (`src/server/seo/sitemap-entries.ts`) e decide o que entra.
 *
 * Regras duras (espelham as invariantes 5/6/7 e as regras de seo.md):
 *  - So URLs do dominio canonico `https://cinerie.com`, sempre pt-BR
 *    (`/pt/...`) e com barra final (padrao `trailingSlash: true`). Nada de
 *    `/en`, `/es`, `/admin`, `/dev`, `/api` ou rota interna. (en/es entram no
 *    sitemap quando estiverem em PUBLISHED_LOCALES; hoje so pt-BR publica.)
 *  - No caminho com banco, sitemap e meta robots nao devem discordar: cada
 *    entrada passa pelos MESMOS evaluators de indexabilidade usados pelas
 *    paginas. Politica 2026-07 (indexacao total): filme/serie/pessoa
 *    sincronizados indexam sempre; noticia: publicavel + indexavel + corpo
 *    suficiente; listagens/portais: >= 1 item/secao real (vazio = noindex
 *    tecnico). Pagina `noindex` fica FORA do sitemap.
 *  - Item sem slug canonico ou sem titulo/nome valido nao entra.
 *  - `lastModified` so quando ha campo confiavel (updatedAt do banco);
 *    caso contrario e omitido — nunca inventar precisao.
 *  - Sem URL duplicada (dedupe por Set).
 *
 * Fallback sem banco: `buildStaticSitemapEntries()` devolve apenas as rotas
 * estaticas publicas. E usado pela camada server quando o PostgreSQL esta
 * indisponivel (build local/outage), com log explicito do erro. Por ser
 * fallback operacional, pode listar rotas cujo meta robots da pagina decida
 * `noindex` por falta de dados; nesse caso o meta robots por pagina segue
 * sendo a fonte de verdade para o crawler.
 */

import {
  canonicalPublicUrl,
  detailPath,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "./site";
import { evaluateMovieIndexability } from "./movie-indexability";
import { evaluateSeriesIndexability } from "./series-presenter";
import { evaluatePersonIndexability } from "./person-presenter";
import { evaluateEntityIndexIndexability } from "./entity-index-presenter";
import {
  evaluateArticleIndexability,
  evaluateNewsIndexIndexability,
  isNewsAttributionSatisfied,
  isPublishableArticle,
  isSufficientBody,
  resolvePublishedIso,
} from "./news-presenter";
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from "./portal-presenter";

/** Frequencias usadas (subconjunto conservador do protocolo de sitemap). */
export type SitemapChangeFrequency = "daily" | "weekly" | "monthly";

/** Entrada ja pronta (serializavel) para o app/sitemap.ts do Next. */
export interface SitemapEntryView {
  /** URL absoluta canonica com barra final. */
  url: string;
  /** ISO-8601 de campo confiavel do banco, ou null para omitir. */
  lastModifiedIso: string | null;
  changeFrequency: SitemapChangeFrequency;
  /** Prioridade conservadora (detalhe < listagem <= home). */
  priority: number;
}

/** Candidato de detalhe de entidade (filme/serie/pessoa) lido do banco. */
export interface SitemapEntityCandidate {
  /** Slug canonico pt-BR, ou null quando a entidade nao tem slug. */
  slug: string | null;
  /** Titulo/nome publico (traducao pt-BR ?? original), ou null. */
  title: string | null;
  /** Blocos de conteudo com review_status publicavel (>= 0). */
  renderableBlockCount: number;
  /** updated_at do registro (campo @updatedAt confiavel), ou null. */
  updatedAtIso: string | null;
}

/** Candidato de noticia (article_translation pt-BR + fatos do article). */
export interface SitemapNewsCandidate {
  slug: string | null;
  title: string | null;
  reviewStatus: string;
  licenseStatus: string;
  displayAllowed: boolean;
  requiresAttribution?: boolean;
  requiresLinkback?: boolean;
  sourceName?: string | null;
  sourceUrl?: string | null;
  indexStatus: string;
  body: string | null;
  translationPublishedAtIso: string | null;
  articlePublishedAtIso: string | null;
  updatedAtIso: string | null;
}

/** Snapshot completo lido do banco para montar o sitemap. */
export interface SitemapDataInput {
  movies: SitemapEntityCandidate[];
  series: SitemapEntityCandidate[];
  people: SitemapEntityCandidate[];
  news: SitemapNewsCandidate[];
}

interface StaticRouteSpec {
  path: string;
  changeFrequency: SitemapChangeFrequency;
  priority: number;
}

/**
 * Rotas estaticas publicas desta fase. Home e listagens com prioridade
 * moderada/alta; noticias com frequencia maior que evergreen; hub explorar
 * um degrau abaixo. Valores deliberadamente conservadores.
 */
const STATIC_ROUTES: readonly StaticRouteSpec[] = [
  { path: HOME_PATH, changeFrequency: "weekly", priority: 0.8 },
  { path: MOVIES_INDEX_PATH, changeFrequency: "weekly", priority: 0.7 },
  { path: SERIES_INDEX_PATH, changeFrequency: "weekly", priority: 0.7 },
  { path: PEOPLE_INDEX_PATH, changeFrequency: "weekly", priority: 0.7 },
  { path: NEWS_INDEX_PATH, changeFrequency: "daily", priority: 0.7 },
  { path: EXPLORE_PATH, changeFrequency: "weekly", priority: 0.6 },
];

function trimToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function staticEntry(spec: StaticRouteSpec): SitemapEntryView | null {
  const url = canonicalPublicUrl(spec.path);
  if (url === null) return null;
  return {
    url,
    lastModifiedIso: null,
    changeFrequency: spec.changeFrequency,
    priority: spec.priority,
  };
}

/**
 * Fallback seguro sem banco: SOMENTE as rotas estaticas publicas, sem gates
 * dependentes de dados. O meta robots por pagina continua mandando; esta
 * lista apenas evita sitemap vazio/quebrado durante build local ou outage.
 */
export function buildStaticSitemapEntries(): SitemapEntryView[] {
  const out: SitemapEntryView[] = [];
  for (const spec of STATIC_ROUTES) {
    const entry = staticEntry(spec);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** Candidato valido para listagem: tem slug canonico E titulo/nome real. */
function isValidCatalogItem(candidate: SitemapEntityCandidate): boolean {
  return (
    trimToNull(candidate.slug) !== null && trimToNull(candidate.title) !== null
  );
}

function entityDetailEntry(
  indexPath: string,
  candidate: SitemapEntityCandidate,
  decideIndex: (renderableBlockCount: number) => boolean,
): SitemapEntryView | null {
  if (!isValidCatalogItem(candidate)) return null;
  if (!decideIndex(candidate.renderableBlockCount)) return null;
  const path = detailPath(indexPath, candidate.slug);
  if (path === null) return null;
  const url = canonicalPublicUrl(path);
  if (url === null) return null;
  return {
    url,
    lastModifiedIso: trimToNull(candidate.updatedAtIso),
    changeFrequency: "monthly",
    priority: 0.5,
  };
}

/**
 * Publicavel = mesmo criterio da listagem de noticias (isPublishableArticle);
 * a listagem conta artigos PUBLICAVEIS (nao exige corpo/index_status), entao o
 * gate da listagem e dos portais usa esta contagem — identica a dos cards das
 * paginas de noticias.
 */
function isPublishableNewsCandidate(candidate: SitemapNewsCandidate): boolean {
  return (
    isPublishableArticle({
      reviewStatus: candidate.reviewStatus,
      licenseStatus: candidate.licenseStatus,
      displayAllowed: candidate.displayAllowed,
      slug: candidate.slug,
      title: candidate.title,
      publishedAtIso: resolvePublishedIso(
        candidate.translationPublishedAtIso,
        candidate.articlePublishedAtIso,
      ),
    }) &&
    isNewsAttributionSatisfied({
      requiresAttribution: candidate.requiresAttribution ?? false,
      requiresLinkback: candidate.requiresLinkback ?? false,
      sourceName: candidate.sourceName ?? null,
      sourceUrl: candidate.sourceUrl ?? null,
    })
  );
}

/** Noticia entra so quando publicavel E indexavel (mesmo gate da pagina). */
function newsDetailEntry(
  candidate: SitemapNewsCandidate,
): SitemapEntryView | null {
  if (!isPublishableNewsCandidate(candidate)) return null;
  const indexability = evaluateArticleIndexability({
    indexStatus: candidate.indexStatus,
    bodySufficient: isSufficientBody(candidate.body),
    reviewStatusOk: true,
  });
  if (indexability.decision !== "index") return null;
  const path = detailPath(NEWS_INDEX_PATH, candidate.slug);
  if (path === null) return null;
  const url = canonicalPublicUrl(path);
  if (url === null) return null;
  return {
    url,
    lastModifiedIso: trimToNull(candidate.updatedAtIso),
    changeFrequency: "weekly",
    priority: 0.6,
  };
}

/**
 * Monta o sitemap completo a partir do snapshot do banco.
 *
 * Coerencia com o meta robots das paginas:
 *  - listagem entra so se `evaluateEntityIndexIndexability`/news equivalem a
 *    `index` (>= MIN itens validos);
 *  - home/explorar entram so se `evaluatePortalIndexability` der `index`
 *    (home: filmes/series/noticias; explorar: filmes/series/pessoas/noticias);
 *  - detalhe entra so se o evaluator da propria pagina der `index`.
 */
export function buildSitemapEntries(input: SitemapDataInput): SitemapEntryView[] {
  const movieCount = input.movies.filter(isValidCatalogItem).length;
  const seriesCount = input.series.filter(isValidCatalogItem).length;
  const peopleCount = input.people.filter(isValidCatalogItem).length;
  const publishableNewsCount = input.news.filter(
    isPublishableNewsCandidate,
  ).length;
  const newsEntries = input.news
    .map(newsDetailEntry)
    .filter((entry): entry is SitemapEntryView => entry !== null);

  const listingIndexable: Record<string, boolean> = {
    [MOVIES_INDEX_PATH]:
      evaluateEntityIndexIndexability({ itemCount: movieCount }).decision ===
      "index",
    [SERIES_INDEX_PATH]:
      evaluateEntityIndexIndexability({ itemCount: seriesCount }).decision ===
      "index",
    [PEOPLE_INDEX_PATH]:
      evaluateEntityIndexIndexability({ itemCount: peopleCount }).decision ===
      "index",
    [NEWS_INDEX_PATH]:
      evaluateNewsIndexIndexability({ itemCount: publishableNewsCount })
        .decision === "index",
  };

  // Home renderiza filmes, series e noticias; pessoas aparece so no explorar.
  const homePopulatedSectionCount = countPopulatedSections([
    movieCount,
    seriesCount,
    publishableNewsCount,
  ]);
  const homeIndexable =
    evaluatePortalIndexability({
      populatedSectionCount: homePopulatedSectionCount,
    }).decision === "index";

  const explorePopulatedSectionCount = countPopulatedSections([
    movieCount,
    seriesCount,
    peopleCount,
    publishableNewsCount,
  ]);
  const exploreIndexable =
    evaluatePortalIndexability({
      populatedSectionCount: explorePopulatedSectionCount,
    }).decision === "index";

  const entries: SitemapEntryView[] = [];
  for (const spec of STATIC_ROUTES) {
    if (spec.path === HOME_PATH) {
      if (!homeIndexable) continue;
    } else if (spec.path === EXPLORE_PATH) {
      if (!exploreIndexable) continue;
    } else if (listingIndexable[spec.path] !== true) {
      continue;
    }
    const entry = staticEntry(spec);
    if (entry !== null) entries.push(entry);
  }

  for (const movie of input.movies) {
    const entry = entityDetailEntry(
      MOVIES_INDEX_PATH,
      movie,
      (count) =>
        evaluateMovieIndexability({ renderableBlockCount: count }).decision ===
        "index",
    );
    if (entry !== null) entries.push(entry);
  }
  for (const series of input.series) {
    const entry = entityDetailEntry(
      SERIES_INDEX_PATH,
      series,
      (count) =>
        evaluateSeriesIndexability({ renderableBlockCount: count }).decision ===
        "index",
    );
    if (entry !== null) entries.push(entry);
  }
  for (const person of input.people) {
    const entry = entityDetailEntry(
      PEOPLE_INDEX_PATH,
      person,
      (count) =>
        evaluatePersonIndexability({ renderableBlockCount: count }).decision ===
        "index",
    );
    if (entry !== null) entries.push(entry);
  }
  entries.push(...newsEntries);

  // Dedupe deterministico por URL (primeira ocorrencia vence).
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
