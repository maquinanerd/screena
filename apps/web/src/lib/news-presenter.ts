/**
 * news-presenter.ts - Monta as paginas publicas de noticias/blog (listagem +
 * artigo) a partir do payload controlado do PostgreSQL. PURO: sem rede/DB/IO.
 *
 * Regras duras:
 *  - so publica artigo com traducao pt-BR, review publicavel, slug/titulo e
 *    publishedAt reais, licenca clara e display permitido (invariantes 6/7/9);
 *  - nunca inventa autor, categoria, data, tempo de leitura, fonte ou resumo;
 *  - imagem hero so LOCAL segura (externo/tmdb/cru -> null -> fallback);
 *  - corpo proprio: renderizado como paragrafos (nao copia fonte externa);
 *  - fonte externa aparece como TEXTO (sem URL externa nesta fatia); linkback
 *    clicavel fica fora daqui, entao a fonte so aparece quando NAO exige linkback;
 *  - gate anti-thin: artigo sem corpo suficiente -> noindex; listagem fina ->
 *    noindex; a decisao editorial `index_status` tem a palavra final.
 */

import {
  evaluateIndexability,
  isArticlePublishable,
  type IndexabilityResult,
} from "@screena/seo";

import { mapKnownForDepartment } from "./person-presenter";
import { buildTmdbImageUrl } from "./tmdb-image-url";

/** Estados de review que podem aparecer no render publico. */
export const NEWS_RENDERABLE_REVIEW_STATUSES = ["human_reviewed", "published"] as const;
const NEWS_RENDERABLE_REVIEW_SET: ReadonlySet<string> = new Set(NEWS_RENDERABLE_REVIEW_STATUSES);

/** Licencas que permitem exibir o artigo em pagina publica (invariante 6). */
const DISPLAYABLE_LICENSES: ReadonlySet<string> = new Set(["official", "licensed", "third_party"]);

/** Itens exibidos na listagem (featured + feed) por pagina; sem paginacao. */
export const NEWS_INDEX_LIMIT = 24;

/**
 * Numero de artigos publicaveis a partir do qual a listagem e "rica" (sinal de
 * qualidade). NAO gate mais indexacao: basta >= 1 artigo publicavel para
 * indexar (politica 2026-07 — indexacao total); listagem vazia = noindex tecnico.
 */
export const MIN_NEWS_INDEX_ITEMS = 3;

/** Corpo minimo (chars, apos trim) para um artigo nao ser considerado fino. */
export const MIN_ARTICLE_BODY_CHARS = 200;

const LOCAL_IMAGE_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;
const LOCAL_IMAGE_EXTENSION_PATTERN = /\.(?:avif|jpg|jpeg|png|webp)$/i;
const HERO_IMAGE_SPEC = { width: 1280, height: 720 } as const;

const NEWS_PATH_PREFIX = "/pt/noticias/";
const MOVIE_PATH_PREFIX = "/pt/filmes/";
const SERIES_PATH_PREFIX = "/pt/series/";
const PERSON_PATH_PREFIX = "/pt/pessoas/";

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

export type NewsRelatedEntityType = "movie" | "tv" | "person";

export interface NewsImageAsset {
  src: string;
  width: number;
  height: number;
  /**
   * `alt` APROVADO pelo CMS, quando existe.
   *
   * `null` significa "o CMS nao aprovou descricao", nao "imagem decorativa" —
   * quem consome decide o fallback. Emitir string vazia aqui apagaria a
   * diferenca entre as duas coisas.
   */
  alt: string | null;
  /**
   * Credito de quem detem o direito sobre a imagem.
   *
   * `null` = o asset nao declarou credito. NAO e estetica: quando a licenca
   * exige atribuicao, o CMS recusa projetar sem `credit` (`attribution_missing`,
   * ver `docs/operations/editorial-media-projection.md` §2). Logo credito
   * presente equivale a atribuicao satisfeita, e exibi-lo e a obrigacao —
   * nunca um enfeite.
   */
  credit: string | null;
}

/**
 * Asset de capa GOVERNADO, projetado do CMS (`editorial_media_assets`).
 *
 * Chega pelo vinculo `articles.hero_media_asset_id`, entao o pareamento com a
 * capa e EXATO — diferente de `approvedImageAlt`, que so consegue chutar pela
 * ordem da lista (ver `firstApprovedAlt`).
 */
