/**
 * catalog-stores.ts — Adapters Prisma de `genres` (Fase 6) e
 * `tmdb_sync_checkpoint` (Fase 8). EXCLUIDO do typecheck (toca Prisma).
 * Upserts idempotentes por identidade natural.
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  GenreRow,
  GenresStorePort,
  GenresUpsertOutcome,
} from '../catalog-sync/genres-normalize.js'
import type { CheckpointState, CheckpointStorePort } from '../catalog-sync/list-sync.js'

/** Store de `genres` — upsert por (media_type, tmdb_id); no-op quando nome igual. */
export function createPrismaGenresStore(prisma: PrismaClient): GenresStorePort {
  return {
    async upsert(rows: GenreRow[]): Promise<GenresUpsertOutcome> {
      let created = 0
      let updated = 0
      let unchanged = 0
      for (const r of rows) {
        const key = { mediaType_tmdbId: { mediaType: r.mediaType, tmdbId: r.tmdbId } }
        const existing = await prisma.genre.findUnique({ where: key })
        if (!existing) {
          await prisma.genre.create({ data: { mediaType: r.mediaType, tmdbId: r.tmdbId, name: r.name } })
          created += 1
        } else if (existing.name !== r.name) {
          await prisma.genre.update({ where: key, data: { name: r.name } })
          updated += 1
        } else {
          unchanged += 1
        }
      }
      return { created, updated, unchanged }
    },
  }
}

/** Store de checkpoint — upsert por (job, params_hash). */
export function createPrismaCheckpointStore(prisma: PrismaClient): CheckpointStorePort {
  return {
    async load(job: string, paramsHash: string): Promise<CheckpointState | null> {
      const row = await prisma.tmdbSyncCheckpoint.findUnique({ where: { job_paramsHash: { job, paramsHash } } })
      return row ? { lastPage: row.lastPage, totalPages: row.totalPages, done: row.done } : null
    },
    async save(job: string, paramsHash: string, state: CheckpointState): Promise<void> {
      await prisma.tmdbSyncCheckpoint.upsert({
        where: { job_paramsHash: { job, paramsHash } },
        create: { job, paramsHash, lastPage: state.lastPage, totalPages: state.totalPages, done: state.done },
        update: { lastPage: state.lastPage, totalPages: state.totalPages, done: state.done },
      })
    },
  }
}
