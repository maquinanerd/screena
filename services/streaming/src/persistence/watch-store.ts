/**
 * watch-store.ts — Adapter de `watch_availability` (Prisma), governanca-compativel.
 *
 * ANTES: `DELETE` do snapshot + re-INSERT — apagava revisao, hash aprovado,
 * atribuicao e historico das ofertas que sobreviviam entre syncs. PROIBIDO.
 *
 * AGORA: RECONCILIACAO por IDENTIDADE ESTAVEL (`watch_offer_identity_key_v1`,
 * indice unico funcional). Cada oferta recebida:
 *  - INSERT novo (nasce `display_allowed=false`), OU
 *  - UPSERT na oferta existente de MESMA identidade — atualiza SO os campos de
 *    payload que o sync possui (nunca licenca/atribuicao/revisao), e REVOGA
 *    `display_allowed` quando o payload aprovado mudou (o `approved_payload_hash`
 *    deixa de bater com o fingerprint do payload). Aprovacao NUNCA e carregada
 *    para um payload diferente.
 * Ofertas que DESAPARECERAM do snapshot NAO sao apagadas: sao revogadas
 * (`display_allowed=false`) e marcadas stale — a revisao/historico permanecem.
 *
 * O escopo (entity/country/provider_api DESTE worker) e reafirmado em todo
 * WHERE; linhas de outro `provider_api` (seed demo, curadoria futura) ficam
 * intactas. `display_allowed` nunca e ligado aqui (invariante 6 + trigger
 * permanente `watch_availability_display_guard`).
 */

import type { PrismaClient } from '@screena/db/server'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import type { WatchReplaceOutcome, WatchStorePort } from '../ports.js'

/** Cria um `WatchStorePort` com reconciliacao por identidade estavel. */
export function createPrismaWatchStore(prisma: PrismaClient): WatchStorePort {
  return {
    async replaceSnapshot(input): Promise<WatchReplaceOutcome> {
      const entityId = BigInt(input.entityId)

      return prisma.$transaction(async (tx) => {
        let created = 0
        for (const offer of input.offers) {
          // UPSERT por IDENTIDADE. Em conflito, atualiza SO payload do sync e
          // revoga display se o payload aprovado mudou (compara hash aprovado ao
          // fingerprint dos novos campos de sync + campos de licenca EXISTENTES).
          const affected = await tx.$executeRaw`
            INSERT INTO "watch_availability" (
              "entity_type", "entity_id", "country_code", "provider_key", "provider_name",
              "external_offer_id", "package", "offer_type", "deep_link", "web_url", "price", "currency", "quality",
              "available_from", "available_until", "fetched_at", "stale_after",
              "provider_api", "display_allowed", "updated_at"
            ) VALUES (
              ${offer.entityType}::"EntityType", ${entityId}, ${offer.countryCode},
              ${offer.providerKey}, ${offer.providerName}, ${offer.externalOfferId}, ${offer.package}, ${offer.offerType}::"OfferType",
              ${offer.deepLink}, ${offer.webUrl}, ${offer.price}, ${offer.currency}, ${offer.quality},
              ${offer.availableFrom}, ${offer.availableUntil}, ${input.fetchedAt}, ${input.staleAfter},
              ${STREAMING_AVAILABILITY_PROVIDER_API}, false, now()
            )
            ON CONFLICT (watch_offer_identity_key_v1(
              "provider_api", "external_offer_id", "entity_type", "entity_id", "country_code",
              "offer_type", "provider_key", "provider_name", "package"))
            DO UPDATE SET
              "provider_name" = EXCLUDED."provider_name",
              "external_offer_id" = EXCLUDED."external_offer_id",
              "package" = EXCLUDED."package",
              "deep_link" = EXCLUDED."deep_link",
              "web_url" = EXCLUDED."web_url",
              "price" = EXCLUDED."price",
              "currency" = EXCLUDED."currency",
              "quality" = EXCLUDED."quality",
              "available_from" = EXCLUDED."available_from",
              "available_until" = EXCLUDED."available_until",
              "fetched_at" = EXCLUDED."fetched_at",
              "stale_after" = EXCLUDED."stale_after",
              "updated_at" = now(),
              "display_allowed" = (
                "watch_availability"."display_allowed"
                AND "watch_availability"."approved_payload_hash" IS NOT DISTINCT FROM watch_offer_payload_fingerprint_v1(
                  EXCLUDED."provider_api", EXCLUDED."external_offer_id", EXCLUDED."entity_type",
                  EXCLUDED."entity_id", EXCLUDED."country_code", EXCLUDED."offer_type",
                  EXCLUDED."provider_key", EXCLUDED."provider_name", EXCLUDED."package",
                  EXCLUDED."quality", EXCLUDED."price", EXCLUDED."currency", EXCLUDED."deep_link",
                  "watch_availability"."web_url", EXCLUDED."available_from", EXCLUDED."available_until",
                  "watch_availability"."license_status", "watch_availability"."requires_attribution",
                  "watch_availability"."requires_linkback", "watch_availability"."attribution_text",
                  "watch_availability"."attribution_url"))
          `
          created += Number(affected)
        }

        // Ofertas que sumiram do snapshot: revogadas + marcadas stale, NUNCA
        // apagadas (revisao/historico preservados). Detectadas pelo fetched_at
        // deste run.
        const disappeared = await tx.$executeRaw`
          UPDATE "watch_availability"
          SET "display_allowed" = false, "stale_after" = now(), "updated_at" = now()
          WHERE "entity_type" = ${input.entityType}::"EntityType"
            AND "entity_id" = ${entityId}
            AND "country_code" = ${input.countryCode}
            AND "provider_api" = ${STREAMING_AVAILABILITY_PROVIDER_API}
            AND ("fetched_at" IS NULL OR "fetched_at" <> ${input.fetchedAt})
        `

        return { deleted: Number(disappeared), created }
      })
    },
  }
}
