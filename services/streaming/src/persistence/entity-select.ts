/**
 * entity-select.ts — Selecao das entidades a consultar (Prisma).
 * EXCLUIDO do typecheck.
 *
 * Seleciona SO `movies`/`tv_shows` com `tmdb_id` (sempre presente e unico).
 * Nunca seleciona pessoa, temporada ou episodio — fora do escopo desta fase.
 * Ordem determinista por `id` para tornar `--limit` reproduzivel.
 */

import type { PrismaClient } from '@screena/db/server'
import type { EntitySelectPort } from '../ports.js'
import type { SelectedEntity, StreamingEntityType } from '../streaming-availability/types.js'

interface EntityRow {
  readonly id: bigint
  readonly tmdbId: number
  readonly imdbId: string | null
}

function toSelected(entityType: StreamingEntityType, row: EntityRow): SelectedEntity {
  return {
    entityType,
    entityId: row.id.toString(),
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
  }
}

/** Cria um `EntitySelectPort` sobre `movies` / `tv_shows`. */
export function createPrismaEntitySelect(prisma: PrismaClient): EntitySelectPort {
  const select = { id: true, tmdbId: true, imdbId: true }

  return {
    async select(entityType: StreamingEntityType, limit: number) {
      const rows =
        entityType === 'movie'
          ? await prisma.movie.findMany({ select, orderBy: { id: 'asc' }, take: limit })
          : await prisma.tvShow.findMany({ select, orderBy: { id: 'asc' }, take: limit })
      return rows.map((row) => toSelected(entityType, row))
    },

    async findByTmdbId(entityType: StreamingEntityType, tmdbId: number) {
      const row =
        entityType === 'movie'
          ? await prisma.movie.findUnique({ where: { tmdbId }, select })
          : await prisma.tvShow.findUnique({ where: { tmdbId }, select })
      return row === null ? null : toSelected(entityType, row)
    },

    async findByImdbId(entityType: StreamingEntityType, imdbId: string) {
      const row =
        entityType === 'movie'
          ? await prisma.movie.findUnique({ where: { imdbId }, select })
          : await prisma.tvShow.findUnique({ where: { imdbId }, select })
      return row === null ? null : toSelected(entityType, row)
    },
  }
}
