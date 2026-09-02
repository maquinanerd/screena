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
import { resolveDisplayAllowed } from '@screena/schemas'
import {
  STREAMING_AVAILABILITY_ATTRIBUTION_URL,
  STREAMING_AVAILABILITY_PROVIDER_API,
} from '../provider-identity.js'

import type { WatchOfferRow } from '../offer-types.js'
import type { WatchReplaceOutcome, WatchStorePort } from '../ports.js'
import type { WatchCreditLookup } from './watch-credit-lookup.js'

/**
 * Identidade gravada em `reviewed_by` quando a exibicao e ligada pela POLITICA,
 * e nao por uma pessoa olhando a oferta.
 *
 * Decisao do proprietario (2026-08-11): exibicao automatica desde que o credito
 * exigido pela licenca esteja satisfeito. A autoridade continua humana — e a
 * licenca de `services/legal/src/authorization-spec.ts`, decidida por
 * `DECIDED_BY` — mas quem CARIMBA cada oferta e o worker.
 *
 * O prefixo `automation:` e deliberado e nunca deve ser removido: `reviewed_by`
 * antes afirmava "uma pessoa revisou ESTA oferta". Agora afirma "esta oferta
 * passou pela politica X". Auditoria separa os dois com `LIKE 'automation:%'`.
 * Mesma convencao de `RATINGS_AUTO_REVIEWER`.
 */
export const STREAMING_AUTO_REVIEWER = 'automation:streaming-sync/display-policy-v1'

/** Opcoes do store. Sem `credits`, o comportamento e o fail-closed historico. */
export interface WatchStoreOptions {
  /**
   * Resolve o credito do provedor canonico. AUSENTE => nenhuma oferta e
   * promovida (o store se comporta exatamente como antes desta feature).
   * Fail-closed por omissao.
   */
  readonly credits?: WatchCreditLookup
  /**
   * Para onde vai o diagnostico. Nenhum caminho de falha desta feature retorna
   * vazio em silencio: ou promove, ou diz por que nao promoveu.
   */
  readonly log?: (message: string) => void
}

/**
 * Liga a exibicao de UMA oferta, se e somente se a politica permitir.
 *
 * Roda FORA da transacao de reconciliacao, e depois dela, por dois motivos:
 *  1. a oferta precisa ja existir e estar auditavel antes de ser considerada;
 *  2. o trigger levanta EXCEPTION quando recusa. Dentro de uma transacao
 *     interativa, isso envenena a transacao inteira — as ofertas seguintes
 *     falhariam com "current transaction is aborted" e o snapshot ja
 *     reconciliado seria desfeito. Uma statement por oferta, fora da tx, isola a
 *     recusa naquela oferta.
 */
