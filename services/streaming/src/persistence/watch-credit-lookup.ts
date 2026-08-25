/**
 * watch-credit-lookup.ts — Resolve o CREDITO vigente de uma oferta de streaming.
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * Espelha `services/ratings/src/persistence/rating-credit-lookup.ts`, com UMA
 * diferenca estrutural que nao existe em ratings: a licenca de streaming nao e
 * por fonte editorial, e sim por PROVEDOR CANONICO (`watch_providers`). A cadeia
 * inteira e:
 *
 *   provider_key do upstream
 *     -> `watch_provider_aliases` (provider_api, external_key)   [1]
 *     -> `watch_providers`.slug                                   [2]
 *     -> `source_licenses` (content_type='watch_availability',
 *         source_key = slug)                                      [3]
 *     -> `data_usage_decisions` (use_case='watch_offer_display')  [4]
 *
 * Qualquer elo faltando e uma recusa DIFERENTE, e o operador precisa saber qual:
 * "cadastre o alias" nao e a mesma acao que "cadastre a licenca". Por isso o
 * retorno distingue `no-alias` de `no-license` em vez de devolver um `null`
 * mudo — mesmo motivo pelo qual o lookup de ratings nao pre-filtra a licenca por
 * `display_allowed`.
 *
 * NAO decide nada: a decisao e de `resolveDisplayAllowed` (`@screena/schemas`) e
 * a trava final e o trigger `watch_availability_display_guard`.
 *
 * Cache por execucao: sao poucos provedores canonicos para muitas ofertas. O
 * cache vive so enquanto o objeto existir (uma execucao do worker) — uma licenca
 * revogada entre execucoes e vista na proxima.
 */

import type { PrismaClient } from '@screena/db/server'
import type { SourceCredit } from '@screena/schemas'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

/** Linha crua projetada do SQL. */
interface CreditRow {
  readonly watch_provider_id: bigint
  readonly license_status: string | null
  readonly display_allowed: boolean | null
  readonly score_allowed: boolean | null
  readonly requires_attribution: boolean | null
  readonly requires_linkback: boolean | null
  readonly attribution_text: string | null
  readonly usage_decision_id: bigint | null
}

/**
 * Credito de licenca SEM o linkback. `attribution_url` nao vem de
 * `source_licenses` (a tabela nao tem essa coluna): o linkback de uma oferta e o
 * link exigido pelos termos do AGREGADOR, declarado em
 * `@screena/streaming-availability-client`. Quem monta o `SourceCredit` completo
 * e o chamador.
 */
export type WatchLicenseCredit = Omit<SourceCredit, 'attributionUrl'>

/** Resultado da resolucao. Cada variante e uma ACAO diferente do operador. */
export type WatchCreditResolution =
  /** Nao ha alias mapeando (provider_api, provider_key) a um provedor canonico. */
  | { readonly kind: 'no-alias' }
  /** Ha provedor canonico, mas nenhuma licenca de watch_availability vigente. */
  | { readonly kind: 'no-license'; readonly watchProviderId: string; readonly providerSlug: string }
  /** Ha provedor canonico e licenca; a decisao final e de `resolveDisplayAllowed`. */
  | {
      readonly kind: 'credit'
      readonly watchProviderId: string
      readonly providerSlug: string
      readonly credit: WatchLicenseCredit
    }

/** Porta de consulta de credito por (provider_key do upstream, pais). */
export interface WatchCreditLookup {
  find(providerKey: string | null, countryCode: string): Promise<WatchCreditResolution>
}

