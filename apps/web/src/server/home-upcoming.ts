/**
 * home-upcoming.ts — Camada de dados SERVER-ONLY da seção "Em breve":
 * filmes e séries com estreia FUTURA já ingeridos do TMDB (offline) no
 * PostgreSQL.
 *
 * TRÊS getters, um por superfície — o dataset é que muda, nunca a seção:
 *
 *   getHomeUpcomingMovies()  -> /pt/filmes/  (Movie.releaseDate  > hoje)
 *   getHomeUpcomingSeries()  -> /pt/series/  (TvShow.firstAirDate > hoje)
 *   getHomeUpcomingMixed()   -> /pt/         (os dois, cota equilibrada)
 *
 * Invariantes 3 e 4:
 *  - Lê somente PostgreSQL local via @screena/db (Prisma). Zero API externa,
 *    zero TMDB, zero Gemini no caminho de render.
 *  - Não escreve no banco; apenas monta um snapshot serializável.
 *
 * A descoberta/ingestão de upcoming acontece OFFLINE no worker
 * (services/ingestion/bin/ingest-public-catalog.ts --include-upcoming). Aqui só
 * lemos o resultado já persistido (data futura + slug pt-BR canônico).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  buildUpcomingItems,
  HOME_UPCOMING_LIMIT,
  mergeUpcomingVerticals,
  type HomeUpcomingItem,
  type UpcomingEntityInput,
} from "../lib/home-upcoming-presenter";
import { pickTrailer, type TrailerRow, type TrailerView } from "../lib/trailer-presenter";
import { findManyInChunks } from "../lib/prisma-in-chunks";

const LANGUAGE_CODE = "pt-BR";

/**
 * Trailers EXIBÍVEIS por `tmdb_id`, para uma vertical.
 *
 * O gate da invariante 6 é aplicado DUAS vezes de propósito: aqui, no `where`
 * (a linha bloqueada nem sai do banco) e de novo em `isDisplayableTrailerRow`
 * (que também checa site, tipo e formato do id). A redundância é barata e o
 * primeiro filtro é o que garante que dado sem licença não trafega para o
 * processo de render nem por engano.
 *
 * Hoje isto devolve um mapa VAZIO em produção, e está certo — mas a causa não é
 * mais a que este comentário dizia. A licença de vídeo do TMDB EXISTE desde
 * 13/08/2026; o que falta é a PROMOÇÃO das linhas (`display_allowed` nasce
 * `false` por linha). Ver `apps/web/src/lib/trailer-presenter.ts`.
 */
async function loadDisplayableTrailers(
  entityType: "movie" | "tv",
  tmdbIds: readonly number[],
): Promise<Map<number, TrailerView>> {
  const byTmdbId = new Map<number, TrailerView>();
  if (tmdbIds.length === 0) return byTmdbId;

  const prisma = getPrismaClient();
  const rows = await findManyInChunks([...tmdbIds], (chunk) =>
    prisma.tmdbVideo.findMany({
      where: {
        entityType,
        tmdbId: { in: chunk },
        // Invariante 6, na própria consulta.
        displayAllowed: true,
        licenseStatus: { notIn: ["unknown", "blocked"] },
      },
      select: {
        tmdbId: true,
        site: true,
        videoKey: true,
        name: true,
        videoType: true,
        official: true,
        languageCode: true,
        publishedAt: true,
        displayAllowed: true,
        licenseStatus: true,
      },
    }),
  );

  const grouped = new Map<number, TrailerRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.tmdbId);
    const candidate: TrailerRow = {
      site: row.site,
      videoKey: row.videoKey,
      name: row.name,
      videoType: row.videoType,
      official: row.official,
      languageCode: row.languageCode,
      publishedAt: row.publishedAt,
      displayAllowed: row.displayAllowed,
      licenseStatus: row.licenseStatus,
    };
    if (bucket === undefined) grouped.set(row.tmdbId, [candidate]);
    else bucket.push(candidate);
  }

  for (const [tmdbId, candidates] of grouped) {
    const trailer = pickTrailer(candidates);
    if (trailer !== null) byTmdbId.set(tmdbId, trailer);
  }
  return byTmdbId;
}

/** Início do dia UTC de `now` (cutoff de "estreia futura" para o filtro no banco). */
function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Slugs canônicos pt-BR de uma vertical, indexados por id de entidade.
 *
 * Sem slug canônico o item não vira card (o presenter descarta) — por isso a
 * consulta parte dos slugs e não da tabela de entidade: um filme sem slug nunca
 * chega a ser carregado.
 */
async function loadCanonicalSlugs(
  entityType: "movie" | "tv",
): Promise<{ ids: bigint[]; slugByEntity: Map<string, string> }> {
  const prisma = getPrismaClient();
  const rows = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
    select: { entityId: true, slug: true },
  });

  const slugByEntity = new Map<string, string>();
  const ids: bigint[] = [];
  for (const row of rows) {
    slugByEntity.set(row.entityId.toString(), row.slug);
    ids.push(row.entityId);
  }
  return { ids, slugByEntity };
}

