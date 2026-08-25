/**
 * awards-cache-source.ts — Le os payloads OMDb ja guardados em `api_cache`.
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * ESTA E A UNICA ORIGEM DO DADO DE PREMIACAO. Nao ha chamada de rede em lugar
 * nenhum deste caminho: o literal `Awards` chegou no primeiro sync de ratings e
 * ficou guardado. Promove-lo custa zero de cota da OMDb.
 *
 * Somente leitura: este adapter nunca escreve em `api_cache`.
 */

import type { PrismaClient } from '@screena/db/server'

import type { AwardsCacheSourcePort } from '../awards/ports.js'
import type { CachedOmdbPayload } from '../awards/types.js'

/**
 * Cria o leitor de payloads em cache.
 *
 * Ordem por `id` crescente: ordem TOTAL e estavel entre execucoes. Sem ela, um
 * `--limit` menor que o total leria um recorte diferente a cada rodada e o
 * operador nunca saberia o que ficou de fora.
 */
export function createPrismaAwardsCacheSource(
  prisma: PrismaClient,
  providerApi: string,
): AwardsCacheSourcePort {
  return {
    async list(limit: number): Promise<readonly CachedOmdbPayload[]> {
      const rows = await prisma.apiCache.findMany({
        where: { providerApi },
        orderBy: { id: 'asc' },
        take: limit,
        select: { requestKey: true, payload: true, payloadHash: true, fetchedAt: true },
      })

      return rows.map((row) => ({
        requestKey: row.requestKey,
        payload: row.payload as unknown,
        payloadHash: row.payloadHash,
        fetchedAt: row.fetchedAt,
      }))
    },
  }
}
