import type { ReactNode } from "react";

import { CINERIE_SCORE_LOGO } from "../../src/lib/brand-logos";
import type { CinerieScoreView } from "../../src/lib/cinerie-score-presenter";
import { SCORE_METHODOLOGY_PATH } from "../../src/lib/routes";

/**
 * CinerieScoreCard — a coluna do Score no topo das fichas (canônico de
 * 2026-10-30): a MARCA "cinérie score" com "(crítica + público)" ao lado e,
 * abaixo, a caixa branca com o número no acento da vertical, "/100" e a linha
 * de composição NOMEANDO as fontes (sem ela o número seria afirmação sem lastro).
 *
 * O canônico escreve "de 12.480 avaliações." e "Avaliar agora ›" dentro da
 * caixa. Nenhum dos dois tem dado: o Score é composto de notas EXTERNAS, não de
 * votos de usuário, e não existe contagem de avaliações para mostrar. No lugar
 * ficam a composição real e o link para a conta inteira ("Como é calculado").
 *
 * A marca é a arte entregue pelo proprietário em 2026-09-11 (degradê, versão
 * única — ver `src/lib/brand-logos.ts`); o nome continua no documento pelo
 * `alt`.
 *
 * PRESENTACIONAL e PURO: recebe a `CinerieScoreView` que `decideCinerieScore`
 * já aprovou (>= 2 fontes contadas, decisão vigente). Quem decide se este card
 * existe é a página, via o presenter — com menos de duas fontes ele NÃO
 * renderiza e a linha de notas externas ocupa a coluna sozinha.
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
      <div className="score-card__head">
        <img
          alt="Cinerie Score"
          className="score-card__logo"
          decoding="async"
          fetchPriority="low"
          height={CINERIE_SCORE_LOGO.height}
          src={CINERIE_SCORE_LOGO.src}
          width={CINERIE_SCORE_LOGO.width}
        />
        <span className="score-card__basis">(crítica + público)</span>
      </div>
      <div className="score-card__box">
        <p className="score-card__number">
          <span className="score-card__value">{view.value}</span>
          <span className="score-card__scale">/{view.scale}</span>
        </p>
        <div className="score-card__detail">
          {/* A composição nomeia as fontes; o link leva à conta inteira
              (`/pt/cinerie-score/`) — o número nunca fica sem explicação. */}
          <p className="score-card__composition">{view.compositionLine}</p>
          <a className="score-card__method" href={SCORE_METHODOLOGY_PATH}>
            Como é calculado ›
          </a>
        </div>
      </div>
    </div>
  );
}
