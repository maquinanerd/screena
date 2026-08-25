/**
 * awards-credit-lookup.ts — Resolve o CREDITO vigente da premiacao.
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * A DIFERENCA QUE IMPORTA em relacao a `rating-credit-lookup.ts`: aquele recebe
 * a fonte editorial como argumento (`imdb`, `metacritic`...), porque no dominio
 * de nota a fonte vem declarada no proprio payload (`Ratings[].Source`). No
 * campo `Awards` a OMDb **nao declara fonte nenhuma** — e por isso este lookup
 * NAO recebe fonte: ele DESCOBRE quem e a fonte perguntando a licenca vigente.
 *
 * A consequencia e deliberada: nenhuma linha de codigo deste repositorio nomeia
 * a fonte editorial do fato de premiacao. Quem a nomeia e a decisao registrada
 * em `services/legal/src/authorization-spec.ts`. Enquanto ela nao existir, o
 * lookup devolve `no-license` e a faixa nao acende — por construcao, nao por
 * disciplina de quem escreve o codigo.
 *
 * DUAS licencas vigentes = `ambiguous`, nunca "a mais recente". `ORDER BY id
 * DESC LIMIT 1` num cenario ambiguo entregaria o credito de uma fonte ao dado
 * de outra em silencio — exatamente a proveniencia falsa que a separacao por
 * fornecedor existe para impedir.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  AWARDS_DISPLAY_USE_CASE,
  AWARDS_LICENSE_CONTENT_TYPE,
  CINERIE_TERRITORY,
} from '@screena/legal'

import type { AwardsCreditPort } from '../awards/ports.js'
import type { AwardsCreditResolution } from '../awards/types.js'

interface CreditRow {
  readonly source_key: string
  readonly license_status: string
  readonly display_allowed: boolean
  readonly requires_attribution: boolean
  readonly requires_linkback: boolean
  readonly attribution_text: string | null
  readonly terms_url: string | null
  readonly usage_decision_id: bigint | null
}

/**
 * Toda licenca vigente que carrega uma decisao `awards_display` viva.
 *
 * O `INNER JOIN` implicito pela subconsulta NAO e usado: a decisao entra como
 * subconsulta correlacionada e a licenca e listada mesmo sem decisao, porque
 * "licenca existe mas a decisao venceu" e um diagnostico diferente de "nao ha
 * licenca". Quem separa os dois e `resolveAwardsDisplay`, que le
 * `usage_decision_id`.
 */
const CREDIT_SQL = `
  SELECT
    l."source_key"               AS source_key,
    l."license_status"::text     AS license_status,
    l."display_allowed"          AS display_allowed,
    l."requires_attribution"     AS requires_attribution,
    l."requires_linkback"        AS requires_linkback,
    l."attribution_text"         AS attribution_text,
    l."terms_url"                AS terms_url,
    (
      SELECT d."id"
        FROM "data_usage_decisions" d
       WHERE d."source_license_id" = l."id"
         AND d."use_case" = $1
         AND d."is_current"
         AND d."stage" = 'approved_for_display'
         AND d."display_allowed"
         AND d."valid_from" <= now()
         AND (d."valid_until" IS NULL OR d."valid_until" > now())
         AND (d."territory" IS NULL OR d."territory" = $3)
       -- Territorial (mais especifica) vence a global.
       ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
       LIMIT 1
    ) AS usage_decision_id
  FROM "source_licenses" l
  WHERE l."is_current"
    AND l."content_type" = $2::"SourceLicenseContentType"
    AND EXISTS (
      SELECT 1
        FROM "data_usage_decisions" d2
       WHERE d2."source_license_id" = l."id"
         AND d2."use_case" = $1
    )
  ORDER BY l."source_key" ASC
`

/** Cria o lookup de credito de premiacao, com cache por execucao. */
export function createPrismaAwardsCreditLookup(prisma: PrismaClient): AwardsCreditPort {
  let cached: AwardsCreditResolution | null = null

  return {
    async resolve(): Promise<AwardsCreditResolution> {
      if (cached !== null) return cached

      const rows = await prisma.$queryRawUnsafe<CreditRow[]>(
        CREDIT_SQL,
        AWARDS_DISPLAY_USE_CASE,
        AWARDS_LICENSE_CONTENT_TYPE,
        CINERIE_TERRITORY,
      )

      let resolution: AwardsCreditResolution
      if (rows.length === 0) {
        resolution = { kind: 'no-license' }
      } else if (rows.length > 1) {
        resolution = { kind: 'ambiguous', sourceKeys: rows.map((row) => row.source_key) }
      } else {
        const row = rows[0]!
        resolution = {
          kind: 'credit',
          credit: {
            sourceKey: row.source_key,
            licenseStatus: row.license_status,
            licenseDisplayAllowed: row.display_allowed === true,
            requiresAttribution: row.requires_attribution !== false,
            requiresLinkback: row.requires_linkback !== false,
            attributionText: row.attribution_text,
            // O linkback de um FATO nao e a URL de uma nota (nao existe pagina
            // por titulo): e o endereco da propria fonte, declarado na licenca
            // (`terms_url`). Nenhuma URL e fabricada a partir do titulo.
            attributionUrl: row.terms_url,
            usageDecisionId:
              row.usage_decision_id === null ? null : row.usage_decision_id.toString(),
          },
        }
      }

      cached = resolution
      return resolution
    },
  }
}
