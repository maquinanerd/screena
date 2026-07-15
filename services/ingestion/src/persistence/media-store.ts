/**
 * media-store.ts — Adapter Prisma de tmdb_images/tmdb_videos (Fase 7). EXCLUIDO
 * do typecheck (toca Prisma). Upsert IDEMPOTENTE por identidade natural:
 * so reescreve quando o payload_hash muda (nao bumpa updated_at a toa). Linhas
 * nascem display_allowed=false + license_status=unknown (default do schema).
 */

import type { PrismaClient } from '@screena/db/server'
import type { ImageRow, VideoRow } from '../catalog-sync/media-normalize.js'
import type { MediaStorePort, MediaUpsertOutcome } from '../catalog-sync/media-sync.js'

export function createPrismaMediaStore(prisma: PrismaClient): MediaStorePort {
  return {
    async upsertImages(rows: ImageRow[]): Promise<MediaUpsertOutcome> {
      let created = 0
      let updated = 0
      let unchanged = 0
      for (const r of rows) {
        const key = {
          entityType_tmdbId_imageType_filePath: {
            entityType: r.entityType as never,
            tmdbId: r.tmdbId,
            imageType: r.imageType,
            filePath: r.filePath,
          },
        }
        const existing = await prisma.tmdbImage.findUnique({ where: key })
        if (!existing) {
          await prisma.tmdbImage.create({
            data: {
              entityType: r.entityType as never,
              tmdbId: r.tmdbId,
              imageType: r.imageType,
              filePath: r.filePath,
              languageCode: r.languageCode,
              width: r.width,
              height: r.height,
              aspectRatio: r.aspectRatio,
              voteAverage: r.voteAverage,
              voteCount: r.voteCount,
              payloadHash: r.payloadHash,
            },
          })
          created += 1
        } else if (existing.payloadHash !== r.payloadHash) {
          await prisma.tmdbImage.update({
            where: { id: existing.id },
            data: {
              languageCode: r.languageCode,
              width: r.width,
              height: r.height,
              aspectRatio: r.aspectRatio,
              voteAverage: r.voteAverage,
              voteCount: r.voteCount,
              payloadHash: r.payloadHash,
              fetchedAt: new Date(),
            },
          })
          updated += 1
        } else {
          unchanged += 1
        }
      }
      return { created, updated, unchanged }
    },

    async upsertVideos(rows: VideoRow[]): Promise<MediaUpsertOutcome> {
      let created = 0
      let updated = 0
      let unchanged = 0
      for (const r of rows) {
        const key = {
          entityType_tmdbId_tmdbVideoId: {
            entityType: r.entityType as never,
            tmdbId: r.tmdbId,
            tmdbVideoId: r.tmdbVideoId,
          },
        }
        const existing = await prisma.tmdbVideo.findUnique({ where: key })
        if (!existing) {
          await prisma.tmdbVideo.create({
            data: {
              entityType: r.entityType as never,
              tmdbId: r.tmdbId,
              tmdbVideoId: r.tmdbVideoId,
              site: r.site,
              videoKey: r.videoKey,
              name: r.name,
              videoType: r.videoType,
              official: r.official,
              languageCode: r.languageCode,
              countryCode: r.countryCode,
              size: r.size,
              publishedAt: r.publishedAt,
              payloadHash: r.payloadHash,
            },
          })
          created += 1
        } else if (existing.payloadHash !== r.payloadHash) {
          await prisma.tmdbVideo.update({
            where: { id: existing.id },
            data: {
              site: r.site,
              videoKey: r.videoKey,
              name: r.name,
              videoType: r.videoType,
              official: r.official,
              languageCode: r.languageCode,
              countryCode: r.countryCode,
              size: r.size,
              publishedAt: r.publishedAt,
              payloadHash: r.payloadHash,
              fetchedAt: new Date(),
            },
          })
          updated += 1
        } else {
          unchanged += 1
        }
      }
      return { created, updated, unchanged }
    },
  }
}
