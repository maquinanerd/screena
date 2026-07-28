/**
 * home-editorial-presenter.ts — Presenter PURO da seção "Destaques de hoje" da
 * home. Sem rede, sem DB, sem IO.
 *
 * A seção é EDITORIAL: os três cards são MATÉRIAS publicadas (`articles` +
 * `article_translations`), nunca fichas de catálogo. Todo card aponta para
 * `/pt/noticias/{slug}/`.
 *
 * Três regras duras:
 *
 *  1. PUBLICABILIDADE — reusa o gate único de `@screena/seo`
 *     (`isPublishableArticle`) e o de atribuição (`isNewsAttributionSatisfied`),
 *     os MESMOS que a listagem de notícias e a página de artigo usam. Rascunho,
 *     matéria agendada (`published_at` no futuro), retratada (`blocked`/
 *     `archived`), sem slug/título, sem licença clara ou sem o crédito exigido
 *     NUNCA entram (invariantes 6/7).
 *
 *  2. CLASSIFICAÇÃO POR SINAL PERSISTIDO — a vertical vem dos `entity_news_links`
 *     da matéria (tipos reais `movie`/`tv`), nunca de palavra-chave no título.
 *     `Article.category` é `String?` de texto livre, SEM vocabulário controlado
 *     e SEM enum no schema (o próprio schema anota `// v2: FK ArticleCategory`);
 *     casá-la contra "Séries"/"Cinema" seria exatamente a heurística de
 *     palavra-chave proibida. Ela é usada só como EYEBROW (rótulo editorial
 *     exibido), nunca como classificador.
 *
 *  3. IMAGEM EDITORIAL — `Article.heroImagePath` normalizado pelo MESMO
 *     validador local das notícias (`normalizeNewsLocalImagePath`). Sem imagem
 *     publicável o card usa o placeholder editorial do sistema; NUNCA o pôster
 *     da entidade relacionada e nunca mídia externa no render.
 */

import {
  isNewsAttributionSatisfied,
  isPublishableArticle,
  normalizeNewsLocalImagePath,
  resolvePublishedIso,
} from "./news-presenter";
import { NEWS_INDEX_PATH } from "./routes";

/** Verticais editoriais da seção (filtros internos, nunca rotas). */
export type HomeEditorialVertical = "movies" | "series";

/** Rótulo humano de cada vertical (usado como eyebrow de reserva). */
export const HOME_EDITORIAL_VERTICAL_LABEL: Readonly<
  Record<HomeEditorialVertical, string>
> = {
  movies: "Filmes",
  series: "Séries",
};

/** Cards visíveis por vez na seção (composição canônica: 1 lead + 2 pôsteres). */
export const HOME_EDITORIAL_VISIBLE = 3;

/**
 * Candidatas carregadas por vertical no loader. Maior que `HOME_EDITORIAL_VISIBLE`
 * de propósito: dá folga para rotação futura sem nova query. NÃO implica
 * carrossel — o canônico mostra três cards fixos.
 */
export const HOME_EDITORIAL_LOADER_LIMIT = 6;

/** Tipos de entidade que a matéria pode citar e que classificam a vertical. */
export type HomeEditorialLinkType = "movie" | "tv" | "person";

/** Card editorial já publicável, classificado e pronto para o componente. */
export interface HomeEditorialHighlight {
  /** `articles.id` como string (BigInt nunca atravessa para Client Component). */
  articleId: string;
  slug: string;
  /** Sempre `/pt/noticias/{slug}/`. */
  href: string;
  /** Vertical do FILTRO em que este card aparece (híbrida aparece nos dois). */
  vertical: HomeEditorialVertical;
  /** Rótulo editorial curto: `articles.category` real, ou o rótulo da vertical. */
  eyebrow: string;
  title: string;
  /** `article_translations.deck` — exibido só no card principal. */
  deck: string | null;
  /** Caminho LOCAL já validado, ou null (placeholder editorial). */
  imagePath: string | null;
  imageAlt: string;
  publishedAtIso: string;
}

/** Entrada crua (uma tradução pt-BR + o artigo + os vínculos persistidos). */
export interface HomeEditorialArticleInput {
  articleId: string;
  slug: string | null;
  title: string | null;
  deck: string | null;
  reviewStatus: string;
  translationPublishedAtIso: string | null;
  articlePublishedAtIso: string | null;
  category: string | null;
  heroImagePath: string | null;
  licenseStatus: string;
  displayAllowed: boolean;
  requiresAttribution: boolean;
  requiresLinkback: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  /** Tipos das entidades citadas pela matéria (persistidos, não inferidos). */
  linkedEntityTypes: readonly HomeEditorialLinkType[];
}

/** Saída da seção: uma lista por vertical (o componente só troca qual mostra). */
export interface HomeEditorialHighlights {
  movies: readonly HomeEditorialHighlight[];
  series: readonly HomeEditorialHighlight[];
}

export const EMPTY_HOME_EDITORIAL_HIGHLIGHTS: HomeEditorialHighlights = {
  movies: [],
  series: [],
};

function trimToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Verticais de uma matéria, a partir SÓ dos tipos de entidade persistidos:
 *
 *  - só `movie`            -> `["movies"]`
 *  - só `tv`               -> `["series"]`
 *  - `movie` + `tv`        -> `["movies", "series"]` (aparece nos dois filtros)
 *  - só `person`, ou nenhum vínculo -> `[]` (não entra na seção)
 *
 * `person` sozinha não classifica: uma entrevista sem título vinculado não é
 * nem "de filmes" nem "de séries" — e classificação sem sinal confiável é
 * exatamente o que a regra proíbe. `season`/`episode` não chegam aqui (o loader
 * só consulta `movie`/`tv`/`person`).
 */
export function classifyEditorialVerticals(
  linkedEntityTypes: readonly HomeEditorialLinkType[],
): readonly HomeEditorialVertical[] {
  const hasMovie = linkedEntityTypes.includes("movie");
  const hasTv = linkedEntityTypes.includes("tv");
  const out: HomeEditorialVertical[] = [];
  if (hasMovie) out.push("movies");
  if (hasTv) out.push("series");
  return out;
}

/**
 * Ordenação DETERMINÍSTICA e estável: data de publicação decrescente e, no
 * empate, `articleId` crescente. Sem aleatoriedade, sem popularidade TMDB, sem
 * contagem de votos — a ordem é a mesma a cada request para o mesmo dado.
 *
 * Não existe campo de destaque/`featured` persistido em `articles` (conferido no
 * schema): o "featured" da listagem de notícias é apenas o primeiro card já
 * ordenado. Por isso o critério 1 do contrato editorial não tem fonte e a
 * ordenação começa direto pela data — inventar prioridade seria heurística não
 * persistida.
 */
function compareHighlights(
  a: HomeEditorialHighlight,
  b: HomeEditorialHighlight,
): number {
  if (a.publishedAtIso !== b.publishedAtIso) {
    return a.publishedAtIso < b.publishedAtIso ? 1 : -1;
  }
  const left = Number(a.articleId);
  const right = Number(b.articleId);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) {
    return left - right;
  }
  return a.articleId.localeCompare(b.articleId);
}

/**
 * Monta um card editorial publicável, ou `null` quando a matéria não pode
 * aparecer. `nowIso` é INJETADO: sem ele o embargo (matéria agendada) vazaria.
 */
function buildHighlight(
  input: HomeEditorialArticleInput,
  vertical: HomeEditorialVertical,
  nowIso: string,
): HomeEditorialHighlight | null {
  const slug = trimToNull(input.slug);
  const title = trimToNull(input.title);
  const publishedIso = resolvePublishedIso(
    input.translationPublishedAtIso,
    input.articlePublishedAtIso,
  );

  // Gate ÚNICO de publicação (o mesmo de /pt/noticias/ e da página de artigo).
  if (
    !isPublishableArticle(
      {
        reviewStatus: input.reviewStatus,
        licenseStatus: input.licenseStatus,
        displayAllowed: input.displayAllowed,
        slug,
        title,
        publishedAtIso: publishedIso,
      },
      nowIso,
    )
  ) {
    return null;
  }
  if (
    !isNewsAttributionSatisfied({
      requiresAttribution: input.requiresAttribution,
      requiresLinkback: input.requiresLinkback,
      sourceName: input.sourceName,
      sourceUrl: input.sourceUrl,
    })
  ) {
    return null;
  }
  // `isPublishableArticle` já garantiu os três abaixo; o estreitamento aqui é
  // só para o compilador (nunca relaxa a regra).
  if (slug === null || title === null || publishedIso === null) return null;

  return {
    articleId: input.articleId,
    slug,
    href: `${NEWS_INDEX_PATH}${slug}/`,
    vertical,
    eyebrow: trimToNull(input.category) ?? HOME_EDITORIAL_VERTICAL_LABEL[vertical],
    title,
    deck: trimToNull(input.deck),
    imagePath: normalizeNewsLocalImagePath(input.heroImagePath),
    imageAlt: title,
    publishedAtIso: publishedIso,
  };
}

/**
 * Destaques editoriais por vertical, já filtrados, classificados, ordenados e
 * limitados. Uma matéria híbrida (filme + série) aparece nas DUAS listas, cada
 * uma com o seu `vertical` — é a mesma matéria vista por dois filtros, não uma
 * duplicata.
 */
export function buildHomeEditorialHighlights(
  inputs: readonly HomeEditorialArticleInput[],
  nowIso: string,
  limit: number = HOME_EDITORIAL_LOADER_LIMIT,
): HomeEditorialHighlights {
  const movies: HomeEditorialHighlight[] = [];
  const series: HomeEditorialHighlight[] = [];

  for (const input of inputs) {
    for (const vertical of classifyEditorialVerticals(input.linkedEntityTypes)) {
      const card = buildHighlight(input, vertical, nowIso);
      if (card === null) continue;
      if (vertical === "movies") movies.push(card);
      else series.push(card);
    }
  }

  const cap = Number.isInteger(limit) && limit > 0 ? limit : HOME_EDITORIAL_LOADER_LIMIT;
  return {
    movies: movies.sort(compareHighlights).slice(0, cap),
    series: series.sort(compareHighlights).slice(0, cap),
  };
}

/** Há alguma matéria em qualquer vertical? Seção vazia = seção omitida. */
export function hasEditorialHighlights(
  highlights: HomeEditorialHighlights,
): boolean {
  return highlights.movies.length > 0 || highlights.series.length > 0;
}
