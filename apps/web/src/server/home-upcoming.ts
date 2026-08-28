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
// Continua sendo a rede de seguranca do teto de 32.767 bind variables: a lista
// de `tmdb_id` agora e curta, mas o guarda-corpo nao sai por isso.
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
 * ============================================================================
 * ESTE TRILHO LIA O CATALOGO INTEIRO PARA MOSTRAR 6 CARDS (corrigido 2026-08-28)
 * ============================================================================
 * Antes, cada requisicao fazia `slugs.findMany` SEM limite (todos os slugs
 * canonicos da vertical), depois `entity_translations` em lotes para TODOS
 * esses ids, e so entao filtrava por estreia futura. O `where` da estreia ja
 * estava certo; o que era ilimitado eram os DOIS acompanhantes.
 *
 * Agora e UMA consulta com `JOIN` e `LIMIT`: o slug e o titulo vem na mesma
 * linha do filme/serie, o filtro de estreia futura acontece no banco, a ordem
 * (estreia asc) tambem, e so as linhas que podem virar card cruzam o driver.
 *
 * A FOLGA (`UPCOMING_FETCH_MULTIPLIER`) existe porque `buildUpcomingItems`
 * ainda descarta item cujo `href` nao se forma. Sem folga, uma linha descartada
 * encolheria o trilho em silencio.
 */
const UPCOMING_FETCH_MULTIPLIER = 4;

interface UpcomingRow {
  id: bigint;
  tmdb_id: number;
  title_original: string;
  release_date: Date;
  backdrop_path: string | null;
  poster_path: string | null;
  slug: string;
  translation_title: string | null;
}

/**
 * `$1` = language_code, `$2` = cutoff (inicio do dia UTC), `$3` = limite.
 * Nenhum literal interpolado; `%s` so troca as colunas da vertical.
 */
function upcomingSql(
  entityType: "movie" | "tv",
  table: string,
  titleColumn: string,
  dateColumn: string,
): string {
  return `
    SELECT e.id,
           e.tmdb_id,
           e.${titleColumn} AS title_original,
           e.${dateColumn} AS release_date,
           e.backdrop_path,
           e.poster_path,
           s.slug,
           t.title AS translation_title
    FROM slugs s
    JOIN ${table} e ON e.id = s.entity_id
    LEFT JOIN entity_translations t
      ON t.entity_type = '${entityType}'::"EntityType"
     AND t.entity_id = e.id
     AND t.language_code = $1
    WHERE s.entity_type = '${entityType}'::"EntityType"
      AND s.language_code = $1
      AND s.is_canonical
      AND e.${dateColumn} > $2
      AND COALESCE(NULLIF(btrim(t.title), ''), NULLIF(btrim(e.${titleColumn}), '')) IS NOT NULL
    ORDER BY e.${dateColumn} ASC, e.id ASC
    LIMIT $3
  `;
}

const UPCOMING_MOVIE_SQL = upcomingSql("movie", "movies", "title_original", "release_date");
const UPCOMING_SERIES_SQL = upcomingSql("tv", "tv_shows", "name_original", "first_air_date");

async function loadUpcomingRows(
  sql: string,
  cutoff: Date,
  limit: number,
): Promise<UpcomingRow[]> {
  const prisma = getPrismaClient();
  return prisma.$queryRawUnsafe<UpcomingRow[]>(sql, LANGUAGE_CODE, cutoff, limit);
}

/**
 * Filmes "Em breve" (estreia futura) em ordem de estreia asc, com slug canônico
 * pt-BR. Retorna `[]` quando não há nenhum — e aí a superfície oculta a seção
 * (com log, via `SectionBoundary`).
 */
export const getHomeUpcomingMovies = cache(
  async (options?: { limit?: number }): Promise<HomeUpcomingItem[]> => {
    const now = new Date();
    const limit = options?.limit ?? HOME_UPCOMING_LIMIT;
    const rows = await loadUpcomingRows(
      UPCOMING_MOVIE_SQL,
      startOfUtcDay(now),
      limit * UPCOMING_FETCH_MULTIPLIER,
    );
    if (rows.length === 0) return [];

    const trailers = await loadDisplayableTrailers(
      "movie",
      rows.map((row) => row.tmdb_id),
    );

    const inputs: UpcomingEntityInput[] = rows.map((row) => ({
      id: row.id.toString(),
      vertical: "movie",
      titleOriginal: row.title_original,
      translationTitle: row.translation_title,
      slug: row.slug,
      releaseDate: row.release_date,
      backdropPath: row.backdrop_path,
      posterPath: row.poster_path,
      trailer: trailers.get(row.tmdb_id) ?? null,
    }));

    return buildUpcomingItems(inputs, now, limit);
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
    const now = new Date();
    const limit = options?.limit ?? HOME_UPCOMING_LIMIT;
    const rows = await loadUpcomingRows(
      UPCOMING_SERIES_SQL,
      startOfUtcDay(now),
      limit * UPCOMING_FETCH_MULTIPLIER,
    );
    if (rows.length === 0) return [];

    const trailers = await loadDisplayableTrailers(
      "tv",
      rows.map((row) => row.tmdb_id),
    );

    const inputs: UpcomingEntityInput[] = rows.map((row) => ({
      id: row.id.toString(),
      vertical: "series",
      titleOriginal: row.title_original,
      translationTitle: row.translation_title,
      slug: row.slug,
      releaseDate: row.release_date,
      backdropPath: row.backdrop_path,
      posterPath: row.poster_path,
      trailer: trailers.get(row.tmdb_id) ?? null,
    }));

    return buildUpcomingItems(inputs, now, limit);
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
