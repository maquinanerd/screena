/**
 * types.ts — Tipos do CLI de revisao/promocao de `watch_availability`. PURO.
 *
 * Este modulo NAO toca rede, banco nem RapidAPI. Ele so descreve a forma de uma
 * oferta candidata a promocao (o subconjunto de colunas que os guardrails
 * inspecionam) e o vocabulario de decisao/recusa.
 *
 * Escopo governado (invariante 6 + termos do provider): a promocao apenas vira o
 * gate `display_allowed` de `false` para `true` em ofertas ja gravadas do
 * fornecedor `streaming_availability`, pais BR. Nunca cria linha, nunca toca
 * outro provider, nunca encosta em ratings/screen_score.
 */

/**
 * Modalidades LEGAIS que podem ser promovidas.
 *
 * O `enum OfferType` do schema tem `subscription`, `rent`, `buy`, `free`, `ads`
 * e `cinema`. Apenas as quatro primeiras sao promoveis aqui (as unicas
 * produzidas pela ingestao de streaming). `ads`/`cinema` — e qualquer valor
 * fora desta lista, inclusive um eventual `addon` — sao recusados com
 * `invalid-offer-type`, nunca promovidos.
 */
export const PROMOTABLE_OFFER_TYPES = ['subscription', 'free', 'rent', 'buy'] as const

/** Modalidade promovel derivada. */
export type PromotableOfferType = (typeof PROMOTABLE_OFFER_TYPES)[number]

/** `value` e uma modalidade promovel? */
export function isPromotableOfferType(value: unknown): value is PromotableOfferType {
  return (
    typeof value === 'string' &&
    (PROMOTABLE_OFFER_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Uma oferta candidata: o subconjunto de `watch_availability` que os guardrails
 * e o relatorio precisam. `id`/`entityId` sao BigInt serializados como string
 * (nunca vaza BigInt para o relatorio JSON).
 */
export interface PromotionCandidate {
  readonly id: string
  /** `movie` | `tv` (nunca season/episode/person nesta fase). */
  readonly entityType: string
  readonly entityId: string
  /** Titulo original da entidade, quando facil de obter; senao `null`. */
  readonly title: string | null
  readonly countryCode: string
  readonly providerApi: string | null
  readonly providerKey: string | null
  readonly providerName: string | null
  readonly offerType: string | null
  readonly deepLink: string | null
  readonly price: number | null
  readonly currency: string | null
  readonly quality: string | null
  readonly availableUntil: Date | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
}

/**
 * Motivos de recusa de uma promocao. Espelha exatamente os guardrails exigidos:
 * fornecedor errado, pais errado, ja exibivel, modalidade invalida, provider
 * incompleto, sem link, link inseguro, oferta vencida.
 */
export type PromotionRejectionReason =
  | 'wrong-provider'
  | 'wrong-country'
  | 'already-display-allowed'
  | 'invalid-offer-type'
  | 'missing-provider'
  | 'missing-link'
  | 'unsafe-link'
  | 'expired'

/** Motivos de recusa de uma reversao (revoke). */
export type RevocationRejectionReason = 'wrong-provider' | 'already-disallowed'

/** Decisao sobre uma promocao. */
export interface PromotionEvaluation {
  readonly eligible: boolean
  readonly reason: PromotionRejectionReason | null
}

/** Decisao sobre uma reversao. */
export interface RevocationEvaluation {
  readonly eligible: boolean
  readonly reason: RevocationRejectionReason | null
}
