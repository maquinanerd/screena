/**
 * watch-providers-store.ts — Adapters Prisma do reprocessamento de
 * `watch/providers` (leitura do bruto, resolucao de entidade, escrita da oferta).
 *
 * EXCLUIDO DO TYPECHECK padrao (toca Prisma); coberto por
 * `tsconfig.runtime.json`, que inclui `services/ingestion/src/persistence/**`.
 *
 * A escrita ESPELHA `services/streaming/src/persistence/watch-store.ts`, e a
 * semelhanca e proposital: aquele adapter ja resolveu, com custo, o problema de
 * reconciliar oferta sem apagar revisao/atribuicao/historico. As unicas
 * diferencas sao o `provider_api` (`tmdb`, nao a API de streaming) e o fato de
 * o TMDB nao publicar preco, qualidade nem validade — esses campos ficam NULL,
 * nunca inventados.
 *
 * GOVERNANCA (invariante 6): toda linha nasce `display_allowed = false`. Este
 * adapter NUNCA liga exibicao e NUNCA escreve licenca, atribuicao ou revisao.
 * Acender a exibicao e decisao humana, por outro caminho.
 *
 * `watch_provider_id` sai do ALIAS (`watch_provider_aliases`), nunca adivinhado
 * pelo nome exibido. Sem alias para `(provider_api='tmdb', external_key=<id>)`
 * ele fica NULL: a oferta e ingerida e auditavel, e o trigger de governanca a
 * mantem invisivel. Semear esses aliases e uma decisao de dados separada — o
 * relatorio do CLI lista os provedores vistos exatamente para embasa-la.
 */

import type { PrismaClient } from '@screena/db/server'
import { TMDB_PROVIDER_API } from '@screena/tmdb-client'

import type {
  RawWatchSource,
  RawWatchSourceRow,
  ResolvedWatchEntity,
  WatchEntityResolver,
  WatchOfferStore,
  WatchProvidersEntityType,
  WatchSnapshotOutcome,
} from '../watch-providers/types.js'

/** `entityType` do reprocessamento -> `TmdbEntityKind` de `tmdb_raw`. */
const RAW_KIND_BY_ENTITY: Readonly<Record<WatchProvidersEntityType, 'movie' | 'tv'>> = {
  movie: 'movie',
  tv: 'tv',
}

/** Le o bruto ja arquivado. ZERO chamada ao TMDB. */
export function createPrismaRawWatchSource(prisma: PrismaClient): RawWatchSource {
  return {
    async count(entityType): Promise<number> {
      return prisma.tmdbRaw.count({ where: { entityType: RAW_KIND_BY_ENTITY[entityType] } })
    },
    async list(entityType, limit): Promise<readonly RawWatchSourceRow[]> {
      const rows = await prisma.tmdbRaw.findMany({
        where: { entityType: RAW_KIND_BY_ENTITY[entityType] },
        // Ordem estavel para que o `--limit` seja retomavel e reproduzivel.
        orderBy: { tmdbId: 'asc' },
        take: limit,
        select: { tmdbId: true, baseLanguage: true, payload: true },
      })
      return rows.map((row) => ({
        tmdbId: row.tmdbId,
        baseLanguage: row.baseLanguage,
        payload: row.payload,
      }))
    },
  }
}

/** Resolve tmdbId -> id interno. Entidade nao promovida simplesmente nao volta. */
export function createPrismaWatchEntityResolver(prisma: PrismaClient): WatchEntityResolver {
  return {
    async resolve(entityType, tmdbIds): Promise<readonly ResolvedWatchEntity[]> {
      if (tmdbIds.length === 0) return []
      const ids = [...new Set(tmdbIds)]
      if (entityType === 'movie') {
        const rows = await prisma.movie.findMany({
          where: { tmdbId: { in: ids } },
          select: { id: true, tmdbId: true },
        })
        return rows.map((row) => ({ tmdbId: row.tmdbId, entityId: row.id.toString() }))
      }
      const rows = await prisma.tvShow.findMany({
        where: { tmdbId: { in: ids } },
        select: { id: true, tmdbId: true },
      })
      return rows.map((row) => ({ tmdbId: row.tmdbId, entityId: row.id.toString() }))
    },
  }
}

/**
 * Escreve o snapshot de ofertas de (entidade, pais) para `provider_api='tmdb'`.
 *
 * Escopo reafirmado em TODO `WHERE`: linhas de outro `provider_api` (RapidAPI,
 * seed demo, curadoria) ficam intactas.
 */
