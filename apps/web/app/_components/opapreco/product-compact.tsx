/**
 * product_compact_v1 — entre paragrafos, topo de noticias (728x90) e topo da
 * materia no celular (SPEC §5.2; referencia `design/product_compact_v1.dc.html`).
 * Sempre UMA linha, 88px em qualquer largura >= 300px. O preco riscado fica de
 * fora por espaco; o badge de desconto basta.
 */

import type { ReactNode } from 'react'

import { formatBRL, hasProvenDiscount, offerAriaLabel } from '../../../src/lib/opapreco/format'
import { DiscountBadge, OfferImage, OfferLink } from './offer-parts'
import type { OfferComponentProps } from './product-card'

export function ProductCompact({ disabled = false, expiresAt, offer, onExpired }: OfferComponentProps): ReactNode {
  const disclosure = offer.affiliateDisclosure ?? 'Oferta afiliada'
  return (
    <OfferLink
      ariaLabel={offerAriaLabel(offer, disclosure)}
      className="op-compact"
      component="product_compact_v1"
      disabled={disabled}
      expiresAt={expiresAt}
      offer={offer}
      onExpiredClick={onExpired}
    >
      <OfferImage frame="compact" offer={offer} />
      <span className="op-compact__body">
        <span className="op-compact__disclosure">
          {disclosure} · {offer.merchant}
        </span>
        <span className="op-title op-title--compact">{offer.productTitle}</span>
        <span className="op-compact__prices">
          <span className="op-price op-price--sm">{formatBRL(offer.currentPrice)}</span>
          {!disabled && hasProvenDiscount(offer) ? <DiscountBadge percent={offer.discountPercent} /> : null}
        </span>
      </span>
      <span className="op-cta op-cta--secondary op-compact__cta">
        {disabled ? 'Oferta indisponível' : (offer.ctaShort ?? 'Ver oferta')}
      </span>
    </OfferLink>
  )
}