/**
 * O `LEFT JOIN` na licenca e deliberado: sem ele, um provedor canonico
 * cadastrado mas ainda sem licenca voltaria ZERO linhas e seria reportado como
 * `no-alias` — mandando o operador cadastrar um alias que ja existe.
 *
 * A decisao de uso e subconsulta correlacionada (nao JOIN) para que a escolha
 * territorial-vence-global aconteca dentro dela, sem multiplicar linhas.
 *
 * `l."provider_key" = $1` NAO e redundante — e o que impede o cruzamento de
 * proveniencia. Desde que existe uma licenca de `watch_availability` POR
 * FORNECEDOR TECNICO (Movie of the Night para `streaming_availability`,
 * JustWatch para `tmdb` — ver `authorization-spec.ts`), o mesmo `source_key`
 * tem DUAS licencas vigentes. Sem este filtro, o `ORDER BY l."id" DESC LIMIT 1`
 * entregaria a mais recente para os dois caminhos, e o dado da RapidAPI passaria
 * a ser creditado ao JustWatch em silencio — exatamente a proveniencia falsa que
 * esta separacao existe para impedir.
 */
const CREDIT_SQL = `
  SELECT
    p."id"                       AS watch_provider_id,
    p."slug"                     AS provider_slug,
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
         AND d."use_case" = 'watch_offer_display'
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
  FROM "watch_provider_aliases" a
  JOIN "watch_providers" p ON p."id" = a."provider_id"
  LEFT JOIN "source_licenses" l
    ON l."source_key" = p."slug"
   AND l."content_type" = 'watch_availability'
   AND l."is_current"
   AND l."provider_key" = $1
  WHERE a."provider_api" = $1
    AND a."external_key" = $2
  ORDER BY l."id" DESC
  LIMIT 1
`

/**
 * Cria o lookup de credito de streaming com cache por execucao.
 *
 * `providerApi` e o FORNECEDOR TECNICO da oferta (`watch_availability.provider_api`)
 * e governa os dois lados da consulta: qual alias resolve o provedor canonico E
 * qual licenca carrega o credito. Passar o fornecedor errado aqui produziria
 * credito de outra proveniencia — por isso ele e parametro explicito, nunca
 * constante embutida. Default preservado para o caminho historico da RapidAPI.
 */
export function createPrismaWatchCreditLookup(
  prisma: PrismaClient,
  providerApi: string = STREAMING_AVAILABILITY_PROVIDER_API,
): WatchCreditLookup {
  const cache = new Map<string, WatchCreditResolution>()

  return {
    async find(providerKey: string | null, countryCode: string): Promise<WatchCreditResolution> {
      // Oferta sem `provider_key` nao tem como ser ligada a um provedor
      // canonico. O trigger ja recusaria; recusamos antes, sem gastar consulta.
      if (providerKey === null || providerKey.trim() === '') return { kind: 'no-alias' }

      // Separador ESCAPADO (\u001F), nunca o byte cru: um 0x1F literal no fonte
      // quebra a guarda `no-raw-control-bytes`. E um separador de verdade
      // importa: sem ele, ("netflixB","R") e ("netflix","BR") colidiriam.
      const cacheKey = `${providerKey}\u001F${countryCode}`
      const cached = cache.get(cacheKey)
      if (cached !== undefined) return cached

      const rows = await prisma.$queryRawUnsafe<Array<CreditRow & { provider_slug: string }>>(
        CREDIT_SQL,
        providerApi,
        providerKey,
        countryCode,
      )
      const row = rows[0]

      let resolution: WatchCreditResolution
      if (row === undefined) {
        resolution = { kind: 'no-alias' }
      } else if (row.license_status === null) {
        // Alias existe, licenca nao. Recusa DIFERENTE de `no-alias`.
        resolution = {
          kind: 'no-license',
          watchProviderId: row.watch_provider_id.toString(),
          providerSlug: row.provider_slug,
        }
      } else {
        resolution = {
          kind: 'credit',
          watchProviderId: row.watch_provider_id.toString(),
          providerSlug: row.provider_slug,
          credit: {
            licenseStatus: row.license_status,
            licenseDisplayAllowed: row.display_allowed === true,
            licenseScoreAllowed: row.score_allowed === true,
            requiresAttribution: row.requires_attribution !== false,
            requiresLinkback: row.requires_linkback !== false,
            attributionText: row.attribution_text,
            usageDecisionId: row.usage_decision_id === null ? null : row.usage_decision_id.toString(),
          },
        }
      }

      cache.set(cacheKey, resolution)
      return resolution
    },
  }
}
