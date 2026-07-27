/**
 * catalog-read-store.ts — adapter Prisma de `CatalogReadStore` (C8).
 *
 * SOMENTE LEITURA, e so o que a biblioteca pessoal consome: existencia de
 * entidade, episodios de uma serie, contagens, runtime para estatisticas e
 * candidatos de match para importacao.
 *
 * A garantia de que nada aqui escreve no catalogo NAO e uma promessa do
 * comentario: o `PrismaCatalogExecutor` contem apenas as cinco delegacoes de
 * leitura, e nenhuma tabela `user_*` — e nenhum metodo deste arquivo chama
 * `create`/`update`/`delete`.
 *
 * ESCALA (o ponto que decide a corretude deste arquivo): o catalogo real tem
 * series com mais de 21 mil episodios (`Tagesschau`). Por isso:
 *  - `listSeriesEpisodes` e SEMPRE paginado (limit/offset obrigatorios);
 *  - `countSeriesEpisodes` conta no banco, sem materializar linhas;
 *  - as somas de runtime usam `aggregate`, nao `findMany` + reduce.
 */

import type { CatalogReadStore } from "../ports.js";
import type {
  CatalogEpisodeRecord,
  CatalogMatchCandidate,
  EntityRefRecord,
  SeriesEpisodeQuery,
  TransactionScope,
} from "../types.js";
import type { WatchableEntityType } from "../../core/types.js";
import type { PrismaCatalogExecutor } from "./executor.js";

/**
 * Filtro de temporada.
 *
 * `includeSpecials=false` exclui `season_number = 0`, a convencao TMDB para
 * especiais. A politica e EXPLICITA em toda chamada — nao existe default
 * implicito espalhado, e por isso ela e testavel nos dois sentidos.
 */
function seasonWhere(includeSpecials: boolean, seasonNumber: number | null) {
  if (seasonNumber !== null) {
    return { seasonNumber };
  }
  return includeSpecials ? {} : { seasonNumber: { gt: 0 } };
}

