/**
 * media-promotion-store.ts — Adapter Prisma da promocao de midia.
 *
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois).
 *
 * ============================================================================
 * DEFESA EM PROFUNDIDADE NO `WHERE`
 * ============================================================================
 * Os guardrails puros ja recusam linha fora de escopo, e mesmo assim TODO
 * `updateMany` daqui reafirma o escopo no proprio `WHERE`:
 * `provider_api = 'tmdb'`, o tipo/site do alvo, e o estado esperado.
 *
 * Nao e desconfianca do modulo puro — e que `tmdb_videos` NAO TEM TRIGGER.
 * Onde `watch_availability` tem o banco como ultima palavra, aqui a ultima
 * palavra e esta clausula. Um id que chegasse aqui por engano encontraria a
 * segunda barreira em vez de virar linha publica.
 *
 * ============================================================================
 * AS DUAS COLUNAS, NA MESMA ESCRITA
 * ============================================================================
 * `display_allowed` e `license_status` sao gravadas juntas, num `updateMany` so.
 * Separa-las abriria uma janela em que a linha esta "meio promovida" — e o
 * estado meio-promovido (`display_allowed=true`, `license_status='unknown'`) e
 * invisivel para a tela e indistinguivel, no banco, de um bug.
 */

import type { PrismaClient } from '@screena/db/server'

import type {
  MediaPromotionStorePort,
  PromotionScope,
  StoreMutationOutcome,
  StoreRefusal,
} from '../media-promotion/run.js'
import type { MediaLicenseRow } from '../media-promotion/license.js'
import {
  ALLOWED_VIDEO_SITE,
  GOVERNED_SOURCE_KEY,
  LICENSE_CONTENT_TYPE_BY_TARGET,
  PERSON_PHOTO_IMAGE_TYPE,
  type PromotionCandidate,
  type PromotionTarget,
} from '../media-promotion/types.js'

/**
 * Quantas linhas por lote de `updateMany`.
 *
 * Nao e otimizacao: um `IN (...)` com 1.119 ids e um plano de query ruim e uma
 * transacao longa segurando lock sobre a tabela que a ingestao escreve. Lotes
 * de 200 mantem cada escrita curta.
 */
