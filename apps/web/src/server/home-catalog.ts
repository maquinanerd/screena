/**
 * Snapshot de catálogo para a faixa “Filmes em alta” da home canônica.
 *
 * Somente PostgreSQL local: a consulta não chama TMDB nem qualquer serviço no
 * render. O presenter puro preserva a ordem e nunca repete cards.
 *
 * ============================================================================
 * A FAIXA SE CHAMA "EM ALTA", E ATÉ 2026-08-21 ELA NÃO ERA
 * ============================================================================
 * A ordenação era `popularity desc` — um número **acumulado**, sem janela
 * nenhuma. O comentário anterior deste arquivo dizia que registros sem
 * `popularity` eram omitidos "para que a UI nunca rotule uma ordenação
 * arbitrária como 'em alta'", e o cuidado era real: só que `popularity` também
 * não é "em alta". Um título que estreou ontem e explodiu tem popularity
 * acumulada baixa e nunca aparecia; um título morno de dez anos atrás aparecia
 * todo dia.
 *
 * Agora a faixa lê o `trending/day` capturado pela fila `trending` do agendador
 * (`services/sync/src/scheduler/rhythms.ts`, 6 h). `buildTrendingMovieCards`
 * passou a fazer o que o nome dele diz.
 *
 * SEM FALLBACK para popularidade quando o trending vem vazio — ver
 * `trending-snapshot.ts`. Vazio => faixa ausente com o motivo nomeado.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { resolveEditorialScoreSources } from "./editorial-score";
import {
  getTrendingSnapshot,
  orderByTrending,
  trendingAbsenceFor,
  type TrendingAbsenceReason,
} from "./trending-snapshot";

import {
  buildTrendingMovieCards,
  HOME_TRENDING_CARD_LIMIT,
} from "../lib/home-catalog-presenter";
import type {
  EntityCard,
  MovieListItemInput,
} from "../lib/entity-index-presenter";

const LANGUAGE_CODE = "pt-BR";

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

function decimalToNumber(
  value: { toString(): string } | number | null,
): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

async function canonicalIdentity(
  entityType: "movie",
): Promise<{
  ids: bigint[];
  slugById: Map<string, string>;
  titleById: Map<string, string | null>;
}> {
  const prisma = getPrismaClient();
  const slugs = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });
  const ids = slugs.map((row) => row.entityId);
  const slugById = new Map(
    slugs.map((row) => [row.entityId.toString(), row.slug] as const),
  );
  if (ids.length === 0) return { ids, slugById, titleById: new Map() };

  const translations = await prisma.entityTranslation.findMany({
    where: { entityType, entityId: { in: ids }, languageCode: LANGUAGE_CODE },
    select: { entityId: true, title: true },
  });
  const titleById = new Map(
    translations.map((row) => [row.entityId.toString(), row.title] as const),
  );
  return { ids, slugById, titleById };
}

export interface HomeCatalogData {
  movies: EntityCard[];
  /**
   * `null` quando a faixa veio cheia; senão o motivo, para o log da superfície.
   *
   * A faixa sumir calada seria o defeito que esta mudança combate com outra
   * roupa: antes ela mentia, agora ela poderia desaparecer sem dizer por quê.
   */
  trendingAbsence: TrendingAbsenceReason | null;
}

export const getHomeCatalogData = cache(async (): Promise<HomeCatalogData> => {
  const prisma = getPrismaClient();
  const movieIdentity = await canonicalIdentity("movie");
  const snapshot = await getTrendingSnapshot("movie", "day");

  // A interseção é feita EM MEMÓRIA e não no `orderBy` do banco: a ordem é a do
  // trending, e SQL não sabe ordenar por uma lista de ids sem um `CASE` gerado.
  // O conjunto é pequeno por construção (o snapshot é um topo de 20).
  const trendingIds = snapshot.entityIds.filter((id) =>
    movieIdentity.ids.some((candidate) => candidate === id),
  );
  const rows =
    trendingIds.length === 0
      ? []
      : await prisma.movie.findMany({
          where: { id: { in: trendingIds } },
          select: {
            id: true,
            titleOriginal: true,
            releaseDate: true,
            posterPath: true,
            screenScore: true,
            screenScoreScale: true,
            screenScoreDisplay: true,
          },
        });
  const movies = orderByTrending(rows, (row) => row.id, snapshot.entityIds).slice(
    0,
    HOME_TRENDING_CARD_LIMIT,
  );

  // Procedencia do Cinerie Score em LOTE (ver `editorial-score`): sem calculo
  // `calculated` coerente, a nota fica sem origem editorial e o card a oculta.
  const scoreSources = await resolveEditorialScoreSources(
    prisma,
    "movie",
    movies.map((movie) => ({
      entityId: movie.id,
      screenScore: decimalToNumber(movie.screenScore),
      screenScoreScale: movie.screenScoreScale,
    })),
  );

  const movieInputs: MovieListItemInput[] = movies.map((movie) => {
    const key = movie.id.toString();
    return {
      id: key,
      titleOriginal: movie.titleOriginal,
      translationTitle: movieIdentity.titleById.get(key) ?? null,
      slug: movieIdentity.slugById.get(key) ?? null,
      year: yearFromDate(movie.releaseDate),
      posterPath: movie.posterPath,
      screenScore: decimalToNumber(movie.screenScore),
      screenScoreScale: movie.screenScoreScale,
      screenScoreDisplay: movie.screenScoreDisplay,
      screenScoreSource: scoreSources.get(key) ?? null,
    };
  });
  const cards = buildTrendingMovieCards(movieInputs);
  return {
    movies: cards,
    trendingAbsence: trendingAbsenceFor(snapshot, cards.length),
  };
});
