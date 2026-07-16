/**
 * discovery-snapshot-store.ts — Adapter Prisma dos snapshots de descoberta.
 * EXCLUIDO do typecheck (adapters Prisma em persistence/).
 *
 * Grava snapshots imutaveis das listas. Regras:
 *  - itens sao resolvidos de tmdb_id -> id interno; o que nao esta PROMOVIDO e
 *    ignorado (o snapshot nunca cria entidade);
 *  - se o ultimo snapshot da mesma identidade tem o MESMO payload_hash e ainda e
 *    valido, nao grava nada (created=false) — lista inalterada, sem churn;
 *  - snapshot + itens gravam numa transacao (nunca um snapshot pela metade).
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  DiscoverySnapshotPlan,
  DiscoverySnapshotQuery,
  DiscoverySnapshotStorePort,
  SaveSnapshotResult,
  StoredDiscoverySnapshot,
} from '../discovery-snapshots/index.js'

/** Filtro Prisma da identidade de um snapshot. */
function identityWhere(query: DiscoverySnapshotQuery) {
  return {
    listType: query.listType,
    entityType: query.entityType,
    locale: query.locale,
    country: query.country ?? null,
    window: query.window ?? null,
  }
}

/** Cria um `DiscoverySnapshotStorePort` apoiado no Prisma. */
export function createPrismaDiscoverySnapshotStore(
  prisma: PrismaClient,
): DiscoverySnapshotStorePort {
  /** Resolve tmdbId -> id interno para as entidades JA promovidas. */
  async function resolveEntityIds(
    entityType: 'movie' | 'tv',
    tmdbIds: number[],
  ): Promise<Map<number, bigint>> {
    if (tmdbIds.length === 0) return new Map()
    const rows =
      entityType === 'movie'
        ? await prisma.movie.findMany({
            where: { tmdbId: { in: tmdbIds } },
            select: { id: true, tmdbId: true },
          })
        : await prisma.tvShow.findMany({
            where: { tmdbId: { in: tmdbIds } },
            select: { id: true, tmdbId: true },
          })
    return new Map(rows.map((r: { id: bigint; tmdbId: number }) => [r.tmdbId, r.id]))
  }

  return {
    async saveSnapshot(plan: DiscoverySnapshotPlan): Promise<SaveSnapshotResult> {
      const latest = await prisma.discoverySnapshot.findFirst({
        where: identityWhere(plan),
        orderBy: { capturedAt: 'desc' },
        select: { id: true, payloadHash: true, expiresAt: true },
      })
      // Lista inalterada e ainda valida => noop (sem churn de linhas).
      if (
        latest !== null &&
        latest.payloadHash === plan.payloadHash &&
        latest.expiresAt.getTime() > plan.capturedAt.getTime()
      ) {
        return { id: latest.id.toString(), created: false, items: 0 }
      }

      const resolved = await resolveEntityIds(
        plan.entityType,
        plan.items.map((i) => i.entityTmdbId),
      )
      // So entidades promovidas entram; reindexa posicoes para ficarem densas.
      const items = plan.items
        .map((item) => ({
          entityId: resolved.get(item.entityTmdbId),
          providerScore: item.providerScore,
        }))
        .filter(
          (i): i is { entityId: bigint; providerScore: number | null } => i.entityId !== undefined,
        )
        .map((i, index) => ({
          entityId: i.entityId,
          position: index,
          providerScore: i.providerScore,
        }))

      const snapshot = await prisma.$transaction(async (tx: PrismaClient) => {
        const created = await tx.discoverySnapshot.create({
          data: {
            listType: plan.listType,
            entityType: plan.entityType,
            locale: plan.locale,
            country: plan.country,
            window: plan.window,
            capturedAt: plan.capturedAt,
            expiresAt: plan.expiresAt,
            provider: plan.provider,
            payloadHash: plan.payloadHash,
          },
          select: { id: true },
        })
        if (items.length > 0) {
          await tx.discoverySnapshotItem.createMany({
            data: items.map((i) => ({
              snapshotId: created.id,
              entityId: i.entityId,
              position: i.position,
              providerScore: i.providerScore,
            })),
          })
        }
        return created
      })

      return { id: snapshot.id.toString(), created: true, items: items.length }
    },

    async readLatestValid(
      query: DiscoverySnapshotQuery,
      now: Date,
    ): Promise<StoredDiscoverySnapshot | null> {
      const row = await prisma.discoverySnapshot.findFirst({
        where: { ...identityWhere(query), expiresAt: { gt: now } },
        orderBy: { capturedAt: 'desc' },
        select: {
          id: true,
          listType: true,
          entityType: true,
          locale: true,
          country: true,
          window: true,
          capturedAt: true,
          expiresAt: true,
          payloadHash: true,
          items: {
            orderBy: { position: 'asc' },
            select: { entityId: true, position: true, providerScore: true },
          },
        },
      })
      if (row === null) return null
      return {
        id: row.id.toString(),
        listType: row.listType,
        entityType: row.entityType,
        locale: row.locale,
        country: row.country,
        window: row.window,
        capturedAt: row.capturedAt,
        expiresAt: row.expiresAt,
        payloadHash: row.payloadHash,
        items: row.items.map(
          (i: { entityId: bigint; position: number; providerScore: unknown }) => ({
            entityId: i.entityId.toString(),
            position: i.position,
            providerScore: i.providerScore === null ? null : Number(i.providerScore),
          }),
        ),
      }
    },

    async ageSeconds(query: DiscoverySnapshotQuery, now: Date): Promise<number | null> {
      const row = await prisma.discoverySnapshot.findFirst({
        where: identityWhere(query),
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      })
      if (row === null) return null
      return Math.max(0, Math.round((now.getTime() - row.capturedAt.getTime()) / 1000))
    },
  }
}