const MUTATION_CHUNK = 200

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Cria o adapter. */
export function createPrismaMediaPromotionStore(
  prisma: PrismaClient,
): MediaPromotionStorePort {
  return {
    async readLicenses(target: PromotionTarget): Promise<readonly MediaLicenseRow[]> {
      const rows = await prisma.sourceLicense.findMany({
        where: {
          sourceKey: GOVERNED_SOURCE_KEY,
          contentType: LICENSE_CONTENT_TYPE_BY_TARGET[target] as never,
        },
        select: {
          sourceKey: true,
          contentType: true,
          licenseStatus: true,
          displayAllowed: true,
          isCurrent: true,
          policyVersion: true,
        },
      })
      return rows.map((row) => ({
        sourceKey: row.sourceKey,
        contentType: String(row.contentType),
        licenseStatus: String(row.licenseStatus),
        displayAllowed: row.displayAllowed,
        isCurrent: row.isCurrent,
        policyVersion: row.policyVersion,
      }))
    },

    async countTarget(target: PromotionTarget): Promise<number> {
      if (target === 'video') {
        return await prisma.tmdbVideo.count({ where: { providerApi: GOVERNED_SOURCE_KEY } })
      }
      return await prisma.tmdbImage.count({
        where: {
          providerApi: GOVERNED_SOURCE_KEY,
          entityType: 'person',
          imageType: PERSON_PHOTO_IMAGE_TYPE,
        },
      })
    },

    async listCandidates(scope: PromotionScope): Promise<readonly PromotionCandidate[]> {
      const take = scope.limit ?? undefined

      if (scope.target === 'video') {
        const rows = await prisma.tmdbVideo.findMany({
          where: {
            providerApi: GOVERNED_SOURCE_KEY,
            ...(scope.entityType !== null ? { entityType: scope.entityType as never } : {}),
            ...(scope.tmdbId !== null ? { tmdbId: scope.tmdbId } : {}),
          },
          // Ordem ESTAVEL: com `--limit`, duas execucoes tem de ver o mesmo
          // recorte, senao o dry-run ensaia um conjunto e o apply muta outro.
          orderBy: [{ id: 'asc' }],
          ...(take !== undefined ? { take } : {}),
          select: {
            id: true,
            providerApi: true,
            entityType: true,
            tmdbId: true,
            site: true,
            videoKey: true,
            name: true,
            videoType: true,
            official: true,
            languageCode: true,
            displayAllowed: true,
            licenseStatus: true,
          },
        })
        return rows.map((row) => ({
          kind: 'video' as const,
          id: row.id.toString(),
          providerApi: row.providerApi,
          entityType: String(row.entityType),
          tmdbId: row.tmdbId,
          site: row.site,
          videoKey: row.videoKey,
          name: row.name,
          videoType: row.videoType,
          official: row.official,
          languageCode: row.languageCode,
          displayAllowed: row.displayAllowed,
          licenseStatus: String(row.licenseStatus),
        }))
      }

      const rows = await prisma.tmdbImage.findMany({
        where: {
          providerApi: GOVERNED_SOURCE_KEY,
          entityType: 'person',
          imageType: PERSON_PHOTO_IMAGE_TYPE,
          ...(scope.tmdbId !== null ? { tmdbId: scope.tmdbId } : {}),
        },
        orderBy: [{ id: 'asc' }],
        ...(take !== undefined ? { take } : {}),
        select: {
          id: true,
          providerApi: true,
          entityType: true,
          tmdbId: true,
          imageType: true,
          filePath: true,
          languageCode: true,
          displayAllowed: true,
          licenseStatus: true,
        },
      })
      return rows.map((row) => ({
        kind: 'person-photo' as const,
        id: row.id.toString(),
        providerApi: row.providerApi,
        entityType: String(row.entityType),
        tmdbId: row.tmdbId,
        imageType: row.imageType,
        filePath: row.filePath,
        languageCode: row.languageCode,
        displayAllowed: row.displayAllowed,
        licenseStatus: String(row.licenseStatus),
      }))
    },

    async promote(
      target: PromotionTarget,
      ids: readonly string[],
      licenseStatus: string,
    ): Promise<StoreMutationOutcome> {
      // O status vem do gate de licenca. Vazio aqui significa que alguem chamou
      // o store por fora do `run` — e gravar `''` corromperia o enum.
      if (licenseStatus.trim() === '') {
        return {
          updated: 0,
          refusals: ids.map((id) => ({
            id,
            message: 'license_status vazio: o store nunca inventa status (veio de fora do gate?).',
          })),
        }
      }
      return await mutate(target, ids, {
        displayAllowed: true,
        licenseStatus: licenseStatus as never,
      })
    },

    async revoke(target: PromotionTarget, ids: readonly string[]): Promise<StoreMutationOutcome> {
      // Volta ao ESTADO DE NASCIMENTO, as duas colunas. Reverter so
      // `display_allowed` deixaria a linha com um `license_status` afirmando uma
      // licenca que ninguem mais esta conferindo.
      return await mutate(target, ids, { displayAllowed: false, licenseStatus: 'unknown' as never })
    },
  }

  /** Aplica a mesma mutacao em lotes, reafirmando o escopo no `WHERE`. */
  async function mutate(
    target: PromotionTarget,
    ids: readonly string[],
    data: { displayAllowed: boolean; licenseStatus: never },
  ): Promise<StoreMutationOutcome> {
    let updated = 0
    const refusals: StoreRefusal[] = []

    for (const lote of chunk(ids, MUTATION_CHUNK)) {
      const bigIds = lote.map((id) => BigInt(id))
      try {
        if (target === 'video') {
          const result = await prisma.tmdbVideo.updateMany({
            where: {
              id: { in: bigIds },
              // Defesa em profundidade: o escopo, de novo, no proprio UPDATE.
              providerApi: GOVERNED_SOURCE_KEY,
              site: ALLOWED_VIDEO_SITE,
            },
            data,
          })
          updated += result.count
        } else {
          const result = await prisma.tmdbImage.updateMany({
            where: {
              id: { in: bigIds },
              providerApi: GOVERNED_SOURCE_KEY,
              entityType: 'person',
              imageType: PERSON_PHOTO_IMAGE_TYPE,
            },
            data,
          })
          updated += result.count
        }
      } catch (error) {
        // RECUSA DO BANCO NUNCA E MUDA. Um `catch` vazio aqui produziria
        // "0 mutadas" sem causa — o defeito exato que a promocao de streaming ja
        // pagou uma vez.
        const message = error instanceof Error ? error.message : String(error)
        for (const id of lote) refusals.push({ id, message })
      }
    }

    return { updated, refusals }
  }
}
