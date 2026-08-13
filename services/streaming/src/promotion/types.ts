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
  /** Destino NO PROVEDOR. `null` em toda oferta de origem TMDB. */
  readonly deepLink: string | null
  /**
   * Destino no AGREGADOR do pais (`web_url`) — o `link` por pais do payload
   * TMDB, alimentado pelo JustWatch. E o unico destino que a origem TMDB tem, e
   * por isso entra nos guardrails: recusar por `missing-link` uma oferta que TEM
   * destino legitimo seria barrar dado bom por um campo que aquele fornecedor
   * nunca preenche.
   */
  readonly webUrl: string | null
  readonly price: number | null
  readonly currency: string | null
  readonly quality: string | null
  readonly availableUntil: Date | null
  readonly fetchedAt: Date | null
  readonly displayAllowed: boolean
  /** `requires_attribution` da linha (nasce `true` por default no banco). */
  readonly requiresAttribution: boolean
  /** `requires_linkback` da linha (nasce `true` por default no banco). */
  readonly requiresLinkback: boolean
  /** Credito textual JA hidratado na linha; `null` = ainda nao licenciada. */
  readonly attributionText: string | null
  /** Linkback do credito JA hidratado na linha. */
  readonly attributionUrl: string | null
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
  /**
   * A oferta exige credito (`requires_attribution`/`requires_linkback`) e nao o
   * tem hidratado. O trigger do banco ja recusaria — mas com uma EXCECAO, que o
   * laco de promocao engolia num `catch` vazio, e o operador via "0 promovidas"
   * sem motivo. Nomear a recusa aqui transforma um erro mudo numa instrucao:
   * falta rodar `pnpm legal sources apply` para aquele provedor/origem.
   *
   * E o terceiro dos tres negativos independentes que impedem oferta TMDB sem
   * credito de JustWatch de ir ao ar (os outros dois: o gate de escrita e o
   * presenter).
   */
  | 'missing-attribution'
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
