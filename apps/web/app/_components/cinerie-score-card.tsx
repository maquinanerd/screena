import type { ReactNode } from "react";

import { CINERIE_SCORE_LOGO } from "../../src/lib/brand-logos";
import type { CinerieScoreView } from "../../src/lib/cinerie-score-presenter";
import { SCORE_METHODOLOGY_PATH } from "../../src/lib/routes";

/**
 * CinerieScoreCard — o número do canônico: 47px/800, a MARCA "cinérie score" ao
 * lado, "de 100 · crítica + público" embaixo, e a linha de composição NOMEANDO
 * as fontes (sem ela o número seria afirmação sem lastro).
 *
 * A marca é a arte entregue pelo proprietário em 2026-09-11 (degradê, versão
 * única — ver `src/lib/brand-logos.ts`). Ela SUBSTITUIU o rótulo em texto
 * "CINERIE SCORE", e o nome continua no documento pelo `alt`: leitor de tela
 * ouve "86, Cinerie Score, de 100".
 *
 * PRESENTACIONAL e PURO: recebe a `CinerieScoreView` que `decideCinerieScore`
 * já aprovou (>= 2 fontes contadas, decisão vigente). Quem decide se este card
 * existe é a página, via o presenter — com menos de duas fontes o card NÃO
 * renderiza e "AVALIAÇÕES" sobe para o topo do cartão (os dois arranjos são
 * provados por teste).
 *
 * NUNCA estrela, tomate, ou cor que imite a escala de outra marca. O degradê é
 * da PRÓPRIA marca Cinerie Score, não uma régua de nota.
 */

interface CinerieScoreCardProps {
  readonly view: CinerieScoreView;
}

export function CinerieScoreCard({ view }: CinerieScoreCardProps): ReactNode {
  return (
    <div className="score-card" data-cinerie-score-sources={view.sources.join(",")}>
      <div className="score-card__row">
        <span className="score-card__value">{view.value}</span>
        <span className="score-card__label">
          <img
            alt="Cinerie Score"
            className="score-card__logo"
            decoding="async"
            fetchPriority="low"
            height={CINERIE_SCORE_LOGO.height}
            src={CINERIE_SCORE_LOGO.src}
            width={CINERIE_SCORE_LOGO.width}
          />
        </span>
        <span className="score-card__scale">de {view.scale} · crítica + público</span>
      </div>
      {/* A composição nomeia as fontes; o link leva à conta inteira
          (`/pt/cinerie-score/`) — o número nunca fica sem explicação. */}
      <p className="score-card__composition">
        {view.compositionLine}{" "}
        <a className="score-card__method" href={SCORE_METHODOLOGY_PATH}>
          Como é calculado
        </a>
      </p>
    </div>
  );
}