export interface NewsHeroMediaInput {
  alt: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
}

/** Fatos do artigo (Article) independentes de idioma. */
export interface ArticleFactsInput {
  authorName: string | null;
  category: string | null;
  heroImagePath: string | null;
  articlePublishedAtIso: string | null;
  readTimeMinutes: number | null;
  aiAssisted: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
  licenseStatus: string;
  displayAllowed: boolean;
  requiresAttribution: boolean;
  requiresLinkback: boolean;
  /** Asset de capa projetado do CMS. Ausente em artigo sem capa governada. */
  heroMedia?: NewsHeroMediaInput | null;
}

/** Traducao pt-BR do artigo (ArticleTranslation). */
export interface ArticleTranslationInput {
  slug: string | null;
  title: string | null;
  deck: string | null;
  body: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  // SEO APROVADO pelo CMS. Sinais, nunca estrutura: canonical, robots e o
  // JSON-LD final continuam DERIVADOS aqui no lado publico.
  socialTitle: string | null;
  socialDescription: string | null;
  canonicalOverride: string | null;
  articleSection: string | null;
  schemaTypeRecommendation: string | null;
  /** Lista APROVADA de `alt`, como projetada (JSON). */
  approvedImageAlt: unknown;
  reviewStatus: string;
  indexStatus: string;
  translationPublishedAtIso: string | null;
  translationUpdatedAtIso: string | null;
}

/** Item cru da listagem (facts + subset da traducao) para montar um card. */
export interface NewsListItemInput {
  authorName: string | null;
  category: string | null;
  heroImagePath: string | null;
  articlePublishedAtIso: string | null;
  readTimeMinutes: number | null;
  licenseStatus: string;
  displayAllowed: boolean;
  /** Atribuicao/linkback exigidos (invariante 6). Opcionais: default nao-exigido. */
  requiresAttribution?: boolean;
  requiresLinkback?: boolean;
  sourceName?: string | null;
  sourceUrl?: string | null;
  slug: string | null;
  title: string | null;
  deck: string | null;
  reviewStatus: string;
  translationPublishedAtIso: string | null;
  /**
   * Asset de capa projetado do CMS.
   *
   * No card ele e a UNICA origem de `alt`: a listagem nao carrega
   * `approvedImageAlt` (que vive na traducao). Sem ele o card ficava com
   * `alt` nulo na origem, e a imagem — unico identificador visual do link —
   * chegava muda ao leitor de tela.
   */
  heroMedia?: NewsHeroMediaInput | null;
}

/** Entidade relacionada JA resolvida pelo server (titulo + slug reais). */
export interface NewsRelatedEntityInput {
  entityType: NewsRelatedEntityType;
  title: string | null;
  slug: string | null;
}

export interface NewsCardView {
  slug: string;
  title: string;
  href: string;
  category: string | null;
  dateIso: string | null;
  dateLabel: string | null;
  author: string | null;
  deck: string | null;
  readTimeLabel: string | null;
  image: NewsImageAsset | null;
}

export interface NewsIndexView {
  featured: NewsCardView | null;
  cards: NewsCardView[];
  totalCount: number;
  hasMore: boolean;
}

export interface NewsRelatedEntity {
  entityType: NewsRelatedEntityType;
  title: string;
  href: string;
}

export interface NewsArticleSource {
  name: string;
}

export interface NewsArticleView {
  title: string;
  category: string | null;
  dateIso: string | null;
  dateLabel: string | null;
  author: string | null;
  readTimeLabel: string | null;
  deck: string | null;
  heroImage: NewsImageAsset | null;
  bodyParagraphs: string[];
  hasBody: boolean;
  aiAssisted: boolean;
  source: NewsArticleSource | null;
  metaTitle: string | null;
  metaDescription: string | null;
  socialTitle: string | null;
  socialDescription: string | null;
  canonicalOverride: string | null;
  articleSection: string | null;
  schemaTypeRecommendation: string | null;
  updatedAtIso: string | null;
  related: NewsRelatedEntity[];
  entityCard: NewsEntityCard | null;
}

export interface NewsIndexIndexabilityInput {
  itemCount: number;
}

