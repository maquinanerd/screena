/**
 * guardrails.ts — Guardrails PUROS da promocao de `watch_availability`.
 *
 * Uma unica funcao decide se uma oferta pode ir de `display_allowed=false` para
 * `true`. NAO toca banco/rede: recebe a candidata ja materializada e devolve
 * `eligible` + `reason`. O bin evita SQL manual e delega toda a decisao aqui;
 * o adapter Prisma ainda reafirma provider/pais/estado no `WHERE` do update
 * (defesa em profundidade).
 *
 * Precedencia dos motivos (a primeira que bate e reportada):
 *   1. wrong-provider           — nao e `streaming_availability` (nunca tocamos
 *                                 dado de outro fornecedor);
 *   2. wrong-country            — nao e BR;
 *   3. already-display-allowed  — ja exibivel (nada a promover);
 *   4. invalid-offer-type       — fora de {subscription,free,rent,buy}
 *                                 (inclui ads/cinema/addon);
 *   5. missing-provider         — sem provider_key OU sem provider_name;
 *   6. missing-link             — sem deep_link;
 *   7. unsafe-link              — deep_link nao-http(s) / marcador de pirataria;
 *   8. expired                  — `available_until` no passado.
 */

import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import { isSafeDeepLink } from '../streaming-availability/mapping.js'
import {
  isPromotableOfferType,
  type PromotionCandidate,
  type PromotionEvaluation,
  type PromotionRejectionReason,
  type RevocationEvaluation,
  type RevocationRejectionReason,
} from './types.js'

/** Fornecedor tecnico governado por esta ferramenta (nunca outro). */
export const PROMOTION_PROVIDER_API = STREAMING_AVAILABILITY_PROVIDER_API

/** Unico pais promovel nesta fase. */
export const PROMOTION_COUNTRY = 'BR'

/** String presente e nao-vazia? */
function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function reject(reason: PromotionRejectionReason): PromotionEvaluation {
  return { eligible: false, reason }
}

/**
 * Avalia se uma oferta pode ser promovida a `display_allowed=true`.
 *
 * `ctx.now` e injetado para tornar o teste de validade (`available_until`)
 * deterministico. Uma oferta sem `available_until` nao vence (assinaturas
 * abertas); com data no passado (`<= now`), vence e e recusada.
 */
export function evaluatePromotionEligibility(
  candidate: PromotionCandidate,
  ctx: { readonly now: Date },
): PromotionEvaluation {
  if (candidate.providerApi !== PROMOTION_PROVIDER_API) return reject('wrong-provider')
  if (candidate.countryCode.toUpperCase() !== PROMOTION_COUNTRY) return reject('wrong-country')
  if (candidate.displayAllowed) return reject('already-display-allowed')
  if (!isPromotableOfferType(candidate.offerType)) return reject('invalid-offer-type')
  if (isBlank(candidate.providerKey) || isBlank(candidate.providerName)) {
    return reject('missing-provider')
  }
  if (isBlank(candidate.deepLink)) return reject('missing-link')
  if (!isSafeDeepLink(candidate.deepLink)) return reject('unsafe-link')
  if (
    candidate.availableUntil !== null &&
    candidate.availableUntil.getTime() <= ctx.now.getTime()
  ) {
    return reject('expired')
  }
  return { eligible: true, reason: null }
}

function rejectRevoke(reason: RevocationRejectionReason): RevocationEvaluation {
  return { eligible: false, reason }
}

/**
 * Avalia se uma oferta pode ter a exibicao REVOGADA (`true` -> `false`).
 *
 * So mexemos em ofertas do proprio fornecedor; revogar uma linha que ja esta
 * `display_allowed=false` nao faz nada (`already-disallowed`).
 */
export function evaluateRevocationEligibility(
  candidate: PromotionCandidate,
): RevocationEvaluation {
  if (candidate.providerApi !== PROMOTION_PROVIDER_API) return rejectRevoke('wrong-provider')
  if (!candidate.displayAllowed) return rejectRevoke('already-disallowed')
  return { eligible: true, reason: null }
}

/**
 * Host de um deep link, para o relatorio nunca despejar a URL inteira.
 * Retorna um rotulo legivel quando o link falta ou e invalido.
 */
export function deepLinkHost(deepLink: string | null): string {
  if (isBlank(deepLink)) return '(sem link)'
  try {
    return new URL((deepLink as string).trim()).host || '(host vazio)'
  } catch {
    return '(link invalido)'
  }
}
