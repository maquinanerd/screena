/**
 * watch-display-policy.ts — Acende, POR POLITICA, a oferta de origem TMDB que ja
 * tem licenca e decisao de exibicao vigentes.
 * COBERTO por `tsconfig.runtime.json` (`services/ingestion/src/persistence/**`).
 *
 * ============================================================================
 * DECISAO DO DONO (2026-10-29)
 * ============================================================================
 * Ate aqui toda oferta nascia `display_allowed = false` e so acendia pela CLI
 * humana `services/streaming/bin/promote-watch-availability.ts`, em lotes de no
 * maximo 500. Medido em producao em 29/10/2026: 15.993 filmes tinham oferta BR
 * gravada e 106 apareciam; 58.823 linhas de filme ja tinham alias de provedor e
 * decisao de licenca aprovada, e esperavam so o clique.
 *
 * O dono, Pablo Eduardo, decidiu no chat em 29/10/2026 — a opcao oferecida era
 * "Decido que oferta com decisao de licenca aprovada acende automaticamente,
 * como as notas desde 11/08", e a resposta foi "tudo faça tudo!" — que a oferta
 * passa a acender sozinha, como a nota externa desde 2026-08-11
 * (`RATINGS_AUTO_REVIEWER` em `services/ratings`).
 *
 * A AUTORIDADE CONTINUA HUMANA: a licenca de cada provedor e a decisao de uso
 * `watch_offer_display` sao registradas por pessoa (`pnpm legal sources apply`).
 * O que muda e QUEM carimba cada linha: o worker, com `reviewed_by` prefixado
 * `automation:` para que uma auditoria separe os dois com um `LIKE`.
 *
 * ============================================================================
 * AS MESMAS TRAVAS DA CLI, E O TRIGGER COMO ULTIMA PALAVRA
 * ============================================================================
 * A selecao repete os guardrails de `services/streaming/src/promotion/
 * guardrails.ts` (pais BR, modalidade promovivel, provedor canonico, link
 * http(s) sem pirataria, credito exigido presente, validade) e o UPDATE e o
 * MESMO da CLI: re-resolve o alias e a decisao vigente e grava o fingerprint
 * calculado NO BANCO. O trigger `watch_availability_display_guard` continua
 * sendo quem decide: se ele recusar, a linha fica apagada e a recusa volta
 * NOMEADA, nunca engolida.
 *
 * Duas travas a mais, que a CLI nao precisava porque um humano olhava a linha:
 *
 *  - SO O SNAPSHOT ATUAL. A oferta que sumiu do TMDB e revogada e fica com o
 *    `fetched_at` antigo; reacende-la afirmaria uma oferta que nao existe mais.
 *  - SO OFERTA RECENTE (`AUTO_DISPLAY_MAX_OFFER_AGE_DAYS`). Titulo que perdeu
 *    TODA oferta BR nao e revogado (o caminho do detalhe para em `empty` antes
 *    do store), entao a idade e o que impede acender o que pode ter saido.
 *
 * Fail-closed em tudo: qualquer erro aqui deixa a linha como nasceu (apagada).
 */

import type { PrismaClient } from '@screena/db/server'
import { TMDB_PROVIDER_API } from '@screena/tmdb-client'

/**
 * Identidade gravada em `reviewed_by` quando a POLITICA acende a oferta. O
 * prefixo `automation:` nunca deve ser removido (ver o cabecalho).
 */
export const WATCH_AUTO_REVIEWER = 'automation:watch-sync/display-policy-v1'

/** Unico pais que o render le hoje (`apps/web/src/server/entity-watch.ts`). */
export const AUTO_DISPLAY_COUNTRY = 'BR'

/**
 * Modalidades que podem acender. ESPELHA `PROMOTABLE_OFFER_TYPES` de
 * `services/streaming/src/promotion/types.ts`; `cinema` fica fora porque nao e
 * disponibilidade domestica. O teste de governanca prende as duas listas juntas.
 */
export const AUTO_DISPLAY_OFFER_TYPES = ['subscription', 'free', 'ads', 'rent', 'buy'] as const

/** Oferta coletada ha mais que isto nao acende sozinha. */
export const AUTO_DISPLAY_MAX_OFFER_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** Recorte de uma passada da politica. */
export interface WatchDisplayPolicyScope {
  /** Restringe a uma entidade (o caminho do sync). Ausente = acervo inteiro. */
  readonly entity?: { readonly entityType: 'movie' | 'tv'; readonly entityId: string }
  /** Teto de linhas consideradas nesta passada. */
  readonly limit: number
  /** "Agora", injetado para a idade da oferta ser testavel. */
  readonly now?: Date
}

/** Uma oferta que o trigger recusou, com o motivo dele. */
export interface WatchDisplayRefusal {
  readonly id: string
  readonly message: string
}

