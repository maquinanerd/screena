import type { ReactNode } from "react";

import type { RatingsPanelView } from "../../src/lib/ratings-presenter";

/**
 * RatingsPanel — painel "Notas da crítica e do público" das paginas de detalhe
 * (filme/serie).
 *
 * PRESENTACIONAL e PURO: recebe a `RatingsPanelView` ja montada pelo presenter
 * (`ratings-presenter.ts`) e so produz JSX. Nao importa @screena/db nem faz IO
 * (invariantes 3/4).
 *
 * Governanca:
 *  - Cada nota aparece com a FONTE em texto, a natureza (Crítica/Público) e a
 *    ESCALA junto do numero ("92/100"). Nunca um numero solto, nunca conversao
 *    entre fontes (invariante 1).
 *  - Credito da fonte SEMPRE visivel junto da nota (a view ja descartou nota
 *    sem atribuicao). O fornecedor tecnico nunca e citado (invariante 2).
 *  - NUNCA renderiza logo/imagem de fonte (`logo_allowed = false` para todas).
 *  - NUNCA emite media propria/"Cinerie Score": este painel so reexibe nota de
 *    terceiro creditada. O JSON-LD tambem nao ganha AggregateRating por conta
 *    deste painel.
 */

interface RatingsPanelProps {
  /** View ja filtrada/creditada pelo presenter; `null` quando nao ha nota. */
  view: RatingsPanelView | null;
}

export function RatingsPanel({ view }: RatingsPanelProps): ReactNode {
  if (view === null || view.items.length === 0) return null;

  return (
    <section className="ratings" aria-labelledby="ratings-title">
      <h2 id="ratings-title" className="ratings__title">
        Notas da crítica e do público
      </h2>
      <p className="ratings__note">
        Cada nota é exibida na escala da própria fonte e não é comparável entre
        fontes.
      </p>

      <ul className="ratings__list">
        {view.items.map((item) => (
          <li
            key={`${item.sourceKey}:${item.scoreType}:${item.metricLabel}`}
            className="ratings__item"
            data-rating-source={item.sourceKey}
            data-score-type={item.scoreType}
          >
            <span className="ratings__source">{item.sourceLabel}</span>
            <span className="ratings__score-type">{item.scoreTypeLabel}</span>
            <span className="ratings__metric">{item.metricLabel}</span>
            {/* Valor e escala juntos: "92/100" nunca vira "92%". */}
            <span className="ratings__score">{item.scoreLabel}</span>
            {item.countLabel !== null ? (
              <span className="ratings__count">{item.countLabel} votos</span>
            ) : null}
            <span className="ratings__attribution">
              {item.attribution.url !== null ? (
                <a
                  className="ratings__attribution-link"
                  href={item.attribution.url}
                  rel="nofollow noopener"
                  target="_blank"
                >
                  {item.attribution.text}
                </a>
              ) : (
                item.attribution.text
              )}
            </span>
          </li>
        ))}
      </ul>

      {view.updatedAtLabel !== null ? (
        <p className="ratings__updated">{view.updatedAtLabel}</p>
      ) : null}
    </section>
  );
}
