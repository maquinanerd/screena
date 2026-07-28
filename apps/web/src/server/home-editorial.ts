/**
 * home-editorial.ts — Camada SERVER-ONLY dos "Destaques de hoje" da home.
 *
 * A seção é EDITORIAL: lê `article_translations` + `articles` +
 * `entity_news_links`. Não toca em `movies`/`tv_shows` e não produz card de
 * catálogo — todo destino é `/pt/noticias/{slug}/`.
 *
 * Invariantes 3/4: lê SOMENTE PostgreSQL local. Zero API externa, zero Gemini.
 *
 * SEM N+1: DUAS queries, sempre — uma editorial (traduções pt-BR com o artigo
 * embutido) e uma em lote dos vínculos de entidade de todos os artigos lidos. A
 * classificação por vertical acontece no presenter puro.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildHomeEditorialHighlights,
  EMPTY_HOME_EDITORIAL_HIGHLIGHTS,
  HOME_EDITORIAL_LOADER_LIMIT,
  type HomeEditorialArticleInput,
  type HomeEditorialHighlights,
  type HomeEditorialLinkType,
} from "../lib/home-editorial-presenter";
import { NEWS_RENDERABLE_REVIEW_STATUSES } from "../lib/news-presenter";

const LANGUAGE_CODE = "pt-BR";

/**
 * Teto de traduções lidas por request. Cap EXPLÍCITO e consciente: a seção
 * mostra 3 cards e o loader guarda no máximo `HOME_EDITORIAL_LOADER_LIMIT` por
 * vertical, então 60 candidatas cobrem com folga qualquer distribuição real
 * entre filmes e séries. As matérias são lidas já ordenadas por data de
 * publicação decrescente (nulos por último), e o presenter reordena pela data
 * RESOLVIDA (tradução, com o artigo como fallback) — o corte nunca decide
 * sozinho qual matéria aparece.
 */
const EDITORIAL_FETCH_LIMIT = 60;

/** Tipos de vínculo que classificam a vertical (o resto é ignorado). */
const CLASSIFYING_LINK_TYPES = ["movie", "tv", "person"] as const;

export type { HomeEditorialHighlights } from "../lib/home-editorial-presenter";

/**
 * Destaques editoriais da home, por vertical. Todo gate de publicabilidade
 * (rascunho, matéria agendada, retratada, sem licença, sem crédito exigido)
 * roda no presenter, com o gate único de `@screena/seo`.
 */
export const getHomeEditorialHighlights = cache(
  async (): Promise<HomeEditorialHighlights> => {
    const prisma = getPrismaClient();

    const translations = await prisma.articleTranslation.findMany({
      where: {
        languageCode: LANGUAGE_CODE,
        reviewStatus: { in: [...NEWS_RENDERABLE_REVIEW_STATUSES] },
      },
      orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: EDITORIAL_FETCH_LIMIT,
      select: {
        articleId: true,
        slug: true,
        title: true,
        deck: true,
        reviewStatus: true,
        publishedAt: true,
        article: {
          select: {
            category: true,
            heroImagePath: true,
            publishedAt: true,
            licenseStatus: true,
            displayAllowed: true,
            requiresAttribution: true,
            requiresLinkback: true,
            sourceName: true,
            sourceUrl: true,
          },
        },
      },
    });
    if (translations.length === 0) return EMPTY_HOME_EDITORIAL_HIGHLIGHTS;

    const articleIds = translations.map((row) => row.articleId);

    // Vínculos de TODAS as matérias em UMA query (nunca uma por card).
    const links = await prisma.entityNewsLink.findMany({
      where: { articleId: { in: articleIds }, entityType: { in: [...CLASSIFYING_LINK_TYPES] } },
      select: { articleId: true, entityType: true },
    });

    const typesByArticle = new Map<string, Set<HomeEditorialLinkType>>();
    for (const link of links) {
      const key = link.articleId.toString();
      const bucket = typesByArticle.get(key) ?? new Set<HomeEditorialLinkType>();
      bucket.add(link.entityType as HomeEditorialLinkType);
      typesByArticle.set(key, bucket);
    }

    const inputs: HomeEditorialArticleInput[] = translations.map((row) => {
      const key = row.articleId.toString();
      return {
        articleId: key,
        slug: row.slug,
        title: row.title,
        deck: row.deck,
        reviewStatus: String(row.reviewStatus),
        translationPublishedAtIso: row.publishedAt?.toISOString() ?? null,
        articlePublishedAtIso: row.article.publishedAt?.toISOString() ?? null,
        category: row.article.category,
        heroImagePath: row.article.heroImagePath,
        licenseStatus: String(row.article.licenseStatus),
        displayAllowed: row.article.displayAllowed,
        requiresAttribution: row.article.requiresAttribution,
        requiresLinkback: row.article.requiresLinkback,
        sourceName: row.article.sourceName,
        sourceUrl: row.article.sourceUrl,
        linkedEntityTypes: [...(typesByArticle.get(key) ?? [])],
      };
    });

    return buildHomeEditorialHighlights(
      inputs,
      new Date().toISOString(),
      HOME_EDITORIAL_LOADER_LIMIT,
    );
  },
);