export function createPrismaCatalogReadStore(
  executor: PrismaCatalogExecutor,
): CatalogReadStore {
  return {
    async entityExists(_scope: TransactionScope, input: EntityRefRecord): Promise<boolean> {
      // Sonda da FK polimorfica. Existe para que o chamador NUNCA deixe a
      // violacao de FK acontecer: uma violacao aborta a transacao interativa
      // inteira (regra C7B1.1), e capturar a excecao nao a ressuscita.
      const row = await executor.entity.findUnique({
        where: {
          entityType_entityId: { entityType: input.entityType, entityId: input.entityId },
        },
        select: { entityId: true },
      });
      return row !== null;
    },

    async listSeriesEpisodes(
      _scope: TransactionScope,
      query: SeriesEpisodeQuery,
    ): Promise<readonly CatalogEpisodeRecord[]> {
      // `episodes.tv_show_id` e indexado; a ordem canonica exige o
      // `season_number`, que vive em `seasons` (o episodio NAO o duplica, por
      // decisao de modelagem). O include traz so essa coluna.
      const rows = await executor.episode.findMany({
        where: {
          tvShowId: query.tvShowId,
          season: seasonWhere(query.includeSpecials, query.seasonNumber),
        },
        orderBy: [{ season: { seasonNumber: "asc" } }, { episodeNumber: "asc" }],
        skip: query.offset,
        take: query.limit,
        select: {
          id: true,
          seasonId: true,
          episodeNumber: true,
          airDate: true,
          runtimeMinutes: true,
          season: { select: { seasonNumber: true } },
        },
      });
      return rows.map((row) => ({
        episodeId: row.id,
        seasonId: row.seasonId,
        seasonNumber: row.season.seasonNumber,
        episodeNumber: row.episodeNumber,
        airDate: row.airDate,
        runtimeMinutes: row.runtimeMinutes,
      }));
    },

    async countSeriesEpisodes(
      _scope: TransactionScope,
      input: {
        readonly tvShowId: bigint;
        readonly includeSpecials: boolean;
        readonly seasonNumber: number | null;
      },
    ): Promise<number> {
      return executor.episode.count({
        where: {
          tvShowId: input.tvShowId,
          season: seasonWhere(input.includeSpecials, input.seasonNumber),
        },
      });
    },

    async findByExternalId(
      _scope: TransactionScope,
      input: {
        readonly entityType: WatchableEntityType;
        readonly tmdbId: number | null;
        readonly imdbId: string | null;
      },
    ): Promise<readonly CatalogMatchCandidate[]> {
      // `tmdb_id` e `imdb_id` sao UNIQUE nas duas tabelas: quando um deles
      // casa, o resultado e no maximo uma linha — e so por isso o match por id
      // externo pode ser classificado como `exact` pelo dominio.
      if (input.tmdbId === null && input.imdbId === null) {
        return [];
      }
      const or = [
        ...(input.tmdbId !== null ? [{ tmdbId: input.tmdbId }] : []),
        ...(input.imdbId !== null ? [{ imdbId: input.imdbId }] : []),
      ];

      if (input.entityType === "movie") {
        const rows = await executor.movie.findMany({
          where: { OR: or },
          take: 2,
          select: { id: true, titleOriginal: true, releaseDate: true, tmdbId: true, imdbId: true },
        });
        return rows.map((r) => ({
          entityType: "movie" as const,
          entityId: r.id,
          title: r.titleOriginal,
          year: r.releaseDate === null ? null : r.releaseDate.getUTCFullYear(),
          tmdbId: r.tmdbId,
          imdbId: r.imdbId,
        }));
      }

      const rows = await executor.tvShow.findMany({
        where: { OR: or },
        take: 2,
        select: { id: true, nameOriginal: true, firstAirDate: true, tmdbId: true, imdbId: true },
      });
      return rows.map((r) => ({
        entityType: "tv" as const,
        entityId: r.id,
        title: r.nameOriginal,
        year: r.firstAirDate === null ? null : r.firstAirDate.getUTCFullYear(),
        tmdbId: r.tmdbId,
        imdbId: r.imdbId,
      }));
    },

    async findByTitle(
      _scope: TransactionScope,
      input: {
        readonly entityType: WatchableEntityType;
        readonly title: string;
        readonly year: number | null;
        readonly limit: number;
      },
    ): Promise<readonly CatalogMatchCandidate[]> {
      // Devolve TODOS os candidatos (ate `limit`), nunca "o primeiro". Quem
      // decide se ha ambiguidade e o dominio de matching — um adapter que
      // escolhesse sozinho transformaria um empate real em acerto silencioso,
      // que e exatamente o que a missao proibe.
      //
      // `mode: "insensitive"` faz a comparacao case-insensitive no banco; o
      // dominio ja normalizou acentos/pontuacao antes de chegar aqui.
      const yearFilter = input.year;

      if (input.entityType === "movie") {
        const rows = await executor.movie.findMany({
          where: {
            titleOriginal: { equals: input.title, mode: "insensitive" },
            ...(yearFilter !== null
              ? {
                  releaseDate: {
                    gte: new Date(Date.UTC(yearFilter, 0, 1)),
                    lt: new Date(Date.UTC(yearFilter + 1, 0, 1)),
                  },
                }
              : {}),
          },
          take: input.limit,
          orderBy: { id: "asc" },
          select: { id: true, titleOriginal: true, releaseDate: true, tmdbId: true, imdbId: true },
        });
        return rows.map((r) => ({
          entityType: "movie" as const,
          entityId: r.id,
          title: r.titleOriginal,
          year: r.releaseDate === null ? null : r.releaseDate.getUTCFullYear(),
          tmdbId: r.tmdbId,
          imdbId: r.imdbId,
        }));
      }

      const rows = await executor.tvShow.findMany({
        where: {
          nameOriginal: { equals: input.title, mode: "insensitive" },
          ...(yearFilter !== null
            ? {
                firstAirDate: {
                  gte: new Date(Date.UTC(yearFilter, 0, 1)),
                  lt: new Date(Date.UTC(yearFilter + 1, 0, 1)),
                },
              }
            : {}),
        },
        take: input.limit,
        orderBy: { id: "asc" },
        select: { id: true, nameOriginal: true, firstAirDate: true, tmdbId: true, imdbId: true },
      });
      return rows.map((r) => ({
        entityType: "tv" as const,
        entityId: r.id,
        title: r.nameOriginal,
        year: r.firstAirDate === null ? null : r.firstAirDate.getUTCFullYear(),
        tmdbId: r.tmdbId,
        imdbId: r.imdbId,
      }));
    },

    async sumMovieRuntime(
      _scope: TransactionScope,
      movieIds: readonly bigint[],
    ): Promise<{
      readonly totalMinutes: number;
      readonly withRuntime: number;
      readonly withoutRuntime: number;
    }> {
      if (movieIds.length === 0) {
        return { totalMinutes: 0, withRuntime: 0, withoutRuntime: 0 };
      }
      // AGREGACAO no banco. `withoutRuntime` e devolvido de proposito: as
      // estatisticas informam "dados insuficientes" em vez de inventar duracao
      // para um titulo sem runtime.
      const [soma, comRuntime, total] = await Promise.all([
        executor.movie.aggregate({
          where: { id: { in: [...movieIds] }, runtimeMinutes: { not: null } },
          _sum: { runtimeMinutes: true },
        }),
        executor.movie.count({ where: { id: { in: [...movieIds] }, runtimeMinutes: { not: null } } }),
        executor.movie.count({ where: { id: { in: [...movieIds] } } }),
      ]);
      return {
        totalMinutes: soma._sum.runtimeMinutes ?? 0,
        withRuntime: comRuntime,
        withoutRuntime: total - comRuntime,
      };
    },

    async sumEpisodeRuntime(
      _scope: TransactionScope,
      episodeIds: readonly bigint[],
    ): Promise<{
      readonly totalMinutes: number;
      readonly withRuntime: number;
      readonly withoutRuntime: number;
    }> {
      if (episodeIds.length === 0) {
        return { totalMinutes: 0, withRuntime: 0, withoutRuntime: 0 };
      }
      const [soma, comRuntime, total] = await Promise.all([
        executor.episode.aggregate({
          where: { id: { in: [...episodeIds] }, runtimeMinutes: { not: null } },
          _sum: { runtimeMinutes: true },
        }),
        executor.episode.count({
          where: { id: { in: [...episodeIds] }, runtimeMinutes: { not: null } },
        }),
        executor.episode.count({ where: { id: { in: [...episodeIds] } } }),
      ]);
      return {
        totalMinutes: soma._sum.runtimeMinutes ?? 0,
        withRuntime: comRuntime,
        withoutRuntime: total - comRuntime,
      };
    },
  };
}
