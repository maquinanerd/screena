import type { ReactNode } from "react";

import type { CinerieScoreView } from "../../src/lib/cinerie-score-presenter";

/**
 * CinerieScoreCard — o número do canônico: 47px/800, rótulo "CINERIE SCORE" ao
 * lado, "de 100 · crítica + público" embaixo, e a linha de composição NOMEANDO
 * as fontes (sem ela o número seria afirmação sem lastro).
 *
 * PRESENTACIONAL e PURO: recebe a `CinerieScoreView` que `decideCinerieScore`
 * já aprovou (>= 2 fontes contadas, decisão vigente). Quem decide se este card
 * existe é a página, via o presenter — com menos de duas fontes o card NÃO
 * renderiza e "AVALIAÇÕES" sobe para o topo do cartão (os dois arranjos são
 * provados por teste).
 *
 * NUNCA estrela, tomate, ou cor que imite a escala de outra marca — o acento é
 * o da vertical (via `data-vertical` do `<main>`).
 */

interface CinerieScoreCardProps {
  readonly view: CinerieScoreView;
}

export function CinerieScoreCard({ view }: CinerieScoreCardProps): ReactNode {
  return (
    <div className="score-card" data-cinerie-score-sources={view.sources.join(",")}>
      <div className="score-card__row">
        <span className="score-card__value">{view.value}</span>
        <span className="score-card__label">Cinerie Score</span>
        <span className="score-card__scale">de {view.scale} · crítica + público</span>
      </div>
      <p className="score-card__composition">{view.compositionLine}</p>
    </div>
  );
}
