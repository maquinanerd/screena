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
 * de avaliacoes. Vertical NUNCA so por cor (invariante 11): cada card carrega o
 * rotulo "Filme", o atributo de tipo e a URL `/pt/filmes/`.
 */

import type { ReactNode } from 'react'

import { Rail } from './rail'
import type { SimilarTitlesView } from '../../src/lib/similar-titles-presenter'

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
          <span className="similar-titles__relation-kicker">Mesma coleção</span>
          <span className="similar-titles__relation-name">{view.relationLabel}</span>
        </p>
      </div>
      <Rail className="similar-titles__track" label="Mais como este">
        {view.items.map((item) => (
          <a
            className="similar-card"
            data-entity-type="movie"
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
              <span className="similar-card__type">Filme</span>
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
