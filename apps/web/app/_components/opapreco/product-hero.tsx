/**
 * product_hero_v1 — topo da materia, meio da ficha, billboards (SPEC §5.3;
 * referencia `design/product_hero_v1.dc.html`). Imagem ao lado a partir de 600px
 * de container; abaixo, 100% x 300. Sem headline de marketing, sem fundo
 * colorido: o bloco "Preço monitorado pelo OpaPreço" e o unico realce.
 */

import type { ReactNode } from 'react'

import {
  checkedLabel,
  formatBRL,
  hasProvenDiscount,
  isLowestRecent,
  minutesSince,
  offerAriaLabel,
} from '../../../src/lib/opapreco/format'
import {
  DisclosureBadge,
  ExternalArrow,
  OfferImage,
  OfferLink,
  ProvenDiscount,
  Signature,
  eyebrowOf,
} from './offer-parts'
import type { OfferComponentProps } from './product-card'

/** "Preço verificado há 12 min · menor preço dos últimos 30 dias · loja oficial na Shopee" */
export function monitorLine(offer: OfferComponentProps['offer'], now: number): string {
  const parts = [
    checkedLabel(minutesSince(offer.checkedAt, now)),
    isLowestRecent(offer) ? 'menor preço dos últimos 30 dias' : null,
    `${offer.isOfficialStore ? 'loja oficial na ' : ''}${offer.merchant}`,
  ].filter((part): part is string => part !== null)
  const line = parts.join(' · ')
  return line.charAt(0).toUpperCase() + line.slice(1)
}

export function ProductHero({ disabled = false, expiresAt, now, offer, onExpired }: OfferComponentProps): ReactNode {
  const disclosure = offer.affiliateDisclosure ?? 'Link de afiliado'
  return (
    <OfferLink
      ariaLabel={offerAriaLabel(offer, disclosure)}
      className="op-hero"
      component="product_hero_v1"
      disabled={disabled}
      expiresAt={expiresAt}
      offer={offer}
      onExpiredClick={onExpired}
    >
      <OfferImage frame="hero" offer={offer} />
      <span className="op-hero__body">
        <span className="op-head op-head--hero">
          <Signature label={eyebrowOf(offer)} />
          <DisclosureBadge>{disclosure}</DisclosureBadge>
        </span>
        <span className="op-title op-title--hero">{offer.productTitle}</span>
        <span className="op-hero__prices">
          {!disabled && hasProvenDiscount(offer) ? (
            <span className="op-hero__ref">
              <ProvenDiscount offer={offer} />
            </span>
          ) : null}
          <span className="op-price op-price--hero">{formatBRL(offer.currentPrice)}</span>
        </span>
        <span className="op-monitor">
          <span className="op-monitor__title">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 16 16" width="14">
              <path d="M2 12l4-4 3 3 5-6" />
            </svg>
            Preço monitorado pelo OpaPreço
          </span>
          <span>{disabled ? 'Preço deixou de ser válido' : monitorLine(offer, now)}</span>
        </span>
        <span className="op-cta op-cta--primary op-cta--hero">
          {disabled ? 'Oferta indisponível' : (offer.cta ?? `Ver oferta na ${offer.merchant}`)}
          {disabled ? null : <ExternalArrow />}
        </span>
      </span>
    </OfferLink>
  )
}
