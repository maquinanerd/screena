/**
 * price_drop_v1 — queda de preco COMPROVADA (SPEC §5.5; referencia
 * `design/price_drop_v1.dc.html`). A queda e dita por texto + seta + preco
 * riscado, nunca so por cor; sem vermelho, sem fundo colorido. No maximo um por
 * pagina (so `article-inline-02` o aceita). Sem queda valida nao renderiza.
 */

import type { ReactNode } from 'react'

import { checkedLabel, formatBRL, minutesSince } from '../../../src/lib/opapreco/format'
import { DisclosureBadge, ExternalArrow, OfferImage, OfferLink, ReferencePrice } from './offer-parts'
import type { OfferComponentProps } from './product-card'

export function PriceDrop({ disabled = false, expiresAt, now, offer, onExpired }: OfferComponentProps): ReactNode {
  const drop = offer.priceDrop
  if (drop === null || !(drop.from > offer.currentPrice) || drop.percent < 5) return null
  const disclosure = offer.affiliateDisclosure ?? 'Link de afiliado'
  const ariaLabel =
    `Preço caiu ${drop.percent}%: ${offer.productTitle}, de ${formatBRL(drop.from)} ` +
    `por ${formatBRL(offer.currentPrice)} na ${offer.merchant}. ${disclosure}`
  return (
    <OfferLink
      ariaLabel={ariaLabel}
      className="op-drop"
      component="price_drop_v1"
      disabled={disabled}
      expiresAt={expiresAt}
      offer={offer}
      onExpiredClick={onExpired}
    >
      <span className="op-head op-head--drop">
        <span className="op-drop__line">
          <span className="op-drop__label">
            <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16" width="14">
              <path d="M8 3v10M4 9l4 4 4-4" />
            </svg>
            Preço caiu {drop.percent}%
          </span>
          <span aria-hidden="true" className="op-sig__rule" />
          <span className="op-drop__since">
            <span className="op-sig__brand">OpaPreço</span>{' '}
            {drop.since !== null ? `registrou a queda ${drop.since}` : 'registrou a queda'}
          </span>
        </span>
        <DisclosureBadge>{disclosure}</DisclosureBadge>
      </span>
      <span className="op-drop__row">
        <OfferImage frame="drop" offer={offer} />
        <span className="op-drop__body">
          <span className="op-title op-title--drop">{offer.productTitle}</span>
          <span className="op-drop__prices">
            <span className="op-drop__from">
              de <ReferencePrice label="Preço anterior" value={drop.from} />
            </span>
            <span className="op-drop__from">
              por <span className="op-price op-price--drop">{formatBRL(offer.currentPrice)}</span>
            </span>
          </span>
          <span className="op-meta">
            {disabled
              ? 'Preço deixou de ser válido'
              : `${offer.merchant} · ${checkedLabel(minutesSince(offer.checkedAt, now))}`}
          </span>
          <span className="op-cta op-cta--primary op-drop__cta">
            {disabled ? 'Oferta indisponível' : (offer.cta ?? 'Conferir preço')}
            {disabled ? null : <ExternalArrow />}
          </span>
        </span>
      </span>
    </OfferLink>
  )
}
