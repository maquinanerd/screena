/**
 * watch-review-store.ts — Adapter Prisma da revisao/promocao. incluido no typecheck (2026-07).
 *
 * So LE e ATUALIZA `watch_availability`. Nunca cria linha, nunca toca outra
 * tabela alem de resolver o TITULO da entidade (movies.title_original /
 * tv_shows.name_original) para o relatorio.
 *
 * DEFESA EM PROFUNDIDADE nos updates:
 *  - `promote`: exige `reviewer` humano; grava, atomicamente, display_allowed +
 *    reviewed_at + reviewed_by + approved_payload_hash (= fingerprint atual do
 *    payload). O trigger permanente do banco valida hash/licenca/atribuicao —
 *    oferta incompleta fica fail-closed (nao promove). WHERE reafirma
 *    `provider_api = streaming_availability`, `country_code = BR`,
 *    `display_allowed = false`; um id por statement (falha isolada).
 *  - `revoke`: WHERE reafirma `provider_api = streaming_availability` e
 *    `display_allowed = true`.
 * NUNCA toca rating/screen_score/external_ratings.
 */

import type { PrismaClient } from '@screena/db/server'

import { PROMOTION_PROVIDER_APIS } from '../promotion/guardrails.js'

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
  // Destino do agregador (unico que a origem TMDB tem) e o credito ja hidratado:
  // os guardrails passaram a decidir com os dois, entao a projecao precisa
  // trazer os dois. Sem eles, `missing-link`/`missing-attribution` julgariam
  // `undefined` e recusariam oferta boa.
  webUrl: true,
  price: true,
  currency: true,
  quality: true,
  availableUntil: true,
  fetchedAt: true,
  displayAllowed: true,
  requiresAttribution: true,
  requiresLinkback: true,
  attributionText: true,
  attributionUrl: true,
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
  readonly webUrl: string | null
  readonly price: unknown
  readonly currency: string | null
  readonly quality: string | null
  readonly availableUntil: Date | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
  readonly requiresAttribution: boolean
  readonly requiresLinkback: boolean
  readonly attributionText: string | null
  readonly attributionUrl: string | null
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
    webUrl: row.webUrl,
    price: toNumber(row.price),
    currency: row.currency,
    quality: row.quality,
    availableUntil: row.availableUntil,
    fetchedAt: row.fetchedAt,
    displayAllowed: row.displayAllowed,
    requiresAttribution: row.requiresAttribution,
    requiresLinkback: row.requiresLinkback,
    attributionText: row.attributionText,
    attributionUrl: row.attributionUrl,
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
        // A listagem NUNCA traz fornecedor NAO GOVERNADO nem outro pais.
        providerApi: { in: [...query.providerApis] },
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

    async promote(ids: readonly string[], reviewer: string): Promise<StoreMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      const who = reviewer.trim()
      if (who === '') {
        // Promocao SEM revisor humano identificado falha EXPLICITAMENTE.
        throw new Error('promote: revisor humano obrigatorio (reviewed_by)')
      }
      let updated = 0
      const refusals: { id: string; message: string }[] = []
      // Um id por statement: se o trigger permanente de governanca rejeitar uma
      // oferta incompleta (sem licenca/atribuicao/hash valido), SO aquele id
      // falha — fail-closed —, os demais seguem. A promocao grava, atomicamente,
      // approved_payload_hash = fingerprint atual do payload + reviewed_at +
      // reviewed_by; o trigger valida licenca/atribuicao/linkback.
      //
      // Backend B: o mesmo UPDATE resolve os dois elos novos, em SQL, para que
      // nao exista janela entre "resolver" e "promover":
      //  - `watch_provider_id` sai do ALIAS (provider_api, provider_key). Nao ha
      //    fallback por nome: se o alias nao existe, o campo fica NULL e o
      //    trigger recusa a promocao. Adivinhar o provedor pelo nome exibido e
      //    exatamente o erro que a tabela de aliases existe para impedir.
      //  - `data_usage_decision_id` sai da decisao VIGENTE para o uso, e so
      //    aceita decisao cuja licenca seja a DAQUELE provedor canonico
      //    (source_key = slug) e cujo territorio cubra o pais da oferta.
      //    Decisao territorial vence a global (ORDER BY territory NOT NULL DESC).
      for (const id of ids) {
        try {
          const affected = await prisma.$executeRaw`
            UPDATE "watch_availability" w
            SET "display_allowed" = true,
                "reviewed_at" = now(),
                "reviewed_by" = ${who},
                "watch_provider_id" = (
                  SELECT a."provider_id"
                    FROM "watch_provider_aliases" a
                   WHERE a."provider_api" = w."provider_api"
                     AND a."external_key" = w."provider_key"
                ),
                "data_usage_decision_id" = (
                  SELECT d."id"
                    FROM "data_usage_decisions" d
                    JOIN "source_licenses" l ON l."id" = d."source_license_id"
                    JOIN "watch_provider_aliases" a
                      ON a."provider_api" = w."provider_api" AND a."external_key" = w."provider_key"
                    JOIN "watch_providers" p ON p."id" = a."provider_id"
                   WHERE d."use_case" = 'watch_offer_display'
                     AND d."is_current"
                     AND d."stage" = 'approved_for_display'
                     AND d."display_allowed"
                     AND d."valid_from" <= now()
                     AND (d."valid_until" IS NULL OR d."valid_until" > now())
                     AND (d."territory" IS NULL OR d."territory" = w."country_code")
                     AND l."is_current"
                     AND l."content_type" = 'watch_availability'
                     AND l."source_key" = p."slug"
                     -- PROVENIENCIA: existe UMA licenca de watch_availability por
                     -- FORNECEDOR TECNICO (Movie of the Night para
                     -- streaming_availability, JustWatch para tmdb). Sem este
                     -- filtro o ORDER BY abaixo escolheria a decisao mais recente
                     -- entre as DUAS, e a oferta seria promovida sob a licenca da
                     -- outra origem — creditando a fonte errada em silencio.
                     -- Ver services/legal/src/authorization-spec.ts.
                     AND l."provider_key" = w."provider_api"
                     AND l."display_allowed"
                     AND l."license_status" IN ('official', 'licensed', 'third_party')
                   ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
                   LIMIT 1
                ),
                "approved_payload_hash" = watch_offer_payload_fingerprint_v1(
                  w."provider_api", w."external_offer_id", w."entity_type", w."entity_id", w."country_code",
                  w."offer_type", w."provider_key", w."provider_name", w."package", w."quality", w."price",
                  w."currency", w."deep_link", w."web_url", w."available_from", w."available_until",
                  w."license_status", w."requires_attribution", w."requires_linkback",
                  w."attribution_text", w."attribution_url"),
                "updated_at" = now()
            WHERE w."id" = ${BigInt(id)}
              AND w."provider_api" = ANY(${[...PROMOTION_PROVIDER_APIS]})
              AND w."country_code" = 'BR'
              AND w."display_allowed" = false
          `
          updated += Number(affected)
        } catch (error) {
          // Trigger rejeitou (governanca incompleta): fail-closed, NAO promove.
          //
          // O `catch` vazio anterior tornava esta a unica falha muda do caminho:
          // o operador via "0 promovidas" sem uma linha sequer dizendo por que, e
          // a causa mais comum (falta de licenca/atribuicao para aquela origem)
          // era exatamente a que ele precisava ler. Agora a recusa e NOMEADA e
          // devolvida ao chamador, que a imprime no relatorio.
          refusals.push({
            id,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return { updated, refusals }
    },

    async revoke(ids: readonly string[]): Promise<StoreMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      const result = await prisma.watchAvailability.updateMany({
        where: {
          id: { in: ids.map((id) => BigInt(id)) },
          providerApi: { in: [...PROMOTION_PROVIDER_APIS] },
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
