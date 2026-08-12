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
 *   1. wrong-provider           — fornecedor fora do conjunto AUTORIZADO
 *                                 (nunca tocamos dado de fornecedor nao governado);
 *   2. wrong-country            — nao e BR;
 *   3. already-display-allowed  — ja exibivel (nada a promover);
 *   4. invalid-offer-type       — fora de {subscription,free,rent,buy}
 *                                 (inclui ads/cinema/addon);
 *   5. missing-provider         — sem provider_key OU sem provider_name;
 *   6. missing-link             — sem destino algum (nem deep_link, nem web_url);
 *   7. unsafe-link              — destino nao-http(s) / marcador de pirataria;
 *   8. missing-attribution      — exige credito/linkback e nao os tem hidratados;
 *   9. expired                  — `available_until` no passado.
 */

import { TMDB_PROVIDER_API } from '@screena/tmdb-client'
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

/**
 * Fornecedores tecnicos GOVERNADOS por esta ferramenta. Conjunto AMPLIADO, nunca
 * verificacao removida: cada fornecedor daqui passa exatamente pelos mesmos oito
 * guardrails. O que muda entre eles nao e o rigor, e o formato do dado —
 * `streaming_availability` traz deep link por oferta; `tmdb` traz so o link por
 * pais. Ambos precisam de destino http(s) seguro e de credito hidratado.
 *
 * Um fornecedor NAO listado aqui continua sendo recusado com `wrong-provider`:
 * promover dado de origem nao governada e o que este guard existe para impedir.
 */
export const PROMOTION_PROVIDER_APIS: readonly string[] = [
  STREAMING_AVAILABILITY_PROVIDER_API,
  TMDB_PROVIDER_API,
]

/**
 * Fornecedor historico desta ferramenta. Mantido como export para nao quebrar
 * quem o importa; a decisao passou a ser `PROMOTION_PROVIDER_APIS`.
 */
export const PROMOTION_PROVIDER_API = STREAMING_AVAILABILITY_PROVIDER_API

/** O fornecedor tecnico da oferta esta no conjunto governado? */
export function isGovernedProviderApi(providerApi: string | null): boolean {
  return providerApi !== null && PROMOTION_PROVIDER_APIS.includes(providerApi)
}

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
 * Destino efetivo de uma oferta: deep link do provedor, ou a pagina do pais no
 * agregador quando o fornecedor nao publica deep link (sempre o caso do TMDB).
 * `null` quando nao ha nenhum dos dois.
 *
 * Espelha deliberadamente a resolucao do presenter
 * (`watch-availability-presenter.ts`): promover algo que a tela vai descartar e
 * uma promocao que mente.
 */
export function promotionDestination(candidate: PromotionCandidate): string | null {
  const deep = candidate.deepLink?.trim()
  if (deep !== undefined && deep !== '') return deep
  const web = candidate.webUrl?.trim()
  if (web !== undefined && web !== '') return web
  return null
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
  if (!isGovernedProviderApi(candidate.providerApi)) return reject('wrong-provider')
  if (candidate.countryCode.toUpperCase() !== PROMOTION_COUNTRY) return reject('wrong-country')
  if (candidate.displayAllowed) return reject('already-display-allowed')
  if (!isPromotableOfferType(candidate.offerType)) return reject('invalid-offer-type')
  if (isBlank(candidate.providerKey) || isBlank(candidate.providerName)) {
    return reject('missing-provider')
  }
  // DESTINO: deep link do provedor quando existe; senao a pagina do pais no
  // agregador (`web_url`). A precedencia e a MESMA do presenter — se divergisse,
  // a CLI aprovaria uma oferta que a tela depois descartaria.
  const destination = promotionDestination(candidate)
  if (destination === null) return reject('missing-link')
  if (!isSafeDeepLink(destination)) return reject('unsafe-link')
  // CREDITO E REQUISITO DE EXIBICAO, nao detalhe de render. A licenca que
  // autoriza exibir e a mesma que obriga a creditar — e para a origem TMDB o
  // credito devido e o do JustWatch, sob pena de revogacao do acesso a API.
  if (candidate.requiresAttribution !== false && isBlank(candidate.attributionText)) {
    return reject('missing-attribution')
  }
  if (candidate.requiresLinkback !== false && isBlank(candidate.attributionUrl)) {
    return reject('missing-attribution')
  }
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
  if (!isGovernedProviderApi(candidate.providerApi)) return rejectRevoke('wrong-provider')
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
