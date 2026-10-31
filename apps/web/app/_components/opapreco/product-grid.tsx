/**
 * product_grid_v1 — grade de 2 a 4 ofertas entre secoes e no fim da materia
 * (SPEC §5.4; referencia `design/product_grid_v1.dc.html`).
 *
 * DIVERGENCIA APROVADA PELO PUBLISHER (docs/opapreco/DECISIONS.md, 2026-10-30):
 * colunas `repeat(auto-fit, minmax(150px, 1fr))` — os itens ocupam a largura
 * toda do container em vez de deixar coluna vazia — e quadro de imagem
 * `clamp(140px, 16vw, 220px)`. Celular em 2 colunas, nunca carrossel (carrossel
 * esconde oferta e o disclosure). Menos de 2 ofertas: nao renderiza.
 */

import type { ReactNode } from 'react'

import { formatBRL, hasProvenDiscount, minutesSince, offerAriaLabel } from '../../../src/lib/opapreco/format'
import type { Offer } from '../../../src/lib/opapreco/types'
import { DiscountBadge, OfferImage, OfferLink } from './offer-parts'

export interface ProductGridProps {
  readonly offers: readonly Offer[]
  readonly heading: string | null
  readonly now: number
  /** Ofertas vencidas depois do render (por `offerId`). */
  readonly disabledIds?: ReadonlySet<string>
  readonly expiresAt?: string | null
  readonly onExpired?: () => void
}

/** "Preços na Shopee, verificados há até 14 min." */
export function gridFootLine(offers: readonly Offer[], now: number): string {
  const merchant = offers[0]?.merchant ?? 'Shopee'
  if (offers.length === 0) return `Preços na ${merchant}.`
  const oldest = Math.max(...offers.map((offer) => minutesSince(offer.checkedAt, now)))
  if (oldest < 1) return `Preços na ${merchant}, verificados agora.`
  if (oldest < 60) return `Preços na ${merchant}, verificados há até ${oldest} min.`
  return `Preços na ${merchant}, verificados há até ${Math.round(oldest / 60)} h.`
}

export function ProductGrid({ disabledIds, expiresAt, heading, now, offers, onExpired }: ProductGridProps): ReactNode {
  const items = offers.slice(0, 4)
  if (items.length < 2) return null
  const title = heading ?? 'Ofertas relacionadas'
  const disclosure = 'Links de afiliado'
  return (
    <section aria-label={`${title}. ${disclosure}`} className="op-grid" data-ad-component="product_grid_v1">
      <div className="op-grid__head">
        <span className="op-grid__heading">{title}</span>
        <span className="op-grid__disclosure">
          <span className="op-sig__brand">OpaPreço</span> · {disclosure}
        </span>
      </div>
      <ul className="op-grid__list">
        {items.map((offer) => {
          const disabled = disabledIds?.has(offer.offerId) ?? false
          return (
            <li className="op-grid__cell" key={offer.offerId}>
              <OfferLink
                ariaLabel={offerAriaLabel(offer, 'Link de afiliado')}
                className="op-grid__item"
                component="product_grid_v1"
                disabled={disabled}
                expiresAt={expiresAt}
                offer={offer}
                onExpiredClick={onExpired}
              >
                <OfferImage frame="grid" offer={offer} />
                <span className="op-title op-title--grid">{offer.productTitle}</span>
                <span className="op-grid__prices">
                  <span className="op-price op-price--sm">{formatBRL(offer.currentPrice)}</span>
                  {!disabled && hasProvenDiscount(offer) ? <DiscountBadge percent={offer.discountPercent} /> : null}
                </span>
                <span className="op-cta op-cta--secondary op-grid__cta">
                  {disabled ? 'Oferta indisponível' : (offer.ctaShort ?? 'Ver oferta')}
                </span>
              </OfferLink>
            </li>
          )
        })}
      </ul>
      <span className="op-meta">{gridFootLine(items, now)}</span>
    </section>
  )
}
