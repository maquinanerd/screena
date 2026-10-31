/**
 * product_card_v1 — meio de artigo e lateral (SPEC §5.1; referencia
 * `design/product_card_v1.dc.html`). Horizontal a partir de 480px de CONTAINER;
 * abaixo disso (lateral de 300px, pop-up) fica vertical com imagem 100% x 180.
 */

import type { ReactNode } from 'react'

import { checkedLabel, formatBRL, minutesSince, offerAriaLabel } from '../../../src/lib/opapreco/format'
import type { Offer } from '../../../src/lib/opapreco/types'
import {
  DisclosureBadge,
  ExternalArrow,
  OfferImage,
  OfferLink,
  ProvenDiscount,
  Signature,
  eyebrowOf,
} from './offer-parts'

export interface OfferComponentProps {
  readonly offer: Offer
  /** Agora (ms): a linha "Preço verificado há X min" e relativa a ele. */
  readonly now: number
  /** Oferta vencida depois do render (SPEC §7, estado disabled). */
  readonly disabled?: boolean
  readonly expiresAt?: string | null
  readonly onExpired?: () => void
}

export function ProductCard({ disabled = false, expiresAt, now, offer, onExpired }: OfferComponentProps): ReactNode {
  const disclosure = offer.affiliateDisclosure ?? 'Link de afiliado'
  const meta = disabled
    ? 'Preço deixou de ser válido'
    : `${offer.merchant} · ${checkedLabel(minutesSince(offer.checkedAt, now))}`
  return (
    <OfferLink
      ariaLabel={offerAriaLabel(offer, disclosure)}
      className="op-card"
      component="product_card_v1"
      disabled={disabled}
      expiresAt={expiresAt}
      offer={offer}
      onExpiredClick={onExpired}
    >
      <OfferImage frame="card" offer={offer} showMerchant />
      <span className="op-card__body">
        <span className="op-head">
          <Signature label={eyebrowOf(offer)} />
          <DisclosureBadge>{disclosure}</DisclosureBadge>
        </span>
        <span className="op-title op-title--card">{offer.productTitle}</span>
        <span className="op-prices">
          <span className="op-price op-price--card">{formatBRL(offer.currentPrice)}</span>
          {disabled ? null : <ProvenDiscount offer={offer} />}
        </span>
        <span className="op-card__foot">
          <span className="op-meta op-card__meta">{meta}</span>
          <span className="op-cta op-cta--primary op-card__cta">
            {disabled ? 'Oferta indisponível' : (offer.cta ?? `Ver oferta na ${offer.merchant}`)}
            {disabled ? null : <ExternalArrow />}
          </span>
        </span>
      </span>
    </OfferLink>
  )
}
