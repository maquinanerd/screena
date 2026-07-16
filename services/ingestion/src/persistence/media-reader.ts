/**
 * media-reader.ts — Adapter Prisma de LEITURA de midia (Backend A, secao 8).
 * EXCLUIDO do typecheck (adapters Prisma vivem em persistence/).
 *
 * Implementa `MediaReaderPort`: le tmdb_images/tmdb_videos de uma entidade e
 * apura as contagens de cobertura. NAO aplica governanca: devolve as linhas como
 * estao (inclusive `display_allowed=false`) e o filtro da invariante 6 acontece
 * em buildMediaPayload. Assim o worker/admin consegue auditar o que existe sem
 * que o payload publico jamais exponha o nao liberado.
 *
 * WORKER-ONLY: nunca importado pelo render publico.
 */

import type { PrismaClient } from '@screena/db/server'
import type { MediaImageRow, MediaVideoRow } from '../media/build.js'
import type { MediaCoverageCounts, MediaOwnerKind, MediaReaderPort } from '../media/store-port.js'

/** Conta o universo de entidades daquele tipo (denominador da cobertura). */
async function countEntities(prisma: PrismaClient, kind: MediaOwnerKind): Promise<number> {
  switch (kind) {
    case 'movie':
      return prisma.movie.count()
    case 'tv':
      return prisma.tvShow.count()
    case 'season':
      return prisma.season.count()
    case 'episode':
      return prisma.episode.count()
    case 'person':
      return prisma.person.count()
    default:
      return 0
  }
}

/** Cria um `MediaReaderPort` apoiado no Prisma. */
export function createPrismaMediaReader(prisma: PrismaClient): MediaReaderPort {
  return {
    async readImages(kind: MediaOwnerKind, tmdbId: number): Promise<MediaImageRow[]> {
      const rows = await prisma.tmdbImage.findMany({
        where: { entityType: kind as never, tmdbId },
        orderBy: [{ voteAverage: 'desc' }],
      })
      return rows.map((r) => ({
        id: String(r.id),
        imageType: r.imageType,
        filePath: r.filePath,
        languageCode: r.languageCode,
        width: r.width,
        height: r.height,
        aspectRatio: r.aspectRatio,
        voteAverage: r.voteAverage,
        displayAllowed: r.displayAllowed,
      }))
    },

    async readVideos(kind: MediaOwnerKind, tmdbId: number): Promise<MediaVideoRow[]> {
      const rows = await prisma.tmdbVideo.findMany({
        where: { entityType: kind as never, tmdbId },
      })
      return rows.map((r) => ({
        id: String(r.id),
        tmdbVideoId: r.tmdbVideoId,
        site: r.site,
        videoKey: r.videoKey,
        name: r.name,
        videoType: r.videoType,
        official: r.official,
        languageCode: r.languageCode,
        publishedAt: r.publishedAt,
        displayAllowed: r.displayAllowed,
      }))
    },

    async coverage(kind: MediaOwnerKind): Promise<MediaCoverageCounts> {
      const total = await countEntities(prisma, kind)

      // groupBy por tmdb_id = contagem de entidades DISTINTAS com midia
      // (uma entidade com 20 posters conta 1, nao 20).
      const imageGroups = await prisma.tmdbImage.groupBy({
        by: ['tmdbId'],
        where: { entityType: kind as never },
      })

      const trailerGroups = await prisma.tmdbVideo.groupBy({
        by: ['tmdbId'],
        where: {
          entityType: kind as never,
          videoType: { contains: 'trailer', mode: 'insensitive' },
        },
      })

      return {
        total,
        withImages: imageGroups.length,
        withTrailer: trailerGroups.length,
      }
    },
  }
}
