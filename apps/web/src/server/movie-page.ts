/**
 * movie-page.ts — Camada de dados SERVER-ONLY da pagina de filme.
 *
 * INVARIANTES 3 e 4 (pureza de render):
 *  - Le SOMENTE o PostgreSQL local via @screena/db (Prisma). Nenhuma chamada a
 *    TMDB, RapidAPI, Rotten Tomatoes, Gemini ou qualquer host externo.
 *  - Nao gera IA: apenas LE content_blocks ja gerados, validados e revisados
 *    (human_reviewed/published). O Entity Writer roda offline, nunca aqui.
 *  - Read-only: nunca escreve no banco.
 *
 * Server-only por convencao estrutural: vive em apps/web/src/server, nunca
 * carrega a diretiva "use client" e nunca e importado por um client component
 * (travado por `pnpm audit:render` e por tests/governance/web-render-layering).
 * O pacote `server-only` ainda nao esta instalado neste estagio; por isso a
 * delimitacao e por diretorio + ausencia de "use client", nao por import.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  presentMovie,
  type MovieContentBlockInput,
  type MoviePageView,
} from "../lib/movie-presenter";
import {
  evaluateMovieIndexability,
  RENDERABLE_REVIEW_STATUSES,
  type IndexabilityResult,
} from "../lib/movie-indexability";
import { movieCanonicalUrl } from "../lib/site";
import { getRelatedNewsForEntity } from "./related-news";
import { getCastForEntity } from "./entity-cast";
import { getWatchForEntity } from "./entity-watch";
import type { NewsCardView } from "../lib/news-presenter";
import type { CastMemberView } from "../lib/cast-presenter";
import type { WatchView } from "../lib/watch-presenter";

/** Idioma de publicacao do MVP (invariante 7): pt-BR indexa primeiro. */
const LANGUAGE_CODE = "pt-BR";
/** Tipo de entidade desta rota (schema Movie, URL /pt/filmes/...). */
const ENTITY_TYPE = "movie";

/** Tudo que a pagina e o `generateMetadata` precisam, ja resolvido do banco. */
export interface MoviePageData {
  view: MoviePageView;
  indexability: IndexabilityResult;
  canonicalSlug: string;
  canonicalUrl: string;
  /** Noticias relacionadas publicaveis (EntityNewsLink); [] quando nao houver. */
  relatedNews: NewsCardView[];
  /** Elenco principal (cast_members/people); [] quando nao houver. */
  cast: CastMemberView[];
  /** Onde assistir (watch_availability licenciado no BR); vazio omite a secao. */
  watch: WatchView;
  /** IDs externos reais (imdb/tmdb/...) para montar `sameAs` no JSON-LD. */
  externalIds: { source: string; externalId: string }[];
}

/**
 * Le os dados da pagina de filme pelo slug pt-BR.
 *
 * Retorna `null` quando o slug nao existe ou nao ha filme correspondente — a
 * rota responde 404. Memoizado por request (`react` cache) para nao consultar o
 * banco duas vezes (generateMetadata + render do mesmo request).
 */
export const getMoviePageData = cache(
  async (slug: string): Promise<MoviePageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;

    const entityId = slugRow.entityId;

    const [movie, canonicalSlugRow, translation, contentBlocks, relatedNews, cast, watch, externalIds] =
      await Promise.all([
      prisma.movie.findUnique({
        where: { id: entityId },
        select: {
          titleOriginal: true,
          releaseDate: true,
          runtimeMinutes: true,
          posterPath: true,
          backdropPath: true,
        },
      }),
      prisma.slug.findFirst({
        where: {
          entityType: ENTITY_TYPE,
          entityId,
          languageCode: LANGUAGE_CODE,
          isCanonical: true,
        },
        select: { slug: true },
      }),
      prisma.entityTranslation.findFirst({
        where: { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
        select: {
          title: true,
          metaTitle: true,
          metaDescription: true,
          summary: true,
        },
      }),
      prisma.contentBlock.findMany({
        where: {
          entityType: ENTITY_TYPE,
          entityId,
          languageCode: LANGUAGE_CODE,
          // Defesa em profundidade: o filtro pelo `review_status` publicavel
          // tambem e reaplicado puramente em selectRenderableBlocks.
          reviewStatus: { in: [...RENDERABLE_REVIEW_STATUSES] },
        },
        select: { blockType: true, content: true, reviewStatus: true },
      }),
      getRelatedNewsForEntity(prisma, ENTITY_TYPE, entityId),
      getCastForEntity(prisma, ENTITY_TYPE, entityId),
      getWatchForEntity(prisma, ENTITY_TYPE, entityId),
      prisma.entityExternalId.findMany({
        where: { entityType: ENTITY_TYPE, entityId },
        select: { source: true, externalId: true },
      }),
    ]);

    if (movie === null) return null;

    const blocks: MovieContentBlockInput[] = contentBlocks.map((block) => ({
      blockType: String(block.blockType),
      content: block.content,
      reviewStatus: String(block.reviewStatus),
    }));

    const view = presentMovie({
      record: {
        titleOriginal: movie.titleOriginal,
        year:
          movie.releaseDate === null ? null : movie.releaseDate.getUTCFullYear(),
        runtimeMinutes: movie.runtimeMinutes,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
      },
      translation,
      blocks,
    });

    const indexability = evaluateMovieIndexability({
      renderableBlockCount: view.renderableBlockCount,
    });

    const canonicalSlug = canonicalSlugRow?.slug ?? slug;

    return {
      view,
      indexability,
      canonicalSlug,
      canonicalUrl: movieCanonicalUrl(canonicalSlug),
      relatedNews,
      cast,
      watch,
      externalIds,
    };
  },
);
