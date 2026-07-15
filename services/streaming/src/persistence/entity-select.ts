/**
 * entity-select.ts — Selecao das entidades a consultar (Prisma).
 * incluido no typecheck (2026-07).
 *
 * A varredura (`select`) so traz `movies`/`tv_shows` com **IMDb id real**
 * (`imdb_id NOT NULL`): a chave da chamada `/shows/{imdbId}` e o IMDb id, entao
 * entidades sem ele nunca viram consulta e `--limit` rende so alvos uteis.
 * Nunca seleciona pessoa, temporada ou episodio — fora do escopo desta fase.
 * Ordem determinista por `id` para tornar `--limit` reproduzivel.
 *
 * Nos lookups explicitos (`--tmdb-id`) a entidade encontrada pode nao ter IMDb
 * id; o worker a conta em `entitiesWithoutImdb` e nao inventa a chave.
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
      // So alvos consultaveis: IMDb id real (a chave de `/shows/{imdbId}`).
      const where = { imdbId: { not: null } }
      const rows =
        entityType === 'movie'
          ? await prisma.movie.findMany({ where, select, orderBy: { id: 'asc' }, take: limit })
          : await prisma.tvShow.findMany({ where, select, orderBy: { id: 'asc' }, take: limit })
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
