/**
 * contextual_recommendation_v1 — o formato prioritario, depois do 2o/3o
 * paragrafo da materia (SPEC §5.6; referencia
 * `design/contextual_recommendation_v1.dc.html`).
 *
 * `<aside>` sem caixa: regua de 2px em cima, 1px embaixo, sem padding lateral
 * (alinha com o texto). O contexto vem das tags da materia, nunca como opiniao
 * do autor. A linha de produto e o UNICO link (um tab stop).
 */

import type { ReactNode } from 'react'

import { checkedLabel, formatBRL, minutesSince, offerAriaLabel } from '../../../src/lib/opapreco/format'
import { ExternalArrow, OfferImage, OfferLink, ProvenDiscount } from './offer-parts'
import type { OfferComponentProps } from './product-card'

export interface ContextualRecommendationProps extends OfferComponentProps {
  readonly context: string
  readonly contextNote: string | null
}

export function ContextualRecommendation({
  context,
  contextNote,
  disabled = false,
  expiresAt,
  now,
  offer,
  onExpired,
}: ContextualRecommendationProps): ReactNode {
  if (context.trim() === '') return null
  const disclosure = offer.affiliateDisclosure ?? 'Oferta afiliada'
  return (
    <aside aria-label={disclosure} className="op-ctx" data-ad-component="contextual_recommendation_v1">
      <span className="op-ctx__top">
        <span className="op-ctx__label">{disclosure}</span>
        <span className="op-ctx__by">
          Selecionada pelo <span className="op-sig__brand">OpaPreço</span>
        </span>
      </span>
      <span className="op-ctx__context">{context}</span>
      {contextNote !== null ? <span className="op-ctx__note">{contextNote}</span> : null}
      <OfferLink
        ariaLabel={offerAriaLabel(offer, disclosure)}
        className="op-ctx__row"
        component="contextual_recommendation_v1"
        disabled={disabled}
        expiresAt={expiresAt}
        offer={offer}
        onExpiredClick={onExpired}
      >
        <span className="op-ctx__product">
          <OfferImage frame="context" offer={offer} />
          <span className="op-ctx__info">
            <span className="op-title op-title--sm">{offer.productTitle}</span>
            <span className="op-prices">
              <span className="op-price op-price--ctx">{formatBRL(offer.currentPrice)}</span>
              {disabled ? null : <ProvenDiscount offer={offer} />}
            </span>
            <span className="op-meta">
              {disabled
                ? 'Preço deixou de ser válido'
                : `${offer.merchant} · ${checkedLabel(minutesSince(offer.checkedAt, now), false)}`}
            </span>
          </span>
        </span>
        <span className="op-cta op-cta--primary op-ctx__cta">
          {disabled ? 'Oferta indisponível' : (offer.cta ?? `Ver oferta na ${offer.merchant}`)}
          {disabled ? null : <ExternalArrow />}
        </span>
      </OfferLink>
    </aside>
  )
}
