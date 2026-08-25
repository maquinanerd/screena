/**
 * image-config-store.ts — Adapter Prisma da linha singleton `tmdb_image_config`
 * (normalizacao de `/configuration`). COBERTO por `tsconfig.runtime.json` (`pnpm
 * typecheck` encadeia os dois).
 *
 * Idempotente: se o conteudo normalizado nao mudou, NAO reescreve (nao bumpa
 * `updated_at`) — so retorna `{ created:false, changed:false }`. Worker-only; o
 * render nunca le/escreve daqui.
 */

import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@screena/db/server'
import { imageConfigEquals, type ImageConfigRow } from '../config-sync/normalize.js'
import type { ImageConfigStorePort, ImageConfigUpsertOutcome } from '../config-sync/run.js'

/** Chave natural (PK) da linha singleton. */
const PROVIDER_API = 'tmdb'

/** Le uma linha existente e a converte para a forma normalizada (para comparar). */
function toRow(existing: {
  baseUrl: string
  secureBaseUrl: string
  posterSizes: unknown
  backdropSizes: unknown
  stillSizes: unknown
  profileSizes: unknown
  logoSizes: unknown
  changeKeys: unknown
}): ImageConfigRow {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const changeKeys = Array.isArray(existing.changeKeys)
    ? existing.changeKeys.filter((x): x is string => typeof x === 'string')
    : null
  return {
    baseUrl: existing.baseUrl,
    secureBaseUrl: existing.secureBaseUrl,
    posterSizes: arr(existing.posterSizes),
    backdropSizes: arr(existing.backdropSizes),
    stillSizes: arr(existing.stillSizes),
    profileSizes: arr(existing.profileSizes),
    logoSizes: arr(existing.logoSizes),
    changeKeys: changeKeys && changeKeys.length > 0 ? changeKeys : null,
  }
}

/** Cria um `ImageConfigStorePort` apoiado em `tmdb_image_config` via Prisma. */
export function createPrismaImageConfigStore(prisma: PrismaClient): ImageConfigStorePort {
  return {
    async upsert(row: ImageConfigRow): Promise<ImageConfigUpsertOutcome> {
      const data = {
        baseUrl: row.baseUrl,
        secureBaseUrl: row.secureBaseUrl,
        posterSizes: row.posterSizes,
        backdropSizes: row.backdropSizes,
        stillSizes: row.stillSizes,
        profileSizes: row.profileSizes,
        logoSizes: row.logoSizes,
        changeKeys: row.changeKeys === null ? Prisma.JsonNull : row.changeKeys,
      }

      const existing = await prisma.tmdbImageConfig.findUnique({ where: { providerApi: PROVIDER_API } })
      if (existing) {
        if (imageConfigEquals(toRow(existing), row)) {
          return { created: false, changed: false } // no-op: nao reescreve
        }
        await prisma.tmdbImageConfig.update({
          where: { providerApi: PROVIDER_API },
          data: { ...data, fetchedAt: new Date() },
        })
        return { created: false, changed: true }
      }

      await prisma.tmdbImageConfig.create({ data: { providerApi: PROVIDER_API, ...data } })
      return { created: true, changed: true }
    },
  }
}