/** Títulos pt-BR de uma vertical, indexados por id de entidade. */
async function loadTranslationTitles(
  entityType: "movie" | "tv",
  ids: readonly bigint[],
): Promise<Map<string, string | null>> {
  const prisma = getPrismaClient();
  // `ids` e o catalogo INTEIRO da vertical — acima de ~32.7 mil ids a consulta
  // nao cabe no protocolo do PostgreSQL. Ver `../lib/prisma-in-chunks`.
  const rows = await findManyInChunks([...ids], (chunk) =>
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: chunk }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
  );

  const titleByEntity = new Map<string, string | null>();
  for (const row of rows) titleByEntity.set(row.entityId.toString(), row.title);
  return titleByEntity;
}

/**
 * Filmes "Em breve" (estreia futura) em ordem de estreia asc, com slug canônico
 * pt-BR. Retorna `[]` quando não há nenhum — e aí a superfície oculta a seção
 * (com log, via `SectionBoundary`).
 */
export const getHomeUpcomingMovies = cache(
  async (options?: { limit?: number }): Promise<HomeUpcomingItem[]> => {
    const prisma = getPrismaClient();
    const now = new Date();
    const cutoff = startOfUtcDay(now);

    const { ids, slugByEntity } = await loadCanonicalSlugs("movie");
    if (ids.length === 0) return [];

    // Em lotes: a ordem final NAO vem daqui — `buildUpcomingItems` reordena por
    // estreia e so entao corta. Ver `../lib/prisma-in-chunks`.
    const [movies, titleByEntity] = await Promise.all([
      findManyInChunks(ids, (chunk) =>
        prisma.movie.findMany({
          where: { id: { in: chunk }, releaseDate: { gt: cutoff } },
          select: {
            id: true,
            tmdbId: true,
            titleOriginal: true,
            releaseDate: true,
            backdropPath: true,
            posterPath: true,
          },
          orderBy: { releaseDate: "asc" },
        }),
      ),
      loadTranslationTitles("movie", ids),
    ]);

    const trailers = await loadDisplayableTrailers(
      "movie",
      movies.map((movie) => movie.tmdbId),
    );

    const inputs: UpcomingEntityInput[] = movies.map((movie) => {
      const key = movie.id.toString();
      return {
        id: key,
        vertical: "movie",
        titleOriginal: movie.titleOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        releaseDate: movie.releaseDate,
        backdropPath: movie.backdropPath,
        posterPath: movie.posterPath,
        trailer: trailers.get(movie.tmdbId) ?? null,
      };
    });

    return buildUpcomingItems(inputs, now, options?.limit ?? HOME_UPCOMING_LIMIT);
  },
);

/**
 * Séries "Em breve": a estreia de uma série é `TvShow.firstAirDate` — a data em
 * que ela vai ao ar pela primeira vez. NÃO usamos `Season.airDate` nem
 * `Episode.airDate` aqui: temporada e episódio futuros de uma série JÁ no ar são
 * outra coisa (a agenda), e já têm superfície própria em `/pt/em-breve/`
 * (`getAnticipatedData`). Misturar os quatro tipos neste trilho transformaria
 * "Em breve" em "próximos episódios", que é outro produto.
 */
export const getHomeUpcomingSeries = cache(
  async (options?: { limit?: number }): Promise<HomeUpcomingItem[]> => {
    const prisma = getPrismaClient();
    const now = new Date();
    const cutoff = startOfUtcDay(now);

    const { ids, slugByEntity } = await loadCanonicalSlugs("tv");
    if (ids.length === 0) return [];

    // Em lotes; a ordem final e do presenter, nao do `orderBy`. Ver acima.
    const [shows, titleByEntity] = await Promise.all([
      findManyInChunks(ids, (chunk) =>
        prisma.tvShow.findMany({
          where: { id: { in: chunk }, firstAirDate: { gt: cutoff } },
          select: {
            id: true,
            tmdbId: true,
            nameOriginal: true,
            firstAirDate: true,
            backdropPath: true,
            posterPath: true,
          },
          orderBy: { firstAirDate: "asc" },
        }),
      ),
      loadTranslationTitles("tv", ids),
    ]);

    const trailers = await loadDisplayableTrailers(
      "tv",
      shows.map((show) => show.tmdbId),
    );

    const inputs: UpcomingEntityInput[] = shows.map((show) => {
      const key = show.id.toString();
      return {
        id: key,
        vertical: "series",
        titleOriginal: show.nameOriginal,
        translationTitle: titleByEntity.get(key) ?? null,
        slug: slugByEntity.get(key) ?? null,
        releaseDate: show.firstAirDate,
        backdropPath: show.backdropPath,
        posterPath: show.posterPath,
        trailer: trailers.get(show.tmdbId) ?? null,
      };
    });

    return buildUpcomingItems(inputs, now, options?.limit ?? HOME_UPCOMING_LIMIT);
  },
);

/**
 * O trilho da HOME: filmes E séries no mesmo "Em breve".
 *
 * Busca as duas verticais com o cap CHEIO cada uma (não metade) porque a cota é
 * decidida depois, no presenter: se uma vertical vier vazia, a outra herda as
 * vagas — e para herdar precisa ter candidatos suficientes carregados.
 */
export const getHomeUpcomingMixed = cache(
  async (options?: { limit?: number }): Promise<HomeUpcomingItem[]> => {
    const limit = options?.limit ?? HOME_UPCOMING_LIMIT;
    const [movies, series] = await Promise.all([
      getHomeUpcomingMovies({ limit }),
      getHomeUpcomingSeries({ limit }),
    ]);
    return mergeUpcomingVerticals(movies, series, limit);
  },
);
