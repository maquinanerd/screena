/**
 * Skeleton de cada componente: a MESMA geometria e a mesma reserva do anuncio
 * que vem (SPEC §7, estado loading). Blocos `#EEEEEE`; o pulso some com
 * `prefers-reduced-motion`. Nunca infinito: o slot colapsa em 1,5 s sem resposta.
 */

import type { ReactNode } from 'react'

import type { OpComponentName } from '../../../src/lib/opapreco/slots'

function Bar({ className }: { className: string }): ReactNode {
  return <span className={`op-sk op-sk--bar ${className}`} />
}

export function AdSkeleton({ component }: { component: OpComponentName }): ReactNode {
  switch (component) {
    case 'product_grid_v1':
      return (
        // Mesma geometria da grade real, pelas MESMAS container queries:
        // cabecalho em 1 ou 2 linhas, 2 ou 4 colunas e celula com o preco ao
        // lado ou embaixo do desconto. A altura do skeleton E a reserva.
        <span aria-hidden="true" className="op-skeleton op-skeleton--grid">
          <span className="op-skeleton__grid-head">
            <Bar className="op-sk--w40 op-sk--h18" />
          </span>
          <span className="op-grid__list op-skeleton__cells">
            {[0, 1, 2, 3].map((index) => (
              <span className="op-sk op-skeleton__cell" key={index}>
                <span className="op-skeleton__cell-fill" />
              </span>
            ))}
          </span>
          <span className="op-skeleton__grid-foot" />
        </span>
      )
    case 'product_compact_v1':
      return (
        <span aria-hidden="true" className="op-skeleton op-skeleton--compact">
          <span className="op-sk op-skeleton__thumb56" />
          <span className="op-skeleton__col">
            <Bar className="op-sk--w70 op-sk--h12" />
            <Bar className="op-sk--w30 op-sk--h18" />
          </span>
          <span className="op-sk op-skeleton__cta96" />
        </span>
      )
    case 'product_hero_v1':
      return (
        <span aria-hidden="true" className="op-skeleton op-skeleton--hero">
          <span className="op-sk op-skeleton__hero-img" />
          <span className="op-skeleton__col op-skeleton__hero-body">
            <Bar className="op-sk--w50 op-sk--h12" />
            <Bar className="op-sk--w90 op-sk--h18" />
            <Bar className="op-sk--w40 op-sk--h32" />
            <span className="op-sk op-skeleton__monitor" />
            <span className="op-sk op-skeleton__cta48" />
          </span>
        </span>
      )
    case 'contextual_recommendation_v1':
      return (
        <span aria-hidden="true" className="op-skeleton op-skeleton--ctx">
          <Bar className="op-sk--w35 op-sk--h12" />
          <Bar className="op-sk--w70 op-sk--h20" />
          <span className="op-sk op-skeleton__ctx-row" />
        </span>
      )
    case 'price_drop_v1':
      return (
        <span aria-hidden="true" className="op-skeleton op-skeleton--drop">
          <Bar className="op-sk--w30 op-sk--h14" />
          <span className="op-skeleton__row">
            <span className="op-sk op-skeleton__thumb120" />
            <span className="op-skeleton__col op-skeleton__grow">
              <Bar className="op-sk--w85 op-sk--h16" />
              <Bar className="op-sk--w40 op-sk--h28" />
              <span className="op-sk op-skeleton__cta44" />
            </span>
          </span>
        </span>
      )
    case 'product_card_v1':
      return (
        <span aria-hidden="true" className="op-skeleton op-skeleton--card">
          <span className="op-sk op-skeleton__card-img" />
          <span className="op-skeleton__col op-skeleton__card-body">
            <Bar className="op-sk--w45 op-sk--h12" />
            <Bar className="op-sk--w90 op-sk--h16" />
            <Bar className="op-sk--w60 op-sk--h16" />
            <Bar className="op-sk--w35 op-sk--h26" />
            <span className="op-sk op-skeleton__cta44 op-skeleton__card-cta" />
          </span>
        </span>
      )
  }
}