async function applyDisplayDecision(
  prisma: PrismaClient,
  offer: WatchOfferRow,
  countryCode: string,
  options: WatchStoreOptions,
): Promise<void> {
  const { credits, log } = options
  if (credits === undefined) return

  const where = `${offer.entityType}:${offer.entityId} ${offer.providerKey ?? '<sem provider_key>'}/${offer.offerType}`
  const resolution = await credits.find(offer.providerKey, countryCode)

  if (resolution.kind === 'no-alias') {
    // Recusa DIFERENTE de "sem licenca": a acao do operador e cadastrar o alias,
    // nao a licenca. Adivinhar o provedor canonico pelo nome exibido e
    // exatamente o erro que a tabela de aliases existe para impedir.
    log?.(
      `[streaming] nao exibida ${where} — sem alias canonico para (provider_api=${STREAMING_AVAILABILITY_PROVIDER_API}, provider_key=${offer.providerKey ?? '<null>'})`,
    )
    return
  }

  const subject = {
    sourceKey: resolution.providerSlug,
    // Uma oferta NOMEIA um provedor; nao pontua nada. `score_allowed` da licenca
    // de streaming e false e isso esta correto — exigir permissao de NUMERO aqui
    // bloquearia toda oferta legitima.
    needsScorePermission: false,
    // `offer_type` e NOT NULL e restrito ao enum `OfferType` (so modalidades
    // legais). A natureza da oferta esta classificada por construcao — nao ha
    // aqui o eixo critics/audience que existe em rating.
    classified: true,
  } as const

  if (resolution.kind === 'no-license') {
    const refusal = resolveDisplayAllowed(subject, null)
    log?.(`[streaming] nao exibida ${where} — ${refusal.reason}: ${refusal.detail}`)
    return
  }

  const credit = resolution.credit
  // O linkback de uma oferta e o link exigido pelos TERMOS DO AGREGADOR (Movie
  // of the Night), declarado em `@screena/streaming-availability-client`. Nao e
  // o link da oferta no provedor: o credito diz quem forneceu a DISPONIBILIDADE,
  // e o linkback tem de apontar para essa fonte.
  const attributionUrl = STREAMING_AVAILABILITY_ATTRIBUTION_URL
  const decision = resolveDisplayAllowed(subject, { ...credit, attributionUrl })

  if (!decision.displayAllowed) {
    log?.(`[streaming] nao exibida ${where} — ${decision.reason}: ${decision.detail}`)
    return
  }

  const { licenseStatus, requiresAttribution, requiresLinkback, attributionText } = credit
  // `usageDecisionId` nao-vazio e condicao de `displayAllowed` (a recusa
  // `no-usage-decision` cobre o resto). O guard aqui e para o compilador, nao
  // para a regra — e um `return` silencioso seria justamente o descarte mudo que
  // esta feature existe para eliminar.
  if (credit.usageDecisionId === null) {
    log?.(`[streaming] nao exibida ${where} — no-usage-decision: decisao de uso ausente`)
    return
  }
  const usageDecisionId = BigInt(credit.usageDecisionId)

  // ATENCAO ao que e parametro e o que e `w."..."` dentro do fingerprint: os
  // cinco campos de licenca estao sendo ESCRITOS nesta mesma statement, e em
  // Postgres um `w."license_status"` na clausula SET le o valor ANTIGO. Passar
  // `w."..."` ali gravaria o hash do payload PRE-atualizacao; o trigger
  // recomputa com os valores novos, os dois nao bateriam e o UPDATE abortaria.
  // Por isso licenca/atribuicao entram interpolados (parametros) e so os campos
  // NAO tocados aqui (identidade, preco, links, validade) vem de `w."..."`.
  // Mesma classe do bug de `web_url`/`EXCLUDED` corrigido acima.
  try {
    await prisma.$executeRaw`
      UPDATE "watch_availability" w
         SET "license_status" = ${licenseStatus}::"LicenseStatus",
             "requires_attribution" = ${requiresAttribution},
             "requires_linkback" = ${requiresLinkback},
             "attribution_text" = ${attributionText},
             "attribution_url" = ${attributionUrl},
             "watch_provider_id" = ${BigInt(resolution.watchProviderId)},
             "data_usage_decision_id" = ${usageDecisionId},
             "reviewed_at" = now(),
             "reviewed_by" = ${STREAMING_AUTO_REVIEWER},
             "display_allowed" = true,
             "approved_payload_hash" = watch_offer_payload_fingerprint_v1(
               w."provider_api", w."external_offer_id", w."entity_type", w."entity_id",
               w."country_code", w."offer_type", w."provider_key", w."provider_name",
               w."package", w."quality", w."price", w."currency", w."deep_link",
               w."web_url", w."available_from", w."available_until",
               ${licenseStatus}::"LicenseStatus", ${requiresAttribution}, ${requiresLinkback},
               ${attributionText}, ${attributionUrl}),
             "updated_at" = now()
       WHERE w."provider_api" = ${STREAMING_AVAILABILITY_PROVIDER_API}
         AND w."country_code" = ${countryCode}
         AND watch_offer_identity_key_v1(
               w."provider_api", w."external_offer_id", w."entity_type", w."entity_id",
               w."country_code", w."offer_type", w."provider_key", w."provider_name", w."package")
             = watch_offer_identity_key_v1(
               ${STREAMING_AVAILABILITY_PROVIDER_API}, ${offer.externalOfferId},
               ${offer.entityType}::"EntityType", ${BigInt(offer.entityId)}, ${countryCode},
               ${offer.offerType}::"OfferType", ${offer.providerKey}, ${offer.providerName},
               ${offer.package})
    `
  } catch (error) {
    // O trigger e a autoridade: se ele recusou, a politica pura e o banco
    // discordam e a oferta fica NAO exibida (fail-closed). Levantar aqui mataria
    // o sync inteiro por causa de uma oferta; engolir sem log esconderia uma
    // divergencia real entre as duas camadas. Logamos, alto.
    log?.(
      `[streaming] TRIGGER RECUSOU exibicao de ${where} — politica e banco divergem: ${String(error)}`,
    )
  }
}

