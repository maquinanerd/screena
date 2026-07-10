/**
 * watch-store.ts — Adapter de `watch_availability` (Prisma). EXCLUIDO do typecheck.
 *
 * IDEMPOTENCIA SEM UNIQUE: `watch_availability` nao tem chave natural unica.
 * Reexecutar `--apply` nao pode duplicar linha. A estrategia e um REPLACE
 * TRANSACIONAL do snapshot:
 *
 *    BEGIN
 *      DELETE FROM watch_availability
 *       WHERE entity_type = $1 AND entity_id = $2
 *         AND country_code = $3 AND provider_api = 'streaming_availability'
 *      INSERT ... (as ofertas novas)
 *    COMMIT
 *
 * ESCOPO DO DELETE (critico): filtra por `provider_api` DESTE worker. Linhas de
 * outros `provider_api` — inclusive as do seed demo e qualquer curadoria humana
 * futura sob outra chave — permanecem intactas. Nunca use `deleteMany` sem o
 * filtro de provider.
 *
 * INVARIANTE 6 (estrutural): `displayAllowed` nao e parametro — toda linha
 * nasce `false`. Os termos do provider exigem atribuicao visivel antes de
 * qualquer exibicao; enquanto ela nao existir na UI, nada aparece.
 */

import type { PrismaClient } from '@screena/db/server'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import type { WatchReplaceOutcome, WatchStorePort } from '../ports.js'

/** Cria um `WatchStorePort` com replace transacional por snapshot. */
export function createPrismaWatchStore(prisma: PrismaClient): WatchStorePort {
  return {
    async replaceSnapshot(input): Promise<WatchReplaceOutcome> {
      const entityId = BigInt(input.entityId)

      return prisma.$transaction(async (tx) => {
        const removed = await tx.watchAvailability.deleteMany({
          where: {
            entityType: input.entityType,
            entityId,
            countryCode: input.countryCode,
            // Escopo obrigatorio: nunca apaga snapshot de outro fornecedor.
            providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
          },
        })

        let created = 0
        for (const offer of input.offers) {
          await tx.watchAvailability.create({
            data: {
              entityType: offer.entityType,
              entityId,
              countryCode: offer.countryCode,
              providerKey: offer.providerKey,
              providerName: offer.providerName,
              offerType: offer.offerType,
              deepLink: offer.deepLink,
              // CHECK do schema: price NULL ou currency NOT NULL. O core ja
              // garante que os dois andam juntos.
              price: offer.price,
              currency: offer.currency,
              quality: offer.quality,
              availableFrom: offer.availableFrom,
              availableUntil: offer.availableUntil,
              fetchedAt: input.fetchedAt,
              staleAfter: input.staleAfter,
              providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
              // Fail-closed: nada exibivel ate licenca/atribuicao (invariante 6).
              displayAllowed: false,
            },
          })
          created += 1
        }

        return { deleted: removed.count, created }
      })
    },
  }
}