export interface ArticleIndexabilityInput {
  indexStatus: string;
  bodySufficient: boolean;
  reviewStatusOk: boolean;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveIntOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function normalizeNewsLocalImagePath(
  path: string | null | undefined,
): string | null {
  const value = trimToNull(path);
  if (value === null) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("//")) return null;
  if (value.includes("\\") || value.includes("?") || value.includes("#")) return null;
  if (value.split("/").includes("..")) return null;
  if (!LOCAL_IMAGE_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  return LOCAL_IMAGE_EXTENSION_PATTERN.test(value) ? value : null;
}

/**
 * Placeholder que o CMS grava quando o editor NAO descreveu a imagem
 * (`publication.ts:259`) e que ele proprio filtra ao montar `approvedImageAlt`
 * (`publication.ts:355`). Filtrar aqui tambem impede que a nao-descricao
 * atravesse para o atributo `alt` — um alt que nao descreve e pior que nenhum,
 * porque o leitor de tela o anuncia como se fosse conteudo.
 */
const ALT_PLACEHOLDER = "sem descricao";

/** `alt` do asset, ja descartando o placeholder de nao-descricao. */
function mediaAlt(media: NewsHeroMediaInput | null): string | null {
  const alt = trimToNull(media?.alt ?? null);
  if (alt === null) return null;
  return alt.toLowerCase() === ALT_PLACEHOLDER ? null : alt;
}

/**
 * Monta a capa.
 *
 * ORIGEM DO `alt`, em ordem: o asset vinculado vence `approvedImageAlt`. O
 * vinculo `hero_media_asset_id` identifica EXATAMENTE a imagem da capa,
 * enquanto `approvedImageAlt` e uma lista sem pareamento por `mediaId` — ela
 * assume que o hero e o primeiro item. `approvedImageAlt` fica como fallback
 * para linhas projetadas antes do vinculo existir.
 *
 * `width`/`height` reais substituem o `HERO_IMAGE_SPEC` fixo quando o asset os
 * traz: 1280x720 fixo e uma afirmacao sobre o arquivo que pode simplesmente
 * nao ser verdade. O layout nao muda (as caixas sao dimensionadas por CSS, com
 * `object-fit: cover`) — o ganho e de correcao, nao de CLS.
 */
function heroImageAsset(
  path: string | null,
  approvedAlt: string | null = null,
  media: NewsHeroMediaInput | null = null,
): NewsImageAsset | null {
  const src = normalizeNewsLocalImagePath(path);
  if (src === null) return null;
  return {
    src,
    width: positiveIntOrNull(media?.width ?? null) ?? HERO_IMAGE_SPEC.width,
    height: positiveIntOrNull(media?.height ?? null) ?? HERO_IMAGE_SPEC.height,
    alt: mediaAlt(media) ?? approvedAlt,
    credit: trimToNull(media?.credit ?? null),
  };
}

/**
 * Primeiro `alt` APROVADO da lista projetada.
 *
 * Nao ha casamento por `mediaId` porque o lado publico guarda o caminho do
 * arquivo, nao o id do documento do CMS. A lista chega ordenada com o hero
 * primeiro, e usar o primeiro item e mais honesto do que inventar um pareamento
 * que nao existe: um alt errado numa imagem e pior que nenhum.
 */
function firstApprovedAlt(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (item === null || typeof item !== "object") continue;
    const alt = (item as { alt?: unknown }).alt;
    if (typeof alt === "string" && alt.trim() !== "") return alt.trim();
  }
  return null;
}

export function isPubliclyRenderableNewsReview(reviewStatus: string): boolean {
  return NEWS_RENDERABLE_REVIEW_SET.has(reviewStatus);
}

export function isDisplayableLicense(licenseStatus: string): boolean {
  return DISPLAYABLE_LICENSES.has(licenseStatus);
}

/** Data de publicacao efetiva: da traducao, senao do artigo. */
export function resolvePublishedIso(
  translationIso: string | null,
  articleIso: string | null,
): string | null {
  return trimToNull(translationIso) ?? trimToNull(articleIso);
}

