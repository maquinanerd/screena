/**
 * similar-titles.tsx — "Mais como este" (coluna direita da faixa final das
 * telas 06/07 do canonico).
 *
 * A relacao aparece NA TELA ("Mesma coleção" + nome da colecao) porque o bloco
 * so tem um dataset e ele e mais estreito que o titulo canonico sugere. Sem
 * essa linha, "Mais como este" prometeria similaridade e entregaria franquia.
 *
 * Nada de nota no card: o canonico desenha uma estrela com valor por poster, e
 * nao ha nota propria nem licenca para reexibir nota de terceiro fora do painel
 * de avaliacoes.
 *
 * ============ VERTICAL NUNCA SO POR COR, E NUNCA CRAVADA ============
 *
 * Cada card carrega rotulo + `data-entity-type` + URL coerentes (invariante 11),
 * e os TRES vem de `item.entityType`. Ate 2026-08-28 os tres estavam cravados em
 * `movie`/"Filme"/`/pt/filmes/` — o que era invisivel na ficha de filme (os
 * recomendados de um filme sao filmes) e mandava TODO card de TODA ficha de
 * serie para `/pt/filmes/`, em 32.889 paginas indexaveis. Era o unico
 * `data-entity-type` cravado do `apps/web`; todos os outros componentes ja o
 * recebiam do dado.
 */

import type { ReactNode } from 'react'

import { Rail } from './rail'
import type { SimilarTitlesView } from '../../src/lib/similar-titles-presenter'

/** O rotulo humano de cada vertical. Vocabulario FECHADO. */
const TYPE_LABEL = { movie: 'Filme', tv: 'Série' } as const

export function SimilarTitles({
  headingId,
  view,
}: {
  headingId: string
  view: SimilarTitlesView
}): ReactNode {
  return (
    <div className="similar-titles">
      <div className="similar-titles__head">
        <h2 className="detail-section-title detail-section-title--sm" id={headingId}>
          Mais <span className="thin">como este</span>
        </h2>
        <p className="similar-titles__relation">
          <span className="similar-titles__relation-kicker">{view.relationKicker}</span>
          <span className="similar-titles__relation-name">{view.relationLabel}</span>
        </p>
      </div>
      <Rail className="similar-titles__track" label="Mais como este">
        {view.items.map((item) => (
          <a
            className="similar-card"
            data-entity-type={item.entityType}
            href={item.href}
            key={item.entityId}
          >
            <span className="similar-card__poster">
              {item.poster !== null ? (
                <img
                  alt=""
                  height={item.poster.height}
                  loading="lazy"
                  src={item.poster.src}
                  width={item.poster.width}
                />
              ) : null}
              <span className="similar-card__type">{TYPE_LABEL[item.entityType]}</span>
            </span>
            <span className="similar-card__title">{item.title}</span>
            {item.year !== null ? (
              <span className="similar-card__year">{item.year}</span>
            ) : null}
          </a>
        ))}
      </Rail>
    </div>
  )
}
