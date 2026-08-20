/**
 * similar-titles.ts — Helper SERVER-ONLY do bloco "Mais como este".
 *
 * Invariantes 3 e 4: le SOMENTE PostgreSQL local via @screena/db (Prisma). Zero
 * TMDB, zero Gemini, zero rede. Read-only.
 *
 * O SINAL e a COLECAO do TMDB (`movie_collection_memberships` -> `collections`)
 * — parentesco DECLARADO pela fonte, nao inferido. O porque desta escolha (e
 * porque nao genero, e porque serie nao tem equivalente) esta no cabecalho de
 * `../lib/similar-titles-presenter.ts`. Aqui so ha consulta.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  buildSimilarTitles,
  SIMILAR_TITLES_LIMIT,
  type SimilarTitleRow,
  type SimilarTitlesView,
} from "../lib/similar-titles-presenter";

const LANGUAGE_CODE = "pt-BR";
/** Buscar mais linhas que o teto: parte cai por falta de slug canonico. */
const ROW_FETCH_LIMIT = SIMILAR_TITLES_LIMIT * 4;

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * Titulos da(s) MESMA(S) colecao(oes) deste filme.
 *
 * Devolve `null` quando o filme nao esta em colecao nenhuma, quando a colecao
 * so tem ele, ou quando nenhum parente tem slug canonico pt-BR. Quem chama
 * transforma `null` em ausencia REGISTRADA (`no_recommendation_dataset`), nunca
 * em secao vazia.
 */
export async function getSimilarMoviesForEntity(
  prisma: PrismaClient,
  entityId: bigint,
): Promise<SimilarTitlesView | null> {
  const memberships = await prisma.movieCollectionMembership.findMany({
    where: { movieId: entityId },
    select: { collectionId: true },
  });
  if (memberships.length === 0) return null;

  const collectionIds = memberships.map((row) => row.collectionId);

  const siblings = await prisma.movieCollectionMembership.findMany({
    where: { collectionId: { in: collectionIds }, movieId: { not: entityId } },
    select: {
      movieId: true,
      position: true,
      collection: { select: { name: true } },
    },
    orderBy: [{ position: "asc" }, { movieId: "asc" }],
    take: ROW_FETCH_LIMIT,
  });
  if (siblings.length === 0) return null;

  const movieIds = siblings.map((row) => row.movieId);

  const [movies, slugs, translations] = await Promise.all([
    prisma.movie.findMany({
      where: { id: { in: movieIds } },
      select: { id: true, titleOriginal: true, releaseDate: true, posterPath: true },
    }),
    prisma.slug.findMany({
      where: {
        entityType: "movie",
        entityId: { in: movieIds },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityId: true, slug: true },
    }),
    prisma.entityTranslation.findMany({
      where: {
        entityType: "movie",
        entityId: { in: movieIds },
        languageCode: LANGUAGE_CODE,
      },
      select: { entityId: true, title: true },
    }),
  ]);

  const movieById = new Map(movies.map((movie) => [movie.id.toString(), movie]));
  const slugByEntity = new Map(slugs.map((row) => [row.entityId.toString(), row.slug]));
  const titleByEntity = new Map(
    translations.map((row) => [row.entityId.toString(), row.title]),
  );

  const rows: SimilarTitleRow[] = [];
  for (const sibling of siblings) {
    const key = sibling.movieId.toString();
    const movie = movieById.get(key);
    if (movie === undefined) continue;
    rows.push({
      entityId: key,
      titleOriginal: movie.titleOriginal,
      translationTitle: titleByEntity.get(key) ?? null,
      slug: slugByEntity.get(key) ?? null,
      year: movie.releaseDate === null ? null : movie.releaseDate.getUTCFullYear(),
      posterPath: movie.posterPath,
      position: sibling.position,
    });
  }

  return buildSimilarTitles(rows, {
    excludeEntityId: entityId.toString(),
    // O nome vem da PRIMEIRA colecao com nome utilizavel. Um filme em duas
    // colecoes e raro e nao justifica dois trilhos; nomear uma e honesto,
    // nomear "varias" nao diria nada ao leitor.
    relationLabel: siblings.find((row) => row.collection.name.trim() !== "")?.collection.name ?? null,
  });
}