/** Formata "YYYY-MM-DD..." em pt-BR: "30 de junho de 2026". `null` se invalido. */
export function formatNewsDate(iso: string | null): string | null {
  const value = trimToNull(iso);
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} de ${MONTHS_PT[month - 1]} de ${year}`;
}

export function formatReadTime(minutes: number | null): string | null {
  const value = positiveIntOrNull(minutes);
  return value === null ? null : `${value} min de leitura`;
}

/** Quebra o corpo em paragrafos (por linha em branco), sem paragrafos vazios. */
export function bodyParagraphs(body: string | null): string[] {
  const value = trimToNull(body);
  if (value === null) return [];
  return value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function isSufficientBody(body: string | null): boolean {
  const value = trimToNull(body);
  return value !== null && value.length >= MIN_ARTICLE_BODY_CHARS;
}

/**
 * Um artigo e publicavel quando: review publicavel, slug/titulo reais,
 * publishedAt presente E JA ALCANCADO, licenca clara e display permitido
 * (invariante 6).
 *
 * Delega ao gate canonico `evaluateArticlePublication` de `@screena/seo` — a
 * MESMA regra usada pelo sitemap, pela projecao de busca e pelo produtor de
 * `page_indexability_decisions`. Manter uma copia local da regra aqui era o
 * que permitia as superficies divergirem.
 *
 * `nowIso` e OBRIGATORIO e injetado: uma materia com `published_at` no futuro
 * (agendada/embargada) tem data preenchida e review `published`, entao um gate
 * que so pergunta "tem data?" a considera publicavel e vaza o embargo.
 */
export function isPublishableArticle(
  input: {
    reviewStatus: string;
    licenseStatus: string;
    displayAllowed: boolean;
    slug: string | null;
    title: string | null;
    publishedAtIso: string | null;
  },
  nowIso: string,
): boolean {
  return isArticlePublishable(input, nowIso);
}

/** Fatos de atribuicao/linkback do artigo (Article). */
export interface ArticleAttributionInput {
  requiresAttribution: boolean;
  requiresLinkback: boolean;
  sourceName: string | null;
  sourceUrl: string | null;
}

/**
 * Atribuicao/linkback satisfeitos (invariante 6): quando a licenca exige credito
 * (`requiresAttribution`), a fonte precisa estar presente; quando exige linkback
 * (`requiresLinkback`), a URL da fonte precisa estar presente. Sem isso, o artigo
 * NAO pode aparecer em pagina indexavel nem como card — fail-closed.
 */
export function isNewsAttributionSatisfied(input: ArticleAttributionInput): boolean {
  if (input.requiresAttribution && trimToNull(input.sourceName) === null) return false;
  if (input.requiresLinkback && trimToNull(input.sourceUrl) === null) return false;
  return true;
}

export function buildNewsCard(
  input: NewsListItemInput,
  nowIso: string,
): NewsCardView | null {
  const slug = trimToNull(input.slug);
  const title = trimToNull(input.title);
  const publishedIso = resolvePublishedIso(
    input.translationPublishedAtIso,
    input.articlePublishedAtIso,
  );
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
    ) ||
    !isNewsAttributionSatisfied({
      requiresAttribution: input.requiresAttribution ?? false,
      requiresLinkback: input.requiresLinkback ?? false,
      sourceName: input.sourceName ?? null,
      sourceUrl: input.sourceUrl ?? null,
    })
  ) {
    return null;
  }
  return {
    slug: slug as string,
    title: title as string,
    href: `${NEWS_PATH_PREFIX}${slug}/`,
    category: trimToNull(input.category),
    dateIso: publishedIso,
    dateLabel: formatNewsDate(publishedIso),
    author: trimToNull(input.authorName),
    deck: trimToNull(input.deck),
    readTimeLabel: formatReadTime(input.readTimeMinutes),
    image: heroImageAsset(input.heroImagePath, null, input.heroMedia ?? null),
  };
}

/** Listagem: publicaveis, ordenados por data desc (depois titulo), com featured. */
export function buildNewsIndexView(
  items: NewsListItemInput[],
  nowIso: string,
): NewsIndexView {
  const cards = items
    .map((item) => buildNewsCard(item, nowIso))
    .filter((card): card is NewsCardView => card !== null);
  cards.sort((a, b) => {
    const ad = a.dateIso ?? "";
    const bd = b.dateIso ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.title.localeCompare(b.title);
  });
  const totalCount = cards.length;
  const capped = cards.slice(0, NEWS_INDEX_LIMIT);
  return {
    featured: capped[0] ?? null,
    cards: capped.slice(1),
    totalCount,
    hasMore: totalCount > capped.length,
  };
}

function creditHref(entityType: NewsRelatedEntityType, slug: string): string {
  if (entityType === "movie") return `${MOVIE_PATH_PREFIX}${slug}/`;
  if (entityType === "tv") return `${SERIES_PATH_PREFIX}${slug}/`;
  return `${PERSON_PATH_PREFIX}${slug}/`;
}

/** So entra o relacionado que resolve titulo + slug reais (nunca inventado). */
export function buildNewsRelated(
  inputs: NewsRelatedEntityInput[],
): NewsRelatedEntity[] {
  const out: NewsRelatedEntity[] = [];
  for (const item of inputs) {
    const title = trimToNull(item.title);
    const slug = trimToNull(item.slug);
    if (title === null || slug === null) continue;
    out.push({ entityType: item.entityType, title, href: creditHref(item.entityType, slug) });
  }
  return out;
}

/** Payload controlado da "Ficha do titulo" (tela 05): 1a entidade citada. */
export interface NewsEntityCardInput {
  entityType: "movie" | "tv" | "person";
  id: string;
  titleOriginal: string | null;
  translationTitle: string | null;
  summary: string | null;
  slug: string | null;
  posterPath: string | null;
  year: number | null;
  /** Numero de temporadas conhecidas (apenas tv); null quando desconhecido. */
  seasonCount: number | null;
  /**
   * `known_for_department` cru do TMDB (apenas person); traduzido no builder
   * pelo MESMO mapa da pagina de pessoa — desconhecido nao vaza ingles cru.
   */
  knownForDepartment?: string | null;
}

export interface NewsEntityCard {
  entityType: "movie" | "tv" | "person";
  entityId: string;
  title: string;
  href: string;
  posterUrl: string | null;
  /** Linha de meta honesta (ano / temporadas / funcao reais); null quando nada ha. */
  metaLine: string | null;
  summary: string | null;
  kicker: string;
}

/**
 * Ficha do titulo citada na materia (tela 05). So nasce com titulo + slug
 * reais; meta apenas com fatos persistidos (ano, temporadas) — nunca nota
 * inventada (Cinerie Score continua bloqueado; ratings externos inativos).
 */
export function buildNewsEntityCard(
  input: NewsEntityCardInput | null,
): NewsEntityCard | null {
  if (input === null) return null;
  const title = trimToNull(input.translationTitle) ?? trimToNull(input.titleOriginal);
  const slug = trimToNull(input.slug);
  if (title === null || slug === null) return null;
  const metaParts: string[] = [];
  if (input.year !== null && Number.isInteger(input.year)) metaParts.push(String(input.year));
  if (input.entityType === "tv") {
    const seasons = positiveIntOrNull(input.seasonCount);
    if (seasons !== null) {
      metaParts.push(seasons === 1 ? "1 temporada" : `${seasons} temporadas`);
    }
  }
  if (input.entityType === "person") {
    // A MESMA traducao da pagina de pessoa: valor desconhecido -> null, nunca
    // ingles cru do TMDB nem funcao inventada.
    const role = mapKnownForDepartment(input.knownForDepartment ?? null);
    if (role !== null) metaParts.push(role);
  }
  return {
    entityType: input.entityType,
    entityId: input.id,
    title,
    href: creditHref(input.entityType, slug),
    posterUrl: buildTmdbImageUrl(input.posterPath, "w500"),
    metaLine: metaParts.length > 0 ? metaParts.join(" · ") : null,
    summary: trimToNull(input.summary),
    kicker: ENTITY_CARD_KICKERS[input.entityType],
  };
}

/**
 * Kicker por tipo — os TRES tipos linkaveis da ficha. `person` existia no
 * contrato desde sempre e era descartado em silencio no render (o emissor
 * estava certo; o renderizador nao linkava pessoa).
 */
const ENTITY_CARD_KICKERS: Readonly<Record<NewsEntityCard["entityType"], string>> = {
  movie: "Filme · citado nesta matéria",
  tv: "Série · citada nesta matéria",
  person: "Pessoa · citada nesta matéria",
};

/**
 * Rotulo do link da ficha, por tipo — o TEXTO diz o tipo, nunca so a cor
 * (invariante 11). Fonte unica para o bloco do corpo e para a ficha do rodape.
 */
export const NEWS_ENTITY_CARD_LINK_LABELS: Readonly<
  Record<NewsEntityCard["entityType"], string>
> = {
  movie: "Ver página do filme",
  tv: "Ver página da série",
  person: "Ver página da pessoa",
};

export interface BuildNewsArticleViewInput {
  facts: ArticleFactsInput;
  translation: ArticleTranslationInput;
  related: NewsRelatedEntityInput[];
  entityCard?: NewsEntityCardInput | null;
}

export function buildNewsArticleView(input: BuildNewsArticleViewInput): NewsArticleView {
  const { facts, translation } = input;
  const publishedIso = resolvePublishedIso(
    translation.translationPublishedAtIso,
    facts.articlePublishedAtIso,
  );
  const sourceName = trimToNull(facts.sourceName);
  // Fonte so aparece como TEXTO e apenas quando NAO exige linkback (nesta fatia
  // nao renderizamos URL externa). Assim nunca exibimos credito sem o link que a
  // licenca exigiria.
  const source: NewsArticleSource | null =
    sourceName !== null && facts.requiresLinkback === false ? { name: sourceName } : null;

  return {
    title: trimToNull(translation.title) ?? "",
    category: trimToNull(facts.category),
    dateIso: publishedIso,
    dateLabel: formatNewsDate(publishedIso),
    author: trimToNull(facts.authorName),
    readTimeLabel: formatReadTime(facts.readTimeMinutes),
    deck: trimToNull(translation.deck),
    heroImage: heroImageAsset(
      facts.heroImagePath,
      firstApprovedAlt(translation.approvedImageAlt),
      facts.heroMedia ?? null,
    ),
    bodyParagraphs: bodyParagraphs(translation.body),
    hasBody: isSufficientBody(translation.body),
    aiAssisted: facts.aiAssisted === true,
    source,
    metaTitle: trimToNull(translation.metaTitle),
    metaDescription: trimToNull(translation.metaDescription),
    socialTitle: trimToNull(translation.socialTitle),
    socialDescription: trimToNull(translation.socialDescription),
    canonicalOverride: trimToNull(translation.canonicalOverride),
    // A secao APROVADA vence `category`: `articles.category` e texto livre e
    // nao classifica vertical, enquanto `articleSection` passou pela revisao.
    articleSection: trimToNull(translation.articleSection) ?? trimToNull(facts.category),
    schemaTypeRecommendation: trimToNull(translation.schemaTypeRecommendation),
    updatedAtIso: translation.translationUpdatedAtIso,
    related: buildNewsRelated(input.related),
    entityCard: buildNewsEntityCard(input.entityCard ?? null),
  };
}

/**
 * Indexabilidade da listagem de noticias (politica 2026-07 — indexacao total):
 * listagem com >= 1 artigo publicavel indexa; listagem vazia -> `noindex`.
 */
export function evaluateNewsIndexIndexability(
  input: NewsIndexIndexabilityInput,
): IndexabilityResult {
  const count = input.itemCount < 0 ? 0 : input.itemCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: count > 0,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: 0,
    reviewStatusOk: true,
  });
}

/**
 * Indexabilidade do artigo (noticia = conteudo editorial, nao entidade
 * sincronizada). Politica 2026-07: corpo insuficiente e caso tecnico/vazio ->
 * `noindex`. Alem disso, a decisao editorial `index_status` e o `review_status`
 * publicavel tem a palavra final: so indexa com `index_status = 'index'` e
 * revisao publicavel.
 */
export function evaluateArticleIndexability(
  input: ArticleIndexabilityInput,
): IndexabilityResult {
  const base = evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: input.bodySufficient,
    valueBlocksCount: input.bodySufficient ? 2 : 0,
    displayedRatings: [],
    thinContentScore: 0,
    reviewStatusOk: input.reviewStatusOk,
  });
  if (
    base.decision === "index" &&
    (input.indexStatus !== "index" || !input.reviewStatusOk)
  ) {
    return {
      ...base,
      decision: "noindex",
      reason: `Decisao editorial mantem noindex (index_status='${input.indexStatus}', review publicavel=${input.reviewStatusOk}).`,
    };
  }
  return base;
}
