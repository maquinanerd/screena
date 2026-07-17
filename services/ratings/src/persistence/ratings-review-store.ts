/**
 * ratings-review-store.ts — Adapter Prisma da revisao/promocao de ratings.
 *
 * Espelha `services/streaming/src/persistence/watch-review-store.ts`: mesma
 * disciplina, mesmo formato de porta. So LE e ATUALIZA `external_ratings` —
 * nunca cria linha, nunca altera o VALOR de uma nota, nunca inventa licenca.
 *
 * DEFESA EM PROFUNDIDADE:
 *  - `promote` exige revisor humano; grava atomicamente display_allowed +
 *    reviewed_at + reviewed_by + data_usage_decision_id + approved_payload_hash
 *    (= fingerprint atual, computado NO BANCO). O trigger valida tudo de novo —
 *    nota incompleta simplesmente nao promove (fail-closed), uma por statement.
 *  - `revoke` reafirma `display_allowed = true` no WHERE.
 * NUNCA toca watch_availability/screen_score/cinerie_score.
 */

import type { PrismaClient } from '@screena/db/server'

import type { RatingPromotionCandidate } from '../promotion/types.js'

/** Filtro da listagem de candidatas. */
export interface RatingsReviewQuery {
  readonly ratingSource: string | null
  readonly entityType: string | null
  readonly limit: number
}

/** Resultado de uma mutacao. */
export interface RatingsMutationOutcome {
  readonly updated: number
}

/** Porta de revisao/promocao de ratings. */
export interface RatingsReviewStorePort {
  listCandidates(query: RatingsReviewQuery): Promise<readonly RatingPromotionCandidate[]>
  findByIds(ids: readonly string[]): Promise<readonly RatingPromotionCandidate[]>
  promote(ids: readonly string[], reviewer: string): Promise<RatingsMutationOutcome>
  revoke(ids: readonly string[]): Promise<RatingsMutationOutcome>
}

