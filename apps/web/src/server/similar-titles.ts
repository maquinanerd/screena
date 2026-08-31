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
  RECOMMENDATION_RELATION_LABEL,
  selectRecommendationLinksForVertical,
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
      // Colecao do TMDB e conceito de FILME (`movie_collection_memberships`);
      // nao existe equivalente para serie. Este getter so produz filme.
      entityType: "movie",
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

/**
 * Titulos RECOMENDADOS pelo TMDB para esta entidade.
 *
 * O sinal que faltava. `recommendations` e `similar` estao no append de filme e
 * de serie desde sempre — chegavam em toda requisicao de detalhe, ja pagos em
 * cota, e eram descartados no normalizador. Foi por isso que "Mais como este"
 * nasceu apoiado so em COLECAO, e que a serie ficou sem trilho nenhum: a
 * refutacao daquela decisao ("o TMDB recommendations passar a ser persistido")
 * estava escrita na propria PR.
 *
 * RESOLVE POR TMDB_ID e ignora quem nao esta no catalogo. `title_recommendations`
 * guarda o universo do TMDB, nao o nosso: a maioria dos alvos nunca foi
 * ingerida, e isso e esperado. O que sobra depois do filtro e o trilho.
 *
 * Devolve `null` quando nao ha nenhum alvo ingerido com slug canonico — e quem
 * chama transforma `null` em ausencia REGISTRADA, nunca em secao vazia.
 */
export async function getRecommendedTitlesForEntity(
  prisma: PrismaClient,
  mediaType: "movie" | "tv",
  sourceTmdbId: number,
  excludeEntityId: bigint,
): Promise<SimilarTitlesView | null> {
  const links = await prisma.titleRecommendation.findMany({
    where: { sourceMediaType: mediaType, sourceTmdbId },
    select: { kind: true, targetMediaType: true, targetTmdbId: true, position: true },
    // `recommendation` antes de `similar`: o primeiro e comportamental (quem viu
    // isto viu aquilo) e o segundo e por metadado. A ordem alfabetica do `kind`
    // entrega isso por acidente feliz — declarada aqui para nao depender do acaso.
    orderBy: [{ kind: "asc" }, { position: "asc" }],
    take: ROW_FETCH_LIMIT,
  });
  if (links.length === 0) return null;

  // A regra da vertical vive no modulo PURO e nao aqui: enquanto era um
  // `.filter` dentro do getter, nao havia como prova-la sem banco — e o
  // controle negativo (deixar serie entrar no trilho de filme) passava calado.
  const alvos = selectRecommendationLinksForVertical(links, mediaType);
  if (alvos.length === 0) return null;
  const tmdbIds = alvos.map((row) => row.targetTmdbId);

  const titulos =
    mediaType === "movie"
      ? await prisma.movie.findMany({
          where: { tmdbId: { in: tmdbIds } },
          select: { id: true, tmdbId: true, titleOriginal: true, releaseDate: true, posterPath: true },
        })
      : (
          await prisma.tvShow.findMany({
            where: { tmdbId: { in: tmdbIds } },
            select: { id: true, tmdbId: true, nameOriginal: true, firstAirDate: true, posterPath: true },
          })
        ).map((row) => ({
          id: row.id,
          tmdbId: row.tmdbId,
          titleOriginal: row.nameOriginal,
          releaseDate: row.firstAirDate,
          posterPath: row.posterPath,
        }));
  if (titulos.length === 0) return null;

  const entityIds = titulos.map((row) => row.id);
  const [slugs, translations] = await Promise.all([
    prisma.slug.findMany({
      where: {
        entityType: mediaType,
        entityId: { in: entityIds },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityId: true, slug: true },
    }),
    prisma.entityTranslation.findMany({
      where: { entityType: mediaType, entityId: { in: entityIds }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
  ]);

  const porTmdbId = new Map(titulos.map((row) => [row.tmdbId, row]));
  const slugPorEntidade = new Map(slugs.map((row) => [row.entityId.toString(), row.slug]));
  const tituloPorEntidade = new Map(translations.map((row) => [row.entityId.toString(), row.title]));

  const rows: SimilarTitleRow[] = [];
  // Itera pelos LINKS, nao pelos titulos: a ordem do TMDB e o proprio sinal de
  // forca, e ordenar por id destruiria a unica informacao que o bloco carrega.
  for (const [indice, link] of alvos.entries()) {
    const titulo = porTmdbId.get(link.targetTmdbId);
    if (titulo === undefined) continue;
    const key = titulo.id.toString();
    rows.push({
      entityId: key,
      // `selectRecommendationLinksForVertical` ja garantiu que todo link
      // sobrevivente tem `targetMediaType === mediaType`, e os titulos foram
      // buscados na tabela dessa vertical. O tipo do card e o `mediaType` — e
      // era exatamente ele que nao chegava ao card antes de 2026-08-28.
      entityType: mediaType,
      titleOriginal: titulo.titleOriginal,
      translationTitle: tituloPorEntidade.get(key) ?? null,
      slug: slugPorEntidade.get(key) ?? null,
      year: titulo.releaseDate === null ? null : titulo.releaseDate.getUTCFullYear(),
      posterPath: titulo.posterPath,
      position: indice,
    });
  }

  return buildSimilarTitles(rows, {
    excludeEntityId: excludeEntityId.toString(),
    relation: "recommendation",
    relationLabel: RECOMMENDATION_RELATION_LABEL,
  });
}
