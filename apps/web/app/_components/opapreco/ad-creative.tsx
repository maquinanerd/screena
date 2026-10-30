/**
 * Decisao validada -> componente. Um switch, sem logica de exibicao: as regras
 * ja rodaram em `normalize.ts`, e cada componente cuida das proprias.
 */

import type { ReactNode } from 'react'

import type { AdDecision } from '../../../src/lib/opapreco/types'
import { ContextualRecommendation } from './contextual-recommendation'
import { PriceDrop } from './price-drop'
import { ProductCard } from './product-card'
import { ProductCompact } from './product-compact'
import { ProductGrid } from './product-grid'
import { ProductHero } from './product-hero'

export interface AdCreativeProps {
  readonly decision: AdDecision
  readonly now: number
  /** A oferta (ou a grade inteira) venceu depois do render. */
  readonly expired?: boolean
  readonly onExpired?: () => void
}

export function AdCreative({ decision, expired = false, now, onExpired }: AdCreativeProps): ReactNode {
  const common = { disabled: expired, expiresAt: decision.expiresAt, now, onExpired }
  switch (decision.component) {
    case 'product_grid_v1':
      return (
        <ProductGrid
          disabledIds={expired ? new Set(decision.offers.map((offer) => offer.offerId)) : undefined}
          expiresAt={decision.expiresAt}
          heading={decision.heading}
          now={now}
          offers={decision.offers}
          onExpired={onExpired}
        />
      )
    case 'contextual_recommendation_v1':
      return (
        <ContextualRecommendation
          {...common}
          context={decision.context}
          contextNote={decision.contextNote}
          offer={decision.offer}
        />
      )
    case 'product_card_v1':
      return <ProductCard {...common} offer={decision.offer} />
    case 'product_compact_v1':
      return <ProductCompact {...common} offer={decision.offer} />
    case 'product_hero_v1':
      return <ProductHero {...common} offer={decision.offer} />
    case 'price_drop_v1':
      return <PriceDrop {...common} offer={decision.offer} />
  }
}
