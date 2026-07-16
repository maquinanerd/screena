/**
 * catalog-entities-store.ts — Adapter Prisma das entidades de referencia.
 * EXCLUIDO do typecheck (adapters Prisma em persistence/).
 *
 * Implementa `CatalogEntitiesStorePort`: upsert idempotente de colecoes,
 * produtoras, redes e keywords (chave natural tmdb_id) + link com a entidade dona
 * (resolvida por tmdbId). Titulos alternativos usam REPLACE-SET (delete+createMany)
 * — o unique tem `country_code` NULAVEL e no Postgres NULLs sao distintos, entao
 * upsert por chave composta seria furado; a dobra ja veio deduplicada do normalizer.
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  CatalogEntitiesStorePort,
  CatalogEntitiesSyncResult,
  SyncEntityReferencesInput,
} from '../catalog-entities/store-port.js'
import type {
  CollectionPartRow,
  CollectionRow,
  CompanyRow,
  KeywordRow,
  NetworkRow,
} from '../catalog-entities/normalize.js'

const ZERO: CatalogEntitiesSyncResult = {
  collections: 0,
  companies: 0,
  networks: 0,
  keywords: 0,
  alternativeTitles: 0,
}

/** Cria um `CatalogEntitiesStorePort` apoiado no Prisma. */
export function createPrismaCatalogEntitiesStore(prisma: PrismaClient): CatalogEntitiesStorePort {
  /** Upsert de colecao por tmdb_id; retorna o id interno. */
  async function upsertCollection(row: CollectionRow): Promise<bigint> {
    const data = {
      name: row.name,
      overview: row.overview,
      posterPath: row.posterPath,
      backdropPath: row.backdropPath,
      lastSyncedAt: new Date(),
    }
    const saved = await prisma.collection.upsert({
      where: { tmdbId: row.tmdbId },
      create: { tmdbId: row.tmdbId, ...data },
      // Nao sobrescreve overview/arte com null quando a origem e o ref curto do
      // detalhe do filme (o GET dedicado e quem traz o overview).
      update: {
        name: data.name,
        ...(row.overview === null ? {} : { overview: row.overview }),
        ...(row.posterPath === null ? {} : { posterPath: row.posterPath }),
        ...(row.backdropPath === null ? {} : { backdropPath: row.backdropPath }),
        lastSyncedAt: data.lastSyncedAt,
      },
      select: { id: true },
    })
    return saved.id
  }

  async function upsertCompanyRow(row: CompanyRow): Promise<bigint> {
    const saved = await prisma.productionCompany.upsert({
      where: { tmdbId: row.tmdbId },
      create: {
        tmdbId: row.tmdbId,
        name: row.name,
        logoPath: row.logoPath,
        originCountry: row.originCountry,
        headquarters: row.headquarters,
        homepage: row.homepage,
        lastSyncedAt: new Date(),
      },
      update: {
        name: row.name,
        ...(row.logoPath === null ? {} : { logoPath: row.logoPath }),
        ...(row.originCountry === null ? {} : { originCountry: row.originCountry }),
        ...(row.headquarters === null ? {} : { headquarters: row.headquarters }),
        ...(row.homepage === null ? {} : { homepage: row.homepage }),
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    })
    return saved.id
  }

  async function upsertNetworkRow(row: NetworkRow): Promise<bigint> {
    const saved = await prisma.network.upsert({
      where: { tmdbId: row.tmdbId },
      create: {
        tmdbId: row.tmdbId,
        name: row.name,
        logoPath: row.logoPath,
        originCountry: row.originCountry,
        headquarters: row.headquarters,
        homepage: row.homepage,
        lastSyncedAt: new Date(),
      },
      update: {
        name: row.name,
        ...(row.logoPath === null ? {} : { logoPath: row.logoPath }),
        ...(row.originCountry === null ? {} : { originCountry: row.originCountry }),
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    })
    return saved.id
  }

  async function upsertKeywordRow(row: KeywordRow): Promise<bigint> {
    const saved = await prisma.keyword.upsert({
      where: { tmdbId: row.tmdbId },
      create: { tmdbId: row.tmdbId, name: row.name },
      update: { name: row.name },
      select: { id: true },
    })
    return saved.id
  }

  /** Resolve o id interno da entidade dona pelo tmdbId (null se nao promovida). */
  async function resolveOwner(entityType: 'movie' | 'tv', tmdbId: number): Promise<bigint | null> {
    if (entityType === 'movie') {
      const m = await prisma.movie.findUnique({ where: { tmdbId }, select: { id: true } })
      return m?.id ?? null
    }
    const t = await prisma.tvShow.findUnique({ where: { tmdbId }, select: { id: true } })
    return t?.id ?? null
  }

  return {
    async syncEntityReferences(input: SyncEntityReferencesInput) {
      const ownerId = await resolveOwner(input.entityType, input.entityTmdbId)
      // Entidade dona ainda nao promovida: nada a ligar (nunca cria entidade).
      if (ownerId === null) return ZERO

      let collections = 0
      if (input.collection !== null && input.entityType === 'movie') {
        const collectionId = await upsertCollection(input.collection)
        await prisma.movieCollectionMembership.upsert({
          where: { collectionId_movieId: { collectionId, movieId: ownerId } },
          create: { collectionId, movieId: ownerId },
          update: {},
        })
        collections = 1
      }

      let companies = 0
      for (const row of input.companies) {
        const companyId = await upsertCompanyRow(row)
        if (input.entityType === 'movie') {
          await prisma.movieProductionCompany.upsert({
            where: { movieId_companyId: { movieId: ownerId, companyId } },
            create: { movieId: ownerId, companyId },
            update: {},
          })
        } else {
          await prisma.tvProductionCompany.upsert({
            where: { tvShowId_companyId: { tvShowId: ownerId, companyId } },
            create: { tvShowId: ownerId, companyId },
            update: {},
          })
        }
        companies += 1
      }

      let networks = 0
      if (input.entityType === 'tv') {
        for (const row of input.networks) {
          const networkId = await upsertNetworkRow(row)
          await prisma.tvNetwork.upsert({
            where: { tvShowId_networkId: { tvShowId: ownerId, networkId } },
            create: { tvShowId: ownerId, networkId },
            update: {},
          })
          networks += 1
        }
      }

      let keywords = 0
      for (const row of input.keywords) {
        const keywordId = await upsertKeywordRow(row)
        await prisma.entityKeyword.upsert({
          where: {
            keywordId_entityType_entityId: {
              keywordId,
              entityType: input.entityType,
              entityId: ownerId,
            },
          },
          create: { keywordId, entityType: input.entityType, entityId: ownerId },
          update: {},
        })
        keywords += 1
      }

      // Replace-set (ver cabecalho): determinista e idempotente.
      let alternativeTitles = 0
      if (input.alternativeTitles.length > 0) {
        await prisma.$transaction([
          prisma.entityAlternativeTitle.deleteMany({
            where: { entityType: input.entityType, entityId: ownerId },
          }),
          prisma.entityAlternativeTitle.createMany({
            data: input.alternativeTitles.map((t) => ({
              entityType: input.entityType,
              entityId: ownerId,
              countryCode: t.countryCode,
              title: t.title,
              normalized: t.normalized,
              type: t.type,
              source: 'tmdb',
            })),
          }),
        ])
        alternativeTitles = input.alternativeTitles.length
      }

      return { collections, companies, networks, keywords, alternativeTitles }
    },

    async upsertCollectionWithParts(
      collection: CollectionRow,
      parts: readonly CollectionPartRow[],
    ) {
      const collectionId = await upsertCollection(collection)
      let linked = 0
      for (const part of parts) {
        const movie = await prisma.movie.findUnique({
          where: { tmdbId: part.tmdbId },
          select: { id: true },
        })
        // So liga membros JA promovidos: a colecao nunca cria filme.
        if (movie === null) continue
        await prisma.movieCollectionMembership.upsert({
          where: { collectionId_movieId: { collectionId, movieId: movie.id } },
          create: { collectionId, movieId: movie.id, position: part.position },
          update: { position: part.position },
        })
        linked += 1
      }
      return linked
    },

    async upsertCompany(row: CompanyRow) {
      await upsertCompanyRow(row)
    },
    async upsertNetwork(row: NetworkRow) {
      await upsertNetworkRow(row)
    },
    async upsertKeyword(row: KeywordRow) {
      await upsertKeywordRow(row)
    },
  }
}
