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
 *   3. withheld-by-decision     — decisao humana registrada retem esta origem
 *                                 (`WITHHELD_OFFER_SOURCES`);
 *   4. already-display-allowed  — ja exibivel (nada a promover);
 *   5. invalid-offer-type       — fora de {subscription,free,ads,rent,buy}
 *                                 (inclui cinema e qualquer valor novo);
 *   6. missing-provider         — sem provider_key OU sem provider_name;
 *   7. no-canonical-provider    — `(provider_api, provider_key)` sem alias em
 *                                 `watch_provider_aliases` (sem provedor
 *                                 canonico nao ha licenca nem decisao de uso);
 *   8. missing-link             — sem destino algum (nem deep_link, nem web_url);
 *   9. unsafe-link              — destino nao-http(s) / marcador de pirataria;
 *  10. missing-attribution      — exige credito/linkback e nao os tem hidratados;
 *  11. expired                  — `available_until` no passado.
 */

import { TMDB_PROVIDER_API } from '@screena/tmdb-client'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '../provider-identity.js'

import { isSafeDeepLink } from '../safe-deep-link.js'
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

/**
 * ============ ORIGENS RETIDAS POR DECISAO HUMANA ============
 *
 * Ofertas que passariam em TODOS os guardrails e que, ainda assim, nao devem
 * acender. Cada linha e uma decisao registrada, com data e motivo.
 *
 * POR QUE ISTO PRECISOU EXISTIR. Ate 2026-08-19 o vocabulario nao tinha como
 * dizer "elegivel e deliberadamente nao promovido". As cinco ofertas abaixo
 * apareciam como ELEGIVEL na revisao, e a unica coisa que as mantinha apagadas
 * era ninguem ter rodado `promote --ids` com elas. Ausencia de acao nao e
 * registro: bastava uma revisao de rotina daqui a tres meses para alguem
 * promove-las sem ter como saber que ja havia decisao em contrario.
 *
 * O QUE ESTA TABELA NAO E. Nao e licenca (a licenca dessas ofertas existe e
 * permite exibir) e nao e um gate tecnico (nao ha nada quebrado nelas). E uma
 * decisao de TELA, e por isso mora no vocabulario de decisao, nao no de
 * validacao. Remover uma linha daqui e o ato explicito de reverter a decisao.
 */
export interface WithheldOfferSource {
  /** `watch_availability.provider_api`. */
  readonly providerApi: string
  /** `watch_availability.provider_key` — a chave crua do fornecedor. */
  readonly providerKey: string
  /** Data da decisao (ISO curto), para o relatorio nao virar folclore. */
  readonly decidedOn: string
  /** Quem decidiu. */
  readonly decidedBy: string
  /** Por que. Vai INTEIRO para a saida do comando — ninguem precisa abrir o codigo. */
  readonly reason: string
}

/**
 * As origens retidas hoje.
 *
 * As tres entradas cobrem as 5 ofertas BR de `provider_key` NAO numerico que
 * chegam pela RapidAPI. Motivo unico e de TELA: sao as mesmas plataformas que ja
 * acendem pela TMDB. Promove-las duplicaria a linha do leitor — "Prime Video"
 * apareceria duas vezes na mesma pagina, com creditos de origem DIFERENTES
 * ("Movie of the Night" e "JustWatch"), o que faria a pagina parecer estar
 * afirmando duas disponibilidades independentes onde ha uma.
 *
 * `hbo` entra aqui por completude do registro, ainda que hoje ela pare antes,
 * em `no-canonical-provider` (nao existe alias `streaming_availability:hbo`; a
 * chave da RapidAPI para essa marca e `max`). Se o alias for criado um dia, a
 * decisao ja esta escrita — e nao vira uma promocao acidental.
 */
export const WITHHELD_OFFER_SOURCES: readonly WithheldOfferSource[] = [
  {
    providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    providerKey: 'prime',
    decidedOn: '2026-08-19',
    decidedBy: 'Pablo Eduardo',
    reason:
      'Mesma plataforma ja acende pela origem TMDB (provider_id 119/9 -> slug prime-video). ' +
      'Promover duplicaria a linha na tela, com dois creditos de origem diferentes.',
  },
  {
    providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    providerKey: 'apple',
    decidedOn: '2026-08-19',
    decidedBy: 'Pablo Eduardo',
    reason:
      'Mesma plataforma ja acende pela origem TMDB (provider_id 2 -> slug apple-tv). ' +
      'Promover duplicaria a linha na tela, com dois creditos de origem diferentes.',
  },
  {
    providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    providerKey: 'hbo',
    decidedOn: '2026-08-19',
    decidedBy: 'Pablo Eduardo',
    reason:
      'Mesma plataforma ja acende pela origem TMDB (provider_id 1899 -> slug max). ' +
      'Hoje esta oferta para antes, em no-canonical-provider (nao ha alias para a chave "hbo"); ' +
      'a decisao fica escrita para que criar o alias nao vire promocao acidental.',
  },
]

/** A origem desta oferta esta retida por decisao? Devolve a decisao ou `null`. */
export function findWithheldDecision(
  providerApi: string | null,
  providerKey: string | null,
): WithheldOfferSource | null {
  if (providerApi === null || providerKey === null) return null
  const api = providerApi.trim()
  const key = providerKey.trim()
  return (
    WITHHELD_OFFER_SOURCES.find(
      (entry) => entry.providerApi === api && entry.providerKey === key,
    ) ?? null
  )
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
  // DECISAO ANTES DE MECANICA. Vem antes de `already-display-allowed` de
  // proposito: uma linha retida que estivesse ACESA e o desfecho mais grave
  // possivel aqui, e reportar "ja exibivel" o esconderia atras de um motivo que
  // soa inofensivo.
  if (findWithheldDecision(candidate.providerApi, candidate.providerKey) !== null) {
    return reject('withheld-by-decision')
  }
  if (candidate.displayAllowed) return reject('already-display-allowed')
  if (!isPromotableOfferType(candidate.offerType)) return reject('invalid-offer-type')
  if (isBlank(candidate.providerKey) || isBlank(candidate.providerName)) {
    return reject('missing-provider')
  }
  // ELO CANONICO. Sem alias nao existe `watch_providers.slug`, e sem slug nao
  // existe a licenca de `watch_availability` nem a decisao `watch_offer_display`
  // que o trigger exige. Antes deste guard a oferta era reportada como
  // ELEGIVEL e so morria como excecao crua de Postgres dentro do laco de
  // promocao — o revisor lia "elegivel" numa linha impossivel de promover.
  if (isBlank(candidate.canonicalProviderSlug)) return reject('no-canonical-provider')
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