/** Cria um `WatchStorePort` com reconciliacao por identidade estavel. */
export function createPrismaWatchStore(
  prisma: PrismaClient,
  options: WatchStoreOptions = {},
): WatchStorePort {
  return {
    async replaceSnapshot(input): Promise<WatchReplaceOutcome> {
      const entityId = BigInt(input.entityId)

      const outcome = await prisma.$transaction(async (tx) => {
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
              , "watch_provider_id"
            ) VALUES (
              ${offer.entityType}::"EntityType", ${entityId}, ${offer.countryCode},
              ${offer.providerKey}, ${offer.providerName}, ${offer.externalOfferId}, ${offer.package}, ${offer.offerType}::"OfferType",
              ${offer.deepLink}, ${offer.webUrl}, ${offer.price}, ${offer.currency}, ${offer.quality},
              ${offer.availableFrom}, ${offer.availableUntil}, ${input.fetchedAt}, ${input.staleAfter},
              ${STREAMING_AVAILABILITY_PROVIDER_API}, false, now()
              -- Provedor canonico resolvido pelo ALIAS, nunca adivinhado pelo
              -- nome exibido. Sem alias mapeado fica NULL: a oferta e ingerida e
              -- auditavel, mas o trigger nao deixa exibir.
              , (SELECT a."provider_id" FROM "watch_provider_aliases" a
                  WHERE a."provider_api" = ${STREAMING_AVAILABILITY_PROVIDER_API}
                    AND a."external_key" = ${offer.providerKey})
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
              "watch_provider_id" = EXCLUDED."watch_provider_id",
              "updated_at" = now(),
              "display_allowed" = (
                "watch_availability"."display_allowed"
                -- Alias sumiu/remapeado => nao ha provedor canonico => revoga.
                -- Sem esta clausula o UPDATE manteria display=true com
                -- watch_provider_id NULL e o TRIGGER derrubaria o sync inteiro
                -- com excecao, em vez de revogar so esta oferta.
                AND EXCLUDED."watch_provider_id" IS NOT NULL
                AND "watch_availability"."approved_payload_hash" IS NOT DISTINCT FROM watch_offer_payload_fingerprint_v1(
                  EXCLUDED."provider_api", EXCLUDED."external_offer_id", EXCLUDED."entity_type",
                  EXCLUDED."entity_id", EXCLUDED."country_code", EXCLUDED."offer_type",
                  EXCLUDED."provider_key", EXCLUDED."provider_name", EXCLUDED."package",
                  EXCLUDED."quality", EXCLUDED."price", EXCLUDED."currency", EXCLUDED."deep_link",
                  -- web_url usa EXCLUDED (valor NOVO), como todo campo de payload
                  -- que o sync atualiza. Usava o valor ANTIGO: como o SET grava o
                  -- novo, o fingerprint batia com o hash aprovado, display ficava
                  -- true e o trigger — que recomputa com os valores NOVOS — abortava
                  -- o sync com excecao em vez de revogar. Coberto por teste.
                  EXCLUDED."web_url", EXCLUDED."available_from", EXCLUDED."available_until",
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

      // A oferta NASCEU/foi reconciliada fail-closed (display=false, licenca
      // `unknown`). So agora, com ela ja persistida, committed e auditavel, a
      // politica decide se acende. Reavaliar TODAS as ofertas do snapshot (e nao
      // so as criadas) e o que faz uma licenca cadastrada depois acender ofertas
      // antigas no proximo ciclo, e o que reaprova o payload NOVO das ofertas
      // que o upsert acabou de revogar.
      for (const offer of input.offers) {
        await applyDisplayDecision(prisma, offer, input.countryCode, options)
      }

      return outcome
    },
  }
}
