/**
 * entity-candidates.ts — Selecao de candidatos locais por tipo (Prisma).
 * EXCLUIDO do typecheck (toca Prisma).
 *
 * Lista ate `limit` entidades locais que TEM `imdb_id` (o `/item/` foi validado
 * com IMDb id), para o modo sem `--id`. NUNCA casa por titulo/ano.
 *
 * Ordem ESTAVEL por `id asc` (determinista, independente de `updated_at`): dois
 * ciclos com o mesmo `limit` selecionam o mesmo prefixo de entidades — o piloto
 * e reprodutivel, e o relatorio nao "pula" candidatos entre execucoes.
 */

import type { PrismaClient } from '@screena/db/server'
import type { EntityCandidateSelectPort, RatingsEntityCandidate } from '../ports.js'
import type { RatingsEntityType } from '../film-show-ratings/types.js'

/** Cria um `EntityCandidateSelectPort` sobre `movies` / `tv_shows` via Prisma. */
export function createPrismaEntityCandidates(prisma: PrismaClient): EntityCandidateSelectPort {
  return {
    async selectByType(
      entityType: RatingsEntityType,
      limit: number,
    ): Promise<readonly RatingsEntityCandidate[]> {
      const where = { imdbId: { not: null } }
      const select = { id: true, imdbId: true, tmdbId: true }
      const orderBy = { id: 'asc' as const }
      const take = Math.max(0, Math.trunc(limit))

      const rows =
        entityType === 'movie'
          ? await prisma.movie.findMany({ where, select, orderBy, take })
          : await prisma.tvShow.findMany({ where, select, orderBy, take })

      const candidates: RatingsEntityCandidate[] = []
      for (const row of rows) {
        // Defensivo: `where` ja filtra imdb nao-nulo, mas nunca enfileiramos um
        // candidato sem IMDb id (a resolucao por `/item/` depende dele).
        if (row.imdbId === null || row.imdbId === undefined) continue
        candidates.push({
          entityType,
          entityId: row.id.toString(),
          imdbId: row.imdbId,
          tmdbId: row.tmdbId ?? null,
        })
      }
      return candidates
    },
  }
}
