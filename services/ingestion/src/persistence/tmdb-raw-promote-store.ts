/**
 * tmdb-raw-promote-store.ts — Adapter de LEITURA de `tmdb_raw` para promocao
 * (Prisma). EXCLUIDO do typecheck.
 *
 * Implementa a porta pura `RawMovieSource` (do core `raw-promote`): conta e lista
 * os filmes ja gravados em `tmdb_raw`. SO leitura — a promocao nunca escreve em
 * `tmdb_raw` (escreve nas tabelas tipadas via o `EntityStorePort`). Ordena por
 * `tmdbId` (estavel/deterministico) para paginacao previsivel do piloto.
 */

import type { PrismaClient } from '@screena/db/server'
import type { RawEntityRow, RawMovieRow, RawMovieSource, RawTvSource } from '../raw-promote/types.js'

/** Le ate `limit` linhas de `tmdb_raw` de um tipo, na ordem estavel por tmdbId. */
async function listRawRows(
  prisma: PrismaClient,
  entityType: 'movie' | 'tv',
  limit: number,
): Promise<readonly RawEntityRow[]> {
  const take = Math.max(0, Math.floor(limit))
  if (take === 0) return []
  const rows = await prisma.tmdbRaw.findMany({
    where: { entityType },
    orderBy: { tmdbId: 'asc' },
    take,
    select: { tmdbId: true, baseLanguage: true, payload: true, fetchedAt: true },
  })
  return rows.map((row) => ({
    tmdbId: row.tmdbId,
    baseLanguage: row.baseLanguage,
    payload: row.payload,
    fetchedAt: row.fetchedAt,
  }))
}

/** Cria um `RawMovieSource` apoiado em `tmdb_raw` (entityType=movie) via Prisma. */
export function createPrismaRawMovieSource(prisma: PrismaClient): RawMovieSource {
  return {
    async countMovies(): Promise<number> {
      return prisma.tmdbRaw.count({ where: { entityType: 'movie' } })
    },
    listMoviePayloads(limit: number): Promise<readonly RawMovieRow[]> {
      return listRawRows(prisma, 'movie', limit)
    },
  }
}

/** Cria um `RawTvSource` apoiado em `tmdb_raw` (entityType=tv) via Prisma. */
export function createPrismaRawTvSource(prisma: PrismaClient): RawTvSource {
  return {
    async countTvShows(): Promise<number> {
      return prisma.tmdbRaw.count({ where: { entityType: 'tv' } })
    },
    listTvShowPayloads(limit: number): Promise<readonly RawEntityRow[]> {
      return listRawRows(prisma, 'tv', limit)
    },
  }
}
