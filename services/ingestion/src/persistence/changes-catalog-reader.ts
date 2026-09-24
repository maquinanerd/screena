/**
 * changes-catalog-reader.ts — Adapter Prisma da porta de CATALOGO do `/changes`.
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois).
 *
 * Responde "quais destes ids do TMDB ja estao no nosso catalogo?" com UMA
 * consulta por pagina (`tmdb_id IN (...)`, ate 100 ids), apoiada no indice
 * unico de `tmdb_id` de cada tabela. So le: nao cria, nao toca, nao bloqueia.
 *
 * Ver o cabecalho de `changes/run.ts` para o porque: sem este filtro, cada id
 * editado no TMDB virava um `sync_details` que CRIAVA o titulo.
 */

import type { PrismaClient } from '@screena/db/server'
import type { ChangesCatalogPort } from '../changes/run.js'

/** Cria a porta de catalogo do `/changes` apoiada no Prisma. */
export function createPrismaChangesCatalog(prisma: PrismaClient): ChangesCatalogPort {
  return {
    async existingTmdbIds(kind, tmdbIds): Promise<ReadonlySet<number>> {
      if (tmdbIds.length === 0) return new Set()
      const where = { tmdbId: { in: [...tmdbIds] } }
      const select = { tmdbId: true } as const
      const rows =
        kind === 'movie'
          ? await prisma.movie.findMany({ where, select })
          : kind === 'tv'
            ? await prisma.tvShow.findMany({ where, select })
            : await prisma.person.findMany({ where, select })
      return new Set(rows.map((row) => row.tmdbId))
    },
  }
}
