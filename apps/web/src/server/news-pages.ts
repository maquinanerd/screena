/**
 * news-pages.ts - Camada de dados SERVER-ONLY das paginas publicas de noticias.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, WordPress, MN26 ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 *
 * So promove artigo publicavel (traducao pt-BR + review publicavel + slug/titulo
 * + publishedAt + licenca clara + display permitido). Relacionados (EntityNewsLink)
 * so viram link quando o alvo movie|tv|person tem titulo publico e slug canonico.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildArticleBodyBlocks,
  collectArticleBodyReferences,
  type ArticleBodyBlock,
  type ArticleBodyHydration,
} from "../lib/article-body-presenter";
import { SITE_URL } from "../lib/site";
import {
  buildNewsArticleView,
  buildNewsCard,
  buildNewsIndexView,
  evaluateArticleIndexability,
  evaluateNewsIndexIndexability,
  isNewsAttributionSatisfied,
  isPublishableArticle,
  isSufficientBody,
  NEWS_RENDERABLE_REVIEW_STATUSES,
  resolvePublishedIso,
  type NewsArticleView,
  type NewsIndexView,
  type NewsCardView,
  type NewsEntityCardInput,
  type NewsLinkedEntityType,
  type NewsListItemInput,
  type NewsRelatedEntityInput,
  type NewsRelatedEntityType,
} from "../lib/news-presenter";
import type { IndexabilityResult } from "@screena/seo";

const LANGUAGE_CODE = "pt-BR";
const NEWS_INDEX_PATH = "/pt/noticias/";

/** Tipos de vinculo que classificam a vertical de uma materia (o resto e ignorado). */
const NEWS_CLASSIFYING_LINK_TYPES = ["movie", "tv", "person"] as const;

/**
 * Colunas do asset de capa (`editorial_media_assets`) que o render consome.
 *
 * SO estas quatro. A linha tem licenca, hash, chave de storage e MIME — nada
 * disso e assunto de render, e trazer coluna a mais numa listagem sem `take`
 * (ver `getNewsIndexData`) multiplica payload por artigo publicado.
 *
 * Custo: `heroMediaAsset` e relacao to-one e o schema NAO liga o preview
 * `relationJoins`, entao o Prisma resolve com UMA consulta extra em lote
 * (`WHERE id IN (...)`) por chamada — nao um SELECT por artigo. Sem N+1.
 */
const HERO_MEDIA_SELECT = {
  alt: true,
  credit: true,
  width: true,
  height: true,
} as const;

export interface NewsIndexData {
  view: NewsIndexView;
  indexability: IndexabilityResult;
  canonicalUrl: string;
}

export interface NewsArticleData {
  view: NewsArticleView;
  indexability: IndexabilityResult;
  canonicalSlug: string;
  canonicalUrl: string;
  /** "Leia tambem" (tela 05): outros artigos publicaveis reais. */
  readAlso: NewsCardView[];
  /**
   * Corpo ESTRUTURADO projetado do CMS. Vazio = a pagina cai no corpo textual
   * legado (`view.bodyParagraphs`). Os dois nunca sao renderizados juntos: seria
   * o mesmo texto duas vezes.
   */
  bodyBlocks: ArticleBodyBlock[];
}

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function newsCanonicalUrl(slug: string): string {
  return `${SITE_URL}${NEWS_INDEX_PATH}${slug}/`;
}