/** Linha crua projetada do SQL. */
interface RawRow {
  readonly id: bigint
  readonly entity_type: string
  readonly entity_id: bigint
  readonly rating_source: string
  readonly rating_label: string
  readonly metric: string
  readonly score_type: string | null
  readonly rating_value: unknown
  readonly rating_scale: number
  readonly rating_count: number | null
  readonly rating_url: string | null
  readonly provider_api: string | null
  readonly license_status: string
  readonly requires_attribution: boolean
  readonly requires_linkback: boolean
  readonly attribution_text: string | null
  readonly attribution_url: string | null
  readonly fetched_at: Date | null
  readonly display_allowed: boolean
  readonly usage_decision_id: bigint | null
  readonly title: string | null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toCandidate(row: RawRow): RatingPromotionCandidate {
  return {
    id: row.id.toString(),
    entityType: row.entity_type,
    entityId: row.entity_id.toString(),
    title: row.title,
    ratingSource: row.rating_source,
    ratingLabel: row.rating_label,
    metric: row.metric,
    scoreType: row.score_type as RatingPromotionCandidate['scoreType'],
    ratingValue: toNumber(row.rating_value),
    ratingScale: row.rating_scale,
    ratingCount: row.rating_count,
    ratingUrl: row.rating_url,
    providerApi: row.provider_api,
    licenseStatus: row.license_status,
    requiresAttribution: row.requires_attribution,
    requiresLinkback: row.requires_linkback,
    attributionText: row.attribution_text,
    attributionUrl: row.attribution_url,
    fetchedAt: row.fetched_at,
    displayAllowed: row.display_allowed,
    usageDecisionId: row.usage_decision_id === null ? null : row.usage_decision_id.toString(),
  }
}

/**
 * Territorio de exibicao do produto. O site publica pt-BR/Brasil (mesmo padrao
 * do WATCH_COUNTRY do read path de streaming). Uma decisao de rating_display
 * escopada a OUTRO territorio (ex.: US-only) nao autoriza exibicao aqui —
 * sem este filtro, a subquery PREFERIA a decisao territorial de qualquer
 * territorio e uma licenca US-only vazaria para o site BR (revisao adversarial
 * da PR #74, achado A2).
 */
export const RATING_DISPLAY_TERRITORY = 'BR'

/**
 * Subquery da decisao VIGENTE de `rating_display` para a fonte da nota.
 *
 * A decisao tem de pertencer a licenca DAQUELA fonte editorial: sem o
 * `l.rating_source_key = r.rating_source`, uma decisao aprovada para o
 * Metacritic autorizaria exibir IMDb. So valem decisoes globais (territory
 * NULL) ou do territorio de exibicao; entre as duas, a territorial (mais
 * especifica) vence. A licenca-mae precisa estar vigente E permitir
 * display+score — o guard do banco reconfere, mas filtrar aqui evita anexar
 * uma decisao que o guard rejeitaria (diagnostico correto no dry-run).
 */
const CURRENT_DECISION_SQL = `(
  SELECT d."id"
    FROM "data_usage_decisions" d
    JOIN "source_licenses" l ON l."id" = d."source_license_id"
   WHERE d."use_case" = 'rating_display'
     AND d."is_current"
     AND d."stage" = 'approved_for_display'
     AND d."display_allowed"
     AND d."valid_from" <= now()
     AND (d."valid_until" IS NULL OR d."valid_until" > now())
     AND (d."territory" IS NULL OR d."territory" = '${RATING_DISPLAY_TERRITORY}')
     AND l."is_current"
     AND l."content_type" = 'rating'
     AND l."rating_source_key" = r."rating_source"
     AND l."display_allowed"
     AND l."score_allowed"
     AND l."license_status" IN ('official', 'licensed', 'third_party')
   ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
   LIMIT 1
)`

/**
 * Titulo da entidade (best-effort). Filme usa `title_original`; serie,
 * `name_original`. Titulo e enfeite do relatorio: a decisao nao depende dele.
 */
const TITLE_SQL = `(
  CASE r."entity_type"
    WHEN 'movie' THEN (SELECT m."title_original" FROM "movies" m WHERE m."id" = r."entity_id")
    WHEN 'tv' THEN (SELECT t."name_original" FROM "tv_shows" t WHERE t."id" = r."entity_id")
    ELSE NULL
  END
)`

const SELECT_COLUMNS = `
  r."id", r."entity_type", r."entity_id", r."rating_source", r."rating_label", r."metric",
  r."score_type"::text AS score_type, r."rating_value", r."rating_scale", r."rating_count",
  r."rating_url", r."provider_api", r."license_status"::text AS license_status,
  r."requires_attribution", r."requires_linkback", r."attribution_text", r."attribution_url",
  r."fetched_at", r."display_allowed",
  ${CURRENT_DECISION_SQL} AS usage_decision_id,
  ${TITLE_SQL} AS title
`

/** Cria a porta de revisao/promocao sobre `external_ratings`. */
export function createPrismaRatingsReviewStore(prisma: PrismaClient): RatingsReviewStorePort {
  return {
    async listCandidates(query: RatingsReviewQuery): Promise<readonly RatingPromotionCandidate[]> {
      const conditions: string[] = []
      const params: unknown[] = []
      if (query.ratingSource !== null) {
        params.push(query.ratingSource)
        conditions.push(`r."rating_source" = $${params.length}`)
      }
      if (query.entityType !== null) {
        params.push(query.entityType)
        conditions.push(`r."entity_type" = $${params.length}::"EntityType"`)
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
      params.push(query.limit)

      const rows = await prisma.$queryRawUnsafe<RawRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM "external_ratings" r ${where} ORDER BY r."id" ASC LIMIT $${params.length}`,
        ...params,
      )
      return rows.map(toCandidate)
    },

    async findByIds(ids: readonly string[]): Promise<readonly RatingPromotionCandidate[]> {
      if (ids.length === 0) return []
      // Sem filtro de fonte/estado aqui de proposito: trazemos a linha pedida
      // para que o guardrail EXPLIQUE por que a recusa. O update e que reafirma
      // o escopo.
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
      const rows = await prisma.$queryRawUnsafe<RawRow[]>(
        `SELECT ${SELECT_COLUMNS} FROM "external_ratings" r WHERE r."id" IN (${placeholders}) ORDER BY r."id" ASC`,
        ...ids.map((id) => BigInt(id)),
      )
      return rows.map(toCandidate)
    },

    async promote(ids: readonly string[], reviewer: string): Promise<RatingsMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      const who = reviewer.trim()
      if (who === '') {
        throw new Error('promote: revisor humano obrigatorio (reviewed_by)')
      }

      let updated = 0
      // Um id por statement: se o trigger rejeitar uma nota incompleta, SO
      // aquele id falha — os demais seguem. O fingerprint e computado NO BANCO
      // (nunca reimplementado em TS: divergencia entre as duas implementacoes
      // seria uma aprovacao que nao corresponde ao dado).
      for (const id of ids) {
        try {
          const affected = await prisma.$executeRawUnsafe(
            `UPDATE "external_ratings" r
                SET "display_allowed" = true,
                    "reviewed_at" = now(),
                    "reviewed_by" = $1,
                    "data_usage_decision_id" = ${CURRENT_DECISION_SQL},
                    "approved_payload_hash" = external_rating_payload_fingerprint_v1(
                      r."entity_type", r."entity_id", r."rating_source", r."metric",
                      r."score_type", r."rating_label", r."rating_value", r."rating_scale",
                      r."rating_count", r."rating_url", r."provider_api", r."license_status",
                      r."requires_attribution", r."requires_linkback",
                      r."attribution_text", r."attribution_url"),
                    "updated_at" = now()
              WHERE r."id" = $2
                AND r."display_allowed" = false`,
            who,
            BigInt(id),
          )
          updated += Number(affected)
        } catch {
          // Trigger rejeitou (governanca incompleta): fail-closed, nao promove.
        }
      }
      return { updated }
    },

    async revoke(ids: readonly string[]): Promise<RatingsMutationOutcome> {
      if (ids.length === 0) return { updated: 0 }
      // Revogar limpa a aprovacao inteira: manter hash/revisor de uma exibicao
      // revogada deixaria um "aprovado por" pendurado numa nota que ninguem
      // aprova mais. `display_allowed=false` faz o trigger nem checar.
      const result = await prisma.externalRating.updateMany({
        where: { id: { in: ids.map((id) => BigInt(id)) }, displayAllowed: true },
        data: {
          displayAllowed: false,
          approvedPayloadHash: null,
          reviewedAt: null,
          reviewedBy: null,
          dataUsageDecisionId: null,
        },
      })
      return { updated: result.count }
    },
  }
}