export function createPrismaTmdbWatchOfferStore(prisma: PrismaClient): WatchOfferStore {
  return {
    async replaceSnapshot(input): Promise<WatchSnapshotOutcome> {
      const entityId = BigInt(input.entityId)

      return prisma.$transaction(async (tx) => {
        let upserted = 0
        for (const offer of input.offers) {
          const affected = await tx.$executeRaw`
            INSERT INTO "watch_availability" (
              "entity_type", "entity_id", "country_code", "provider_key", "provider_name",
              "external_offer_id", "package", "offer_type", "deep_link", "web_url",
              "price", "currency", "quality", "available_from", "available_until",
              "fetched_at", "stale_after", "provider_api", "display_allowed", "updated_at",
              "watch_provider_id"
            ) VALUES (
              ${offer.entityType}::"EntityType", ${entityId}, ${offer.countryCode},
              ${offer.providerKey}, ${offer.providerName},
              -- O TMDB nao publica id de oferta, pacote, preco, moeda, qualidade
              -- nem validade. NULL e a verdade; inventar seria pior que omitir.
              NULL, NULL, ${offer.offerType}::"OfferType",
              -- Sem deep link por oferta: o TMDB publica um link por PAIS, que
              -- vai em web_url. Derivar um deep link dele afirmaria um destino
              -- que o upstream nunca prometeu.
              NULL, ${offer.webUrl},
              NULL, NULL, NULL, NULL, NULL,
              ${input.fetchedAt}, ${input.staleAfter}, ${TMDB_PROVIDER_API}, false, now(),
              (SELECT a."provider_id" FROM "watch_provider_aliases" a
                 WHERE a."provider_api" = ${TMDB_PROVIDER_API}
                   AND a."external_key" = ${offer.providerKey})
            )
            ON CONFLICT (watch_offer_identity_key_v1(
              "provider_api", "external_offer_id", "entity_type", "entity_id", "country_code",
              "offer_type", "provider_key", "provider_name", "package"))
            DO UPDATE SET
              "provider_name" = EXCLUDED."provider_name",
              "web_url" = EXCLUDED."web_url",
              "fetched_at" = EXCLUDED."fetched_at",
              "stale_after" = EXCLUDED."stale_after",
              "watch_provider_id" = EXCLUDED."watch_provider_id",
              "updated_at" = now(),
              -- Aprovacao NUNCA e carregada para um payload diferente: se o
              -- fingerprint dos campos novos deixar de bater com o hash
              -- aprovado, a exibicao e REVOGADA nesta linha. Sem esta clausula o
              -- trigger derrubaria o sync inteiro com excecao em vez de revogar
              -- so a oferta afetada.
              "display_allowed" = (
                "watch_availability"."display_allowed"
                AND EXCLUDED."watch_provider_id" IS NOT NULL
                AND "watch_availability"."approved_payload_hash" IS NOT DISTINCT FROM watch_offer_payload_fingerprint_v1(
                  EXCLUDED."provider_api", EXCLUDED."external_offer_id", EXCLUDED."entity_type",
                  EXCLUDED."entity_id", EXCLUDED."country_code", EXCLUDED."offer_type",
                  EXCLUDED."provider_key", EXCLUDED."provider_name", EXCLUDED."package",
                  EXCLUDED."quality", EXCLUDED."price", EXCLUDED."currency", EXCLUDED."deep_link",
                  EXCLUDED."web_url", EXCLUDED."available_from", EXCLUDED."available_until",
                  "watch_availability"."license_status", "watch_availability"."requires_attribution",
                  "watch_availability"."requires_linkback", "watch_availability"."attribution_text",
                  "watch_availability"."attribution_url"))
          `
          upserted += Number(affected)
        }

        // Oferta que sumiu do snapshot: REVOGADA e marcada stale, nunca apagada
        // (revisao e historico preservados). Detectada pelo fetched_at do run.
        const revoked = await tx.$executeRaw`
          UPDATE "watch_availability"
          SET "display_allowed" = false, "stale_after" = now(), "updated_at" = now()
          WHERE "entity_type" = ${input.entityType}::"EntityType"
            AND "entity_id" = ${entityId}
            AND "country_code" = ${input.countryCode}
            AND "provider_api" = ${TMDB_PROVIDER_API}
            AND ("fetched_at" IS NULL OR "fetched_at" <> ${input.fetchedAt})
        `

        return { upserted, revoked: Number(revoked) }
      })
    },
  }
}
