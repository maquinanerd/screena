/**
 * rating-credit-lookup.ts — Resolve o CREDITO vigente de uma fonte editorial.
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * Le `source_licenses` (a licenca que o proprietario autorizou em
 * `services/legal/src/authorization-spec.ts`) e anexa a decisao de uso vigente
 * de `rating_display`. NAO decide nada: a decisao e de `resolveDisplayAllowed`
 * (`@screena/schemas`), e a trava final e o trigger do banco.
 *
 * Por que a licenca NAO e pre-filtrada por `display_allowed`/`score_allowed`:
 * filtrar ali devolveria "nenhuma licenca" para uma licenca que existe mas
 * proibe exibir — e o operador leria `no-license` ("cadastre a licenca") quando
 * o certo e `license-forbids-display` ("a licenca existe e diz nao"). O
 * diagnostico correto vale mais que uma linha a menos de SQL.
 *
 * Cache por execucao: sao ~5 fontes editoriais para milhares de notas. Sem
 * cache, o sync faria uma consulta de licenca por nota. O cache vive apenas
 * enquanto o objeto existir (uma execucao do worker) — nunca atravessa runs,
 * entao uma licenca revogada entre execucoes e vista na proxima.
 */

import type { PrismaClient } from '@screena/db/server'
import type { SourceCredit } from '@screena/schemas'

/**
 * Territorio de exibicao do produto (pt-BR/Brasil). Mesmo valor de
 * `RATING_DISPLAY_TERRITORY` no review store: uma decisao escopada a OUTRO
 * territorio nao autoriza exibicao aqui.
 */
export const RATING_DISPLAY_TERRITORY = 'BR'

/** Linha crua projetada do SQL. */
interface CreditRow {
  readonly license_status: string
  readonly display_allowed: boolean
  readonly score_allowed: boolean
  readonly requires_attribution: boolean
  readonly requires_linkback: boolean
  readonly attribution_text: string | null
  readonly usage_decision_id: bigint | null
}

/**
 * Credito de licenca SEM o linkback. O `attribution_url` nao vem da licenca
 * (`source_licenses` nao tem essa coluna): o linkback de uma nota e a URL
 * canonica DAQUELA nota na fonte (`external_ratings.rating_url`). Quem monta o
 * `SourceCredit` completo e o chamador, que tem a linha na mao.
 */
export type LicenseCredit = Omit<SourceCredit, 'attributionUrl'>

/** Porta de consulta de credito por fonte editorial. */
export interface RatingCreditLookup {
  /** `null` quando nao ha licenca vigente de rating para a fonte. */
  find(ratingSource: string): Promise<LicenseCredit | null>
}

const CREDIT_SQL = `
  SELECT
    l."license_status"::text     AS license_status,
    l."display_allowed"          AS display_allowed,
    l."score_allowed"            AS score_allowed,
    l."requires_attribution"     AS requires_attribution,
    l."requires_linkback"        AS requires_linkback,
    l."attribution_text"         AS attribution_text,
    (
      SELECT d."id"
        FROM "data_usage_decisions" d
       WHERE d."source_license_id" = l."id"
         AND d."use_case" = 'rating_display'
         AND d."is_current"
         AND d."stage" = 'approved_for_display'
         AND d."display_allowed"
         AND d."valid_from" <= now()
         AND (d."valid_until" IS NULL OR d."valid_until" > now())
         AND (d."territory" IS NULL OR d."territory" = $2)
       -- Territorial (mais especifica) vence a global.
       ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
       LIMIT 1
    ) AS usage_decision_id
  FROM "source_licenses" l
  WHERE l."is_current"
    AND l."content_type" = 'rating'
    AND l."rating_source_key" = $1
  ORDER BY l."id" DESC
  LIMIT 1
`

/** Cria o lookup de credito com cache por execucao. */
export function createPrismaRatingCreditLookup(prisma: PrismaClient): RatingCreditLookup {
  const cache = new Map<string, LicenseCredit | null>()

  return {
    async find(ratingSource: string): Promise<LicenseCredit | null> {
      // `has`, nao `get() !== undefined`: `null` (fonte sem licenca) e um
      // resultado LEGITIMO e precisa ser cacheado tambem, senao toda nota de
      // uma fonte sem licenca reconsulta o banco.
      if (cache.has(ratingSource)) return cache.get(ratingSource) ?? null

      const rows = await prisma.$queryRawUnsafe<CreditRow[]>(
        CREDIT_SQL,
        ratingSource,
        RATING_DISPLAY_TERRITORY,
      )
      const row = rows[0]
      const credit: LicenseCredit | null =
        row === undefined
          ? null
          : {
              licenseStatus: row.license_status,
              licenseDisplayAllowed: row.display_allowed,
              licenseScoreAllowed: row.score_allowed,
              requiresAttribution: row.requires_attribution,
              requiresLinkback: row.requires_linkback,
              attributionText: row.attribution_text,
              usageDecisionId:
                row.usage_decision_id === null ? null : row.usage_decision_id.toString(),
            }

      cache.set(ratingSource, credit)
      return credit
    },
  }
}
