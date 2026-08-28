/**
 * media-store.ts — Adapter Prisma de tmdb_images/tmdb_videos (Fase 7). COBERTO por
 * `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois). Upsert IDEMPOTENTE por
 * identidade natural: so reescreve quando o payload_hash muda (nao bumpa
 * updated_at a toa).
 *
 * ============================================================================
 * O ESTADO DE NASCIMENTO VEM DA POLITICA, NAO DO DEFAULT DO DDL
 * ============================================================================
 * Ate 2026-08-28 este adapter omitia `display_allowed`/`license_status` no
 * `create` e as linhas nasciam `false`/`unknown` pelo DEFAULT do schema — sem
 * ninguem consultar a licenca. Agora o `create` grava o par que
 * `MediaBirthPolicy` decide, derivado de `source_licenses`
 * (`../media-promotion/birth.ts`).
 *
 * O `update` NAO toca essas duas colunas, e essa assimetria e deliberada: se
 * tocasse, o proximo ciclo de ingestao desfaria em silencio uma revogacao
 * deliberada de `promote:media --revoke`.
 */

import type { PrismaClient } from '@screena/db/server'
import type { ImageRow, VideoRow } from '../catalog-sync/media-normalize.js'
import type { MediaStorePort, MediaUpsertOutcome } from '../catalog-sync/media-sync.js'
import type { MediaBirthPolicy } from '../media-promotion/birth.js'

export function createPrismaMediaStore(prisma: PrismaClient): MediaStorePort {
  return {
    async upsertImages(rows: ImageRow[], birth: MediaBirthPolicy): Promise<MediaUpsertOutcome> {
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
          const nascimento = birth.forImage({ filePath: r.filePath })
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
              // As DUAS colunas, juntas. Gravar so `display_allowed` deixaria a
              // linha num meio-termo invisivel para toda consulta de render.
              displayAllowed: nascimento.displayAllowed,
              licenseStatus: nascimento.licenseStatus as never,
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

    async upsertVideos(rows: VideoRow[], birth: MediaBirthPolicy): Promise<MediaUpsertOutcome> {
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
          const nascimento = birth.forVideo({ site: r.site, videoKey: r.videoKey })
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
              // Idem imagens: as duas colunas na mesma escrita.
              displayAllowed: nascimento.displayAllowed,
              licenseStatus: nascimento.licenseStatus as never,
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