export const getNewsIndexData = cache(async (): Promise<NewsIndexData> => {
  const prisma = getPrismaClient();

  const rows = await prisma.articleTranslation.findMany({
    where: {
      languageCode: LANGUAGE_CODE,
      reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
    },
    select: {
      articleId: true,
      slug: true,
      title: true,
      deck: true,
      reviewStatus: true,
      publishedAt: true,
      article: {
        select: {
          authorName: true,
          category: true,
          heroImagePath: true,
          publishedAt: true,
          readTimeMinutes: true,
          licenseStatus: true,
          displayAllowed: true,
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: true,
          sourceUrl: true,
          heroMediaAsset: { select: HERO_MEDIA_SELECT },
        },
      },
    },
  });

  // Vinculos de TODAS as materias lidas em UMA query (nunca uma por card). E o
  // unico sinal persistido de vertical de uma materia — a listagem /pt/noticias/
  // continua sendo a uniao, mas a pagina de vertical passa a poder filtrar.
  const links =
    rows.length === 0
      ? []
      : await prisma.entityNewsLink.findMany({
          where: {
            articleId: { in: rows.map((row) => row.articleId) },
            entityType: { in: [...NEWS_CLASSIFYING_LINK_TYPES] },
          },
          select: { articleId: true, entityType: true },
        });
  const typesByArticle = new Map<string, Set<NewsLinkedEntityType>>();
  for (const link of links) {
    const key = link.articleId.toString();
    const bucket = typesByArticle.get(key) ?? new Set<NewsLinkedEntityType>();
    bucket.add(link.entityType as NewsLinkedEntityType);
    typesByArticle.set(key, bucket);
  }

  const items: NewsListItemInput[] = rows.map((row) => ({
    linkedEntityTypes: [...(typesByArticle.get(row.articleId.toString()) ?? [])],
    authorName: row.article.authorName,
    category: row.article.category,
    heroImagePath: row.article.heroImagePath,
    heroMedia: row.article.heroMediaAsset,
    articlePublishedAtIso: isoDate(row.article.publishedAt),
    readTimeMinutes: row.article.readTimeMinutes,
    licenseStatus: String(row.article.licenseStatus),
    displayAllowed: row.article.displayAllowed,
    requiresAttribution: row.article.requiresAttribution,
    requiresLinkback: row.article.requiresLinkback,
    sourceName: row.article.sourceName,
    sourceUrl: row.article.sourceUrl,
    slug: row.slug,
    title: row.title,
    deck: row.deck,
    reviewStatus: String(row.reviewStatus),
    translationPublishedAtIso: isoDate(row.publishedAt),
  }));

  // Instante da avaliacao: mantem materia agendada (published_at futuro) fora
  // da listagem. Capturado UMA vez para que todos os cards do mesmo request
  // sejam avaliados contra o mesmo relogio.
  const view = buildNewsIndexView(items, new Date().toISOString());
  return {
    view,
    indexability: evaluateNewsIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${NEWS_INDEX_PATH}`,
  };
});

export const getNewsArticleData = cache(
  async (slug: string): Promise<NewsArticleData | null> => {
    const prisma = getPrismaClient();

    const translation = await prisma.articleTranslation.findFirst({
      where: { languageCode: LANGUAGE_CODE, slug },
      select: {
        articleId: true,
        slug: true,
        title: true,
        deck: true,
        body: true,
        bodyBlocks: true,
        metaTitle: true,
        metaDescription: true,
        socialTitle: true,
        socialDescription: true,
        canonicalOverride: true,
        articleSection: true,
        schemaTypeRecommendation: true,
        approvedImageAlt: true,
        reviewStatus: true,
        indexStatus: true,
        publishedAt: true,
        updatedAt: true,
        article: {
          select: {
            authorName: true,
            category: true,
            heroImagePath: true,
            publishedAt: true,
            readTimeMinutes: true,
            aiAssisted: true,
            sourceName: true,
            sourceUrl: true,
            licenseStatus: true,
            displayAllowed: true,
            requiresAttribution: true,
            requiresLinkback: true,
            heroMediaAsset: { select: HERO_MEDIA_SELECT },
          },
        },
      },
    });
    if (translation === null) return null;

    const publishedIso = resolvePublishedIso(
      isoDate(translation.publishedAt),
      isoDate(translation.article.publishedAt),
    );
    const reviewStatus = String(translation.reviewStatus);
    if (
      !isPublishableArticle(
        {
          reviewStatus,
          licenseStatus: String(translation.article.licenseStatus),
          displayAllowed: translation.article.displayAllowed,
          slug: translation.slug,
          title: translation.title,
          publishedAtIso: publishedIso,
        },
        new Date().toISOString(),
      ) ||
      !isNewsAttributionSatisfied({
        requiresAttribution: translation.article.requiresAttribution,
        requiresLinkback: translation.article.requiresLinkback,
        sourceName: translation.article.sourceName,
        sourceUrl: translation.article.sourceUrl,
      })
    ) {
      // Nao publicavel (rascunho, agendada para o futuro, licenca/display/
      // atribuicao bloqueados) -> 404.
      return null;
    }

    const related = await resolveRelated(prisma, translation.articleId);
    const [entityCard, readAlso, bodyHydration] = await Promise.all([
      resolveEntityCard(prisma, translation.articleId),
      resolveReadAlso(prisma, translation.slug),
      resolveBodyHydration(prisma, translation.bodyBlocks),
    ]);
    const bodyBlocks = buildArticleBodyBlocks(translation.bodyBlocks, bodyHydration);

    const view = buildNewsArticleView({
      facts: {
        authorName: translation.article.authorName,
        category: translation.article.category,
        heroImagePath: translation.article.heroImagePath,
        heroMedia: translation.article.heroMediaAsset,
        articlePublishedAtIso: isoDate(translation.article.publishedAt),
        readTimeMinutes: translation.article.readTimeMinutes,
        aiAssisted: translation.article.aiAssisted,
        sourceName: translation.article.sourceName,
        sourceUrl: translation.article.sourceUrl,
        licenseStatus: String(translation.article.licenseStatus),
        displayAllowed: translation.article.displayAllowed,
        requiresAttribution: translation.article.requiresAttribution,
        requiresLinkback: translation.article.requiresLinkback,
      },
      translation: {
        slug: translation.slug,
        title: translation.title,
        deck: translation.deck,
        body: translation.body,
        metaTitle: translation.metaTitle,
        metaDescription: translation.metaDescription,
        socialTitle: translation.socialTitle,
        socialDescription: translation.socialDescription,
        canonicalOverride: translation.canonicalOverride,
        articleSection: translation.articleSection,
        schemaTypeRecommendation: translation.schemaTypeRecommendation,
        approvedImageAlt: translation.approvedImageAlt,
        reviewStatus,
        indexStatus: String(translation.indexStatus),
        translationPublishedAtIso: isoDate(translation.publishedAt),
        translationUpdatedAtIso: isoDate(translation.updatedAt),
      },
      related,
      entityCard,
    });

    const indexability = evaluateArticleIndexability({
      indexStatus: String(translation.indexStatus),
      bodySufficient: isSufficientBody(translation.body),
      reviewStatusOk: true,
    });

    return {
      view,
      indexability,
      canonicalSlug: translation.slug,
      canonicalUrl: newsCanonicalUrl(translation.slug),
      readAlso,
      bodyBlocks,
    };
  },
);

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Resolve os EntityNewsLink em relacionados com titulo + slug canonico reais. */
async function resolveRelated(
  prisma: PrismaClient,
  articleId: bigint,
): Promise<NewsRelatedEntityInput[]> {
  const links = await prisma.entityNewsLink.findMany({
    where: { articleId },
    select: { entityType: true, entityId: true },
  });
  if (links.length === 0) return [];

  const movieIds = new Set<bigint>();
  const tvIds = new Set<bigint>();
  const personIds = new Set<bigint>();
  for (const link of links) {
    if (link.entityType === "movie") movieIds.add(link.entityId);
    else if (link.entityType === "tv") tvIds.add(link.entityId);
    else if (link.entityType === "person") personIds.add(link.entityId);
  }

  const resolved = new Map<string, { title: string; slug: string | null }>();
  await Promise.all([
    resolveTargets(prisma, "movie", [...movieIds], resolved),
    resolveTargets(prisma, "tv", [...tvIds], resolved),
    resolveTargets(prisma, "person", [...personIds], resolved),
  ]);

  const out: NewsRelatedEntityInput[] = [];
  for (const link of links) {
    const type = link.entityType;
    if (type !== "movie" && type !== "tv" && type !== "person") continue;
    const target = resolved.get(`${type}:${link.entityId.toString()}`);
    if (target === undefined) continue;
    out.push({
      entityType: type as NewsRelatedEntityType,
      title: target.title,
      slug: target.slug,
    });
  }
  return out;
}

async function resolveTargets(
  prisma: PrismaClient,
  entityType: NewsRelatedEntityType,
  ids: bigint[],
  out: Map<string, { title: string; slug: string | null }>,
): Promise<void> {
  if (ids.length === 0) return;

  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityId: true, slug: true },
    }),
  ]);

  const translatedTitle = new Map<string, string>();
  for (const row of translations) {
    const title = row.title?.trim();
    if (title) translatedTitle.set(row.entityId.toString(), title);
  }
  const canonicalSlug = new Map<string, string>();
  for (const row of slugs) canonicalSlug.set(row.entityId.toString(), row.slug);

  if (entityType === "movie") {
    const movies = await prisma.movie.findMany({
      where: { id: { in: ids } },
      select: { id: true, titleOriginal: true },
    });
    for (const movie of movies) {
      const key = movie.id.toString();
      out.set(`movie:${key}`, {
        title: translatedTitle.get(key) ?? movie.titleOriginal,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  } else if (entityType === "tv") {
    const shows = await prisma.tvShow.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameOriginal: true },
    });
    for (const show of shows) {
      const key = show.id.toString();
      out.set(`tv:${key}`, {
        title: translatedTitle.get(key) ?? show.nameOriginal,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  } else {
    const people = await prisma.person.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const person of people) {
      const key = person.id.toString();
      out.set(`person:${key}`, {
        title: translatedTitle.get(key) ?? person.name,
        slug: canonicalSlug.get(key) ?? null,
      });
    }
  }
}

/**
 * "Ficha do titulo" (tela 05): hidrata a PRIMEIRA entidade movie|tv citada na
 * materia com fatos persistidos (titulo pt-BR, slug canonico, poster, ano,
 * temporadas, resumo). Sem entidade citada com slug -> null (ficha omitida).
 */
async function resolveEntityCard(
  prisma: PrismaClient,
  articleId: bigint,
): Promise<NewsEntityCardInput | null> {
  const links = await prisma.entityNewsLink.findMany({
    where: { articleId, entityType: { in: ["movie", "tv"] } },
    select: { entityType: true, entityId: true },
    orderBy: { id: "asc" },
    take: 4,
  });
  for (const link of links) {
    const type = link.entityType;
    if (type !== "movie" && type !== "tv") continue;
    const card = await loadEntityCardInput(prisma, type, link.entityId);
    if (card !== null) return card;
  }
  return null;
}

/**
 * Fatos persistidos de UMA entidade movie|tv|person, no formato da ficha.
 *
 * Extraido de `resolveEntityCard` para servir tambem aos blocos `entityCard` do
 * corpo. Ter duas consultas montando a "mesma" ficha e como duas superficies
 * discordarem sobre o titulo do mesmo filme.
 *
 * Sem slug canonico pt-BR -> `null`: uma ficha sem link e um card que nao leva a
 * lugar nenhum.
 */
async function loadEntityCardInput(
  prisma: PrismaClient,
  entityType: "movie" | "tv" | "person",
  entityId: bigint,
): Promise<NewsEntityCardInput | null> {
  const slugRow = await prisma.slug.findFirst({
    where: { entityType, entityId, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { slug: true },
  });
  if (slugRow === null) return null;

  if (entityType === "person") {
    // Pessoa nao tem traducao de titulo: o nome e o fato. A funcao vem de
    // `known_for_department` e e traduzida no presenter (mesmo mapa da pagina
    // de pessoa); a imagem e o profile_path, nao poster.
    const person = await prisma.person.findUnique({
      where: { id: entityId },
      select: { name: true, profilePath: true, knownForDepartment: true },
    });
    if (person === null) return null;
    return {
      entityType: "person",
      id: entityId.toString(),
      titleOriginal: person.name,
      translationTitle: null,
      summary: null,
      slug: slugRow.slug,
      posterPath: person.profilePath,
      year: null,
      seasonCount: null,
      knownForDepartment: person.knownForDepartment,
    };
  }

  const translationRow = await prisma.entityTranslation.findFirst({
    where: { entityType, entityId, languageCode: LANGUAGE_CODE },
    select: { title: true, summary: true },
  });

  if (entityType === "movie") {
    const movie = await prisma.movie.findUnique({
      where: { id: entityId },
      select: { titleOriginal: true, releaseDate: true, posterPath: true },
    });
    if (movie === null) return null;
    return {
      entityType: "movie",
      id: entityId.toString(),
      titleOriginal: movie.titleOriginal,
      translationTitle: translationRow?.title ?? null,
      summary: translationRow?.summary ?? null,
      slug: slugRow.slug,
      posterPath: movie.posterPath,
      year: movie.releaseDate === null ? null : movie.releaseDate.getUTCFullYear(),
      seasonCount: null,
    };
  }

  const show = await prisma.tvShow.findUnique({
    where: { id: entityId },
    select: { nameOriginal: true, firstAirDate: true, posterPath: true },
  });
  if (show === null) return null;
  const seasonCount = await prisma.season.count({
    where: { tvShowId: entityId, seasonNumber: { gt: 0 } },
  });
  return {
    entityType: "tv",
    id: entityId.toString(),
    titleOriginal: show.nameOriginal,
    translationTitle: translationRow?.title ?? null,
    summary: translationRow?.summary ?? null,
    slug: slugRow.slug,
    posterPath: show.posterPath,
    year: show.firstAirDate === null ? null : show.firstAirDate.getUTCFullYear(),
    seasonCount: seasonCount > 0 ? seasonCount : null,
  };
}

/**
 * Resolve as referencias dos blocos do corpo contra o banco publico.
 *
 * Duas familias de referencia, cada uma com o mesmo gate das superficies
 * existentes:
 *  - `entityCard` -> catalogo (titulo pt-BR + slug canonico reais);
 *  - `relatedContent` -> artigo PUBLICAVEL (o mesmo `isPublishableArticle` das
 *    outras telas, incluindo o embargo de materia agendada).
 *
 * O que nao resolve simplesmente nao chega ao presenter, que descarta o bloco.
 */
async function resolveBodyHydration(
  prisma: PrismaClient,
  rawBlocks: unknown,
): Promise<ArticleBodyHydration> {
  const refs = collectArticleBodyReferences(rawBlocks);
  const entityCards = new Map<string, NewsEntityCardInput>();
  const relatedArticles = new Map<string, { title: string; slug: string }>();
  if (refs.entities.length === 0 && refs.articleRefs.length === 0) {
    return { entityCards, relatedArticles };
  }

  await Promise.all([
    ...refs.entities.map(async (ref) => {
      // movie|tv|person viram ficha com link (os tres tem rota publica
      // canonica). `person` era descartado aqui em silencio — o emissor
      // (entity-resolve) estava certo e o cartao nunca nascia. Os demais tipos
      // do contrato (season/episode/franchise...) continuam sem ficha porque
      // nao tem rota propria; o presenter preserva a nota editorial deles.
      if (ref.entityKind !== "movie" && ref.entityKind !== "tv" && ref.entityKind !== "person") {
        return;
      }
      if (!/^[0-9]+$/.test(ref.entityId)) return;
      const card = await loadEntityCardInput(prisma, ref.entityKind, BigInt(ref.entityId));
      if (card !== null) entityCards.set(`${ref.entityKind}:${ref.entityId}`, card);
    }),
    (async () => {
      if (refs.articleRefs.length === 0) return;
      const rows = await prisma.article.findMany({
        where: { payloadDocumentId: { in: refs.articleRefs } },
        select: {
          payloadDocumentId: true,
          publishedAt: true,
          licenseStatus: true,
          displayAllowed: true,
          translations: {
            where: {
              languageCode: LANGUAGE_CODE,
              reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
            },
            select: { slug: true, title: true, reviewStatus: true, publishedAt: true },
            take: 1,
          },
        },
      });
      const nowIso = new Date().toISOString();
      for (const row of rows) {
        const translation = row.translations[0];
        if (translation === undefined || row.payloadDocumentId === null) continue;
        if (
          !isPublishableArticle(
            {
              reviewStatus: String(translation.reviewStatus),
              licenseStatus: String(row.licenseStatus),
              displayAllowed: row.displayAllowed,
              slug: translation.slug,
              title: translation.title,
              publishedAtIso: resolvePublishedIso(
                isoDate(translation.publishedAt),
                isoDate(row.publishedAt),
              ),
            },
            nowIso,
          )
        ) {
          continue;
        }
        relatedArticles.set(row.payloadDocumentId, {
          title: translation.title,
          slug: translation.slug,
        });
      }
    })(),
  ]);

  return { entityCards, relatedArticles };
}

/** "Leia tambem" (tela 05): ate 4 outros artigos publicaveis mais recentes. */
async function resolveReadAlso(
  prisma: PrismaClient,
  currentSlug: string,
): Promise<NewsCardView[]> {
  const rows = await prisma.articleTranslation.findMany({
    where: {
      languageCode: LANGUAGE_CODE,
      reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
      slug: { not: currentSlug },
      // Agendados (futuro) nao ocupam a janela do "Leia tambem": o filtro de
      // publicabilidade abaixo continua sendo o gate — isto so evita que
      // materias embargadas esvaziem a secao (m5 adversarial).
      publishedAt: { lte: new Date() },
    },
    orderBy: { publishedAt: "desc" },
    take: 8,
    select: {
      slug: true,
      title: true,
      deck: true,
      reviewStatus: true,
      publishedAt: true,
      article: {
        select: {
          authorName: true,
          category: true,
          heroImagePath: true,
          publishedAt: true,
          readTimeMinutes: true,
          licenseStatus: true,
          displayAllowed: true,
          requiresAttribution: true,
          requiresLinkback: true,
          sourceName: true,
          sourceUrl: true,
          heroMediaAsset: { select: HERO_MEDIA_SELECT },
        },
      },
    },
  });
  const nowIso = new Date().toISOString();
  const cards: NewsCardView[] = [];
  for (const row of rows) {
    if (cards.length >= 4) break;
    const card = buildNewsCard(
      {
        authorName: row.article.authorName,
        category: row.article.category,
        heroImagePath: row.article.heroImagePath,
        heroMedia: row.article.heroMediaAsset,
        articlePublishedAtIso: isoDate(row.article.publishedAt),
        readTimeMinutes: row.article.readTimeMinutes,
        licenseStatus: String(row.article.licenseStatus),
        displayAllowed: row.article.displayAllowed,
        requiresAttribution: row.article.requiresAttribution,
        requiresLinkback: row.article.requiresLinkback,
        sourceName: row.article.sourceName,
        sourceUrl: row.article.sourceUrl,
        slug: row.slug,
        title: row.title,
        deck: row.deck,
        reviewStatus: String(row.reviewStatus),
        translationPublishedAtIso: isoDate(row.publishedAt),
      },
      nowIso,
    );
    if (card !== null) cards.push(card);
  }
  return cards;
}
