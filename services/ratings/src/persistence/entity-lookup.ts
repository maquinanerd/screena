/**
 * entity-lookup.ts — Resolucao de entidade local por id externo (Prisma).
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * SO por identificador inequivoco (`imdb_id` unico ou `tmdb_id` unico). NUNCA
 * casa por titulo/ano: atribuir a nota de um filme a outro e pior do que nao
 * gravar nada.
 */

import type { PrismaClient } from '@screena/db/server'
import type { EntityLookupPort, ResolvedEntity } from '../ports.js'
import type { RatingsEntityType } from '../film-show-ratings/types.js'

/** Cria um `EntityLookupPort` que resolve em `movies` / `tv_shows` via Prisma. */
export function createPrismaEntityLookup(prisma: PrismaClient): EntityLookupPort {
  async function find(
    entityType: RatingsEntityType,
    where: { imdbId: string } | { tmdbId: number },
  ): Promise<ResolvedEntity | null> {
    const select = { id: true }
    const row =
      entityType === 'movie'
        ? await prisma.movie.findUnique({ where, select })
        : await prisma.tvShow.findUnique({ where, select })
    if (row === null) return null
    return { entityType, entityId: row.id.toString() }
  }

  return {
    findByImdbId(entityType, imdbId) {
      return find(entityType, { imdbId })
    },
    findByTmdbId(entityType, tmdbId) {
      return find(entityType, { tmdbId })
    },
  }
}
