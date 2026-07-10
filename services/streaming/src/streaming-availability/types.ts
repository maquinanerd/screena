/**
 * types.ts — Tipos do worker de disponibilidade. Modulo PURO.
 */

import type { StreamingAvailabilityKind } from '@screena/streaming-availability-client'

/** Entidades suportadas nesta fase (nunca pessoa/temporada/episodio). */
export type StreamingEntityType = StreamingAvailabilityKind

/**
 * Modalidades LEGAIS aceitas no schema (`enum OfferType`).
 *
 * `ads` e `cinema` existem no enum mas nao sao produzidos por esta API.
 */
export const OFFER_TYPES = ['subscription', 'rent', 'buy', 'free', 'ads', 'cinema'] as const

/** Tipo derivado de uma modalidade valida. */
export type OfferType = (typeof OFFER_TYPES)[number]

/**
 * Mapa `StreamingOptionType` (upstream) -> `OfferType` (nosso enum).
 *
 * `addon` NAO tem destino. Um addon e uma camada PAGA dentro de outro servico
 * (ex.: um canal via Prime): nao e uma assinatura simples. Mapea-lo para
 * `subscription` afirmaria uma modalidade comercial FALSA ao usuario. Por isso e
 * DESCARTADO e contado como `unmapped:addon` no relatorio, ate que uma fase
 * futura o modele com migration propria e decisao de produto.
 */
export const OFFER_TYPE_BY_UPSTREAM: Readonly<Record<string, OfferType>> = {
  subscription: 'subscription',
  rent: 'rent',
  buy: 'buy',
  free: 'free',
}

/** Uma oferta pronta para `watch_availability` (entidade ja resolvida). */
export interface WatchOfferRow {
  readonly entityType: StreamingEntityType
  /** Id local (BigInt serializado como string). */
  readonly entityId: string
  /** ISO 3166-1 alpha-2, MAIUSCULO (FK -> countries.code). */
  readonly countryCode: string
  readonly providerKey: string | null
  readonly providerName: string
  readonly offerType: OfferType
  readonly deepLink: string | null
  /** `null` quando o preco nao e confiavel; `currency` acompanha (CHECK do schema). */
  readonly price: number | null
  readonly currency: string | null
  readonly quality: string | null
  readonly availableFrom: Date | null
  readonly availableUntil: Date | null
}

/** Motivos de recusa de uma oferta. */
export type OfferRejectionReason =
  | 'payload-not-object'
  | 'show-type-mismatch'
  | 'identity-mismatch'
  /**
   * `streamingOptions` ausente/null/em formato invalido. NAO e o mesmo que
   * "nao ha oferta neste pais": e um corpo anomalo (truncado, contrato mudado),
   * do qual nao se aprende nada. Torna o payload NAO reconhecido, para que o
   * replace nunca apague um snapshot bom.
   */
  | 'missing-streaming-options'
  /** `streamingOptions` existe, mas nao ha chave para o pais pedido. */
  | 'country-absent'
  | 'offer-not-object'
  | 'unmapped-offer-type'
  | 'missing-provider-name'
  | 'unsafe-deep-link'

/** Uma recusa, com detalhe legivel (sem segredo, sem payload cru). */
export interface OfferRejection {
  readonly reason: OfferRejectionReason
  readonly detail: string
}

/** Resultado do reconhecimento de um payload de `/shows/{id}`. */
export interface ShowMapping {
  /** `false` quando o payload nem e um show utilizavel. */
  readonly recognized: boolean
  readonly offers: readonly WatchOfferRow[]
  readonly rejections: readonly OfferRejection[]
}

/** Uma entidade local selecionada para consulta. */
export interface SelectedEntity {
  readonly entityType: StreamingEntityType
  /** Id local (BigInt serializado como string). */
  readonly entityId: string
  readonly tmdbId: number
  readonly imdbId: string | null
}