/** O que uma passada fez. */
export interface WatchDisplayPolicyOutcome {
  /** Linhas que passaram na selecao (candidatas). */
  readonly eligible: number
  /** Linhas que de fato acenderam. */
  readonly displayed: number
  /** Linhas que o trigger recusou (ficaram apagadas). */
  readonly refusals: readonly WatchDisplayRefusal[]
}

/**
 * Os predicados da selecao. Params: $1 provider_api, $2 pais, $3 modalidades,
 * $4 corte de idade, $5 tipo da entidade (ou null), $6 id da entidade (ou null).
 */
const ELIGIBLE_WHERE = `
       w."provider_api" = $1
   AND w."country_code" = $2
   AND w."display_allowed" = false
   AND w."offer_type"::text = ANY($3::text[])
   AND w."watch_provider_id" IS NOT NULL
   AND w."data_usage_decision_id" IS NOT NULL
   AND w."license_status" IN ('official', 'licensed', 'third_party')
   AND btrim(COALESCE(w."provider_key", '')) <> ''
   AND btrim(COALESCE(w."provider_name", '')) <> ''
   AND (NOT w."requires_attribution" OR btrim(COALESCE(w."attribution_text", '')) <> '')
   AND (NOT w."requires_linkback" OR btrim(COALESCE(w."attribution_url", '')) <> '')
   AND COALESCE(NULLIF(btrim(w."deep_link"), ''), btrim(w."web_url")) ~* '^https?://'
   AND COALESCE(NULLIF(btrim(w."deep_link"), ''), btrim(w."web_url")) !~* '\\.torrent($|[?#])|xt=urn:btih:'
   AND (w."available_until" IS NULL OR w."available_until" > now())
   AND w."fetched_at" >= $4::timestamptz AT TIME ZONE 'UTC'
   AND NOT EXISTS (
         SELECT 1
           FROM "watch_availability" n
          WHERE n."entity_type" = w."entity_type"
            AND n."entity_id" = w."entity_id"
            AND n."country_code" = w."country_code"
            AND n."provider_api" = w."provider_api"
            AND n."fetched_at" > w."fetched_at"
       )
   AND ($5::"EntityType" IS NULL OR w."entity_type" = $5::"EntityType")
   AND ($6::bigint IS NULL OR w."entity_id" = $6::bigint)
`

function selectionParams(scope: WatchDisplayPolicyScope): unknown[] {
  const now = scope.now ?? new Date()
  const ageCutoff = new Date(now.getTime() - AUTO_DISPLAY_MAX_OFFER_AGE_DAYS * DAY_MS)
  return [
    TMDB_PROVIDER_API,
    AUTO_DISPLAY_COUNTRY,
    [...AUTO_DISPLAY_OFFER_TYPES],
    ageCutoff.toISOString(),
    scope.entity?.entityType ?? null,
    scope.entity === undefined ? null : BigInt(scope.entity.entityId),
  ]
}

/** Quantas linhas a politica acenderia agora (sem escrever nada). */
export async function countWatchDisplayCandidates(
  prisma: PrismaClient,
  scope: Omit<WatchDisplayPolicyScope, 'limit'>,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "watch_availability" w WHERE ${ELIGIBLE_WHERE}`,
    ...selectionParams({ ...scope, limit: 0 }),
  )
  return rows[0]?.n ?? 0
}

/**
 * Acende as ofertas elegiveis do recorte. Um UPDATE por linha: se o trigger
 * recusar uma, SO ela fica apagada, e o motivo volta em `refusals`.
 */
export async function applyWatchDisplayPolicy(
  prisma: PrismaClient,
  scope: WatchDisplayPolicyScope,
): Promise<WatchDisplayPolicyOutcome> {
  const take = Math.max(0, Math.trunc(scope.limit))
  if (take === 0) return { eligible: 0, displayed: 0, refusals: [] }

  const ids = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    `SELECT w."id" AS id FROM "watch_availability" w WHERE ${ELIGIBLE_WHERE} ORDER BY w."id" LIMIT $7`,
    ...selectionParams(scope),
    take,
  )

  let displayed = 0
  const refusals: WatchDisplayRefusal[] = []
  for (const { id } of ids) {
    try {
      // O MESMO UPDATE da CLI humana (`watch-review-store.ts`), com o carimbo
      // da politica no lugar do nome do revisor. Alias e decisao sao
      // re-resolvidos aqui para nao existir janela entre resolver e acender.
      const affected = await prisma.$executeRaw`
        UPDATE "watch_availability" w
        SET "display_allowed" = true,
            "reviewed_at" = now(),
            "reviewed_by" = ${WATCH_AUTO_REVIEWER},
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
        WHERE w."id" = ${id}
          AND w."provider_api" = ${TMDB_PROVIDER_API}
          AND w."country_code" = ${AUTO_DISPLAY_COUNTRY}
          AND w."display_allowed" = false
      `
      displayed += Number(affected)
    } catch (error) {
      refusals.push({
        id: id.toString(),
        message: error instanceof Error ? error.message.split('\n')[0] ?? String(error) : String(error),
      })
    }
  }

  return { eligible: ids.length, displayed, refusals }
}
