/**
 * search-store.ts — Adapter Prisma da busca PostgreSQL (Backend A).
 * EXCLUIDO do typecheck (adapters Prisma em persistence/).
 *
 * Implementa `SearchStorePort`: upsert idempotente de search_documents (chave
 * natural entity_type+entity_id+locale) e a leitura ranqueada via a consulta
 * PARAMETRIZADA de ../search/query.ts (nenhum literal do usuario concatenado).
 */

import type { PrismaClient } from '@screena/db/server'
import { buildSearchQuery, matchReasonFromTier, scoreFromTier } from '../search/query.js'
import type { SearchDocumentRow } from '../search/projection.js'
import type { SearchResultRow, SearchStorePort } from '../search/store-port.js'
import type { SearchQueryOptions } from '../search/query.js'

interface RawResultRow {
  readonly entity_type: string
  readonly entity_id: bigint
  readonly primary_text: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly image_path: string | null
  readonly canonical_url: string | null
  readonly match_tier: number
  readonly sim: number
}

function mapRow(row: RawResultRow): SearchResultRow {
  const tier = Number(row.match_tier)
  const sim = Number(row.sim)
  return {
    entityType: row.entity_type,
    entityId: row.entity_id.toString(),
    title: row.primary_text,
    subtitle: row.subtitle,
    year: row.year === null ? null : Number(row.year),
    imagePath: row.image_path,
    canonicalUrl: row.canonical_url,
    matchReason: matchReasonFromTier(tier),
    score: scoreFromTier(tier, sim),
  }
}

/** Cria um `SearchStorePort` apoiado no Prisma. */
export function createPrismaSearchStore(prisma: PrismaClient): SearchStorePort {
  return {
    async upsertDocument(row: SearchDocumentRow): Promise<void> {
      const data = {
        primaryText: row.primaryText,
        alternativeText: row.alternativeText,
        normalizedText: row.normalizedText,
        normalizedAliases: row.normalizedAliases,
        subtitle: row.subtitle,
        year: row.year,
        popularity: row.popularity,
        imagePath: row.imagePath,
        canonicalUrl: row.canonicalUrl,
      }
      await prisma.searchDocument.upsert({
        where: {
          entityType_entityId_locale: {
            entityType: row.entityType,
            entityId: BigInt(row.entityId),
            locale: row.locale,
          },
        },
        create: {
          entityType: row.entityType,
          entityId: BigInt(row.entityId),
          locale: row.locale,
          ...data,
        },
        update: data,
      })
    },

    async deleteDocument(entityType, entityId: string, locale: string): Promise<void> {
      await prisma.searchDocument.deleteMany({
        where: { entityType, entityId: BigInt(entityId), locale },
      })
    },

    async search(rawTerm: string, options: SearchQueryOptions): Promise<SearchResultRow[]> {
      const built = buildSearchQuery(rawTerm, options)
      if (built.term.length === 0) return []
      const rows = (await prisma.$queryRawUnsafe(built.sql, ...built.params)) as RawResultRow[]
      return rows.map(mapRow)
    },
  }
}
