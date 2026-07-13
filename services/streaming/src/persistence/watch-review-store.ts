/**
 * watch-review-store.ts — Adapter Prisma da revisao/promocao. EXCLUIDO do typecheck.
 *
 * So LE e ATUALIZA `watch_availability`. Nunca cria linha, nunca toca outra
 * tabela alem de resolver o TITULO da entidade (movies.title_original /
 * tv_shows.name_original) para o relatorio.
 *
 * DEFESA EM PROFUNDIDADE nos updates:
 *  - `promote`: WHERE reafirma `provider_api = streaming_availability`,
 *    `country_code = BR` e `display_allowed = false`. Um id de outro provider,
 *    outro pais ou ja exibivel NUNCA e virado, mesmo que chegue na lista.
 *  - `revoke`: WHERE reafirma `provider_api = streaming_availability` e
 *    `display_allowed = true`.
 * `updateMany` toca SO a coluna `display_allowed` — jamais rating/screen_score.
 */

import type { PrismaClient } from '@screena/db/server'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import type {
  PromotionResult,
  ReviewQuery,
  ReviewStorePort,
  StoreMutationOutcome,
} from '../promotion/run.js'
import type { PromotionCandidate } from '../promotion/types.js'

const CANDIDATE_SELECT = {
  id: true,
  entityType: true,
  entityId: true,
  countryCode: true,
  providerApi: true,
  providerKey: true,
  providerName: true,
  offerType: true,
  deepLink: true,
  price: true,
  currency: true,
  quality: true,
  availableUntil: true,
  fetchedAt: true,
  displayAllowed: true,
} as const

interface WatchRow {
  readonly id: bigint
  readonly entityType: string
  readonly entityId: bigint
  readonly countryCode: string
  readonly providerApi: string | null
  readonly providerKey: string | null
  readonly providerName: string
  readonly offerType: string
  readonly deepLink: string | null
  readonly price: unknown
  readonly currency: string | null
  readonly quality: string | null
  readonly availableUntil: Date | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
}

/** Prisma Decimal -> number | null (o relatorio nunca carrega Decimal). */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toCandidate(row: WatchRow, title: string | null): PromotionCandidate {
  return {
    id: row.id.toString(),
    entityType: row.entityType,
    entityId: row.entityId.toString(),
    title,
    countryCode: row.countryCode,
    providerApi: row.providerApi,
    providerKey: row.providerKey,
    providerName: row.providerName,
    offerType: row.offerType,
    deepLink: row.deepLink,
    price: toNumber(row.price),
    currency: row.currency,
    quality: row.quality,
    availableUntil: row.availableUntil,
    fetchedAt: row.fetchedAt,
    displayAllowed: row.displayAllowed,
  }
}

/**
 * Resolve o titulo original de cada linha (best-effort). Filmes usam
 * `title_original`; series, `name_original`. Falha na busca de titulo nunca
 * derruba a revisao — o titulo simplesmente fica `null`.
 */
async function resolveTitles(
  prisma: PrismaClient,
  rows: readonly WatchRow[],
): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>()
  const movieIds = new Set<bigint>()
  const tvIds = new Set<bigint>()
  for (const row of rows) {
    if (row.entityType === 'movie') movieIds.add(row.entityId)
    else if (row.entityType === 'tv') tvIds.add(row.entityId)
  }

  const keyOf = (entityType: string, entityId: bigint): string => `${entityType}:${entityId.toString()}`

  try {
    if (movieIds.size > 0) {
      const movies = await prisma.movie.findMany({
        where: { id: { in: [...movieIds] } },
        select: { id: true, titleOriginal: true },
      })
      for (const movie of movies) titles.set(keyOf('movie', movie.id), movie.titleOriginal)
    }
    if (tvIds.size > 0) {
      const shows = await prisma.tvShow.findMany({
        where: { id: { in: [...tvIds] } },
        select: { id: true, nameOriginal: true },
      })
      for (const show of shows) titles.set(keyOf('tv', show.id), show.nameOriginal)
    }
  } catch {
    // Titulo e enfeite do relatorio; a decisao nao depende dele.
  }

  const byRow = new Map<string, string | null>()
  for (const row of rows) {
    byRow.set(row.id.toString(), titles.get(keyOf(row.entityType, row.entityId)) ?? null)
  }
  return byRow
}

/** Cria um `ReviewStorePort` sobre `watch_availability` (leitura + gate). */
export function createPrismaReviewStore(prisma: PrismaClient): ReviewStorePort {
  async function hydrate(rows: readonly WatchRow[]): Promise<readonly PromotionCandidate[]> {
    const titles = await resolveTitles(prisma, rows)
    return rows.map((row) => toCandidate(row, titles.get(row.id.toString()) ?? null))
  }

  return {
    async listCandidates(query: ReviewQuery): Promise<readonly PromotionCandidate[]> {
      const where: Record<string, unknown> = {
        // A listagem NUNCA traz outro fornecedor nem outro pais.
        providerApi: query.providerApi,
        countryCode: query.countryCode,
      }
      if (query.entityType !== null) where.entityType = query.entityType
      if (query.entityId !== null) where.entityId = BigInt(query.entityId)

      const rows = (await prisma.watchAvailability.findMany({
        where,
        select: CANDIDATE_SELECT,
        orderBy: { id: 'asc' },
        take: query.limit,
      })) as unknown as WatchRow[]
      return hydrate(rows)
    },

    async findByIds(ids: readonly string[]): Promise<readonly PromotionCandidate[]> {
      if (ids.length === 0) return []
      const bigIds = ids.map((id) => BigInt(id))
      // Sem filtro de provider/pais AQUI de proposito: trazemos a linha do id
      // pedido para que o guardrail EXPLIQUE por que a rejeita (wrong-provider /
      // wrong-country). O update e que reafirma o escopo.
      const rows = (await prisma.watchAvailability.findMany({
        where: { id: { in: bigIds } },
        select: CANDIDATE_SELECT,
        orderBy: { id: 'asc' },
      })) as unknown as WatchRow[]
      return hydrate(rows)
    },

    async promote(ids: readonly string[]): Promise<StoreMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      const result = await prisma.watchAvailability.updateMany({
        where: {
          id: { in: ids.map((id) => BigInt(id)) },
          providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
          countryCode: 'BR',
          displayAllowed: false,
        },
        data: { displayAllowed: true },
      })
      return { updated: result.count }
    },

    async revoke(ids: readonly string[]): Promise<StoreMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      const result = await prisma.watchAvailability.updateMany({
        where: {
          id: { in: ids.map((id) => BigInt(id)) },
          providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
          displayAllowed: true,
        },
        data: { displayAllowed: false },
      })
      return { updated: result.count }
    },
  }
}

/** Reexport de tipo por conveniencia dos bins (sem valor em runtime). */
export type { PromotionResult }
