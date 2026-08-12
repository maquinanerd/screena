import type { ReactNode } from "react";

import type { AwardsView } from "../../src/lib/awards-presenter";

/**
 * AwardsBand — a faixa do trofeu do canonico (telas 06 e 07).
 *
 * ============================================================================
 * CONSTRUIDO E NAO RENDERIZADO. Nenhuma pagina importa este componente hoje.
 * ============================================================================
 *
 * Nao ha fonte de premios no sistema:
 *  - a API da TMDB NAO expoe premios (o site tem `/award`, a API v3 nao — nao
 *    ha endpoint nem chave de `append_to_response`). Raspar aquela pagina esta
 *    fora de questao: custaria o acesso a TMDB, que sustenta o catalogo todo;
 *  - a unica fonte plausivel ja no caminho e o campo `Awards` da OMDb, e ele
 *    (a) precisa ser confirmado no payload real, (b) nao e nota — e fato
 *    editorial sobre a obra, com `use_case` PROPRIO, que nao cabe dentro de
 *    `rating_display` — e (c) nenhuma coluna do banco o carrega.
 *
 * O componente existe agora para que a frente de dados saiba EXATAMENTE que
 * forma entregar (`AwardsView`, de `awards-presenter.ts`) — e nao para deixar
 * um bloco bonito e vazio no ar. Ver DESIGN-DELTA.md.
 *
 * `href` e opcional e so vira link quando houver uma pagina de premios de
 * verdade. Sem ela, o resumo e texto — nunca um CTA que nao leva a lugar
 * nenhum.
 */

interface AwardsBandProps {
  view: AwardsView;
  /** Vertical, para o acento da seta (vermelho = filme, verde = serie). */
  vertical: "movie" | "series";
  /** Destino do detalhamento, quando existir. */
  href?: string;
}

export function AwardsBand({ view, vertical, href }: AwardsBandProps): ReactNode {
  // Nem destaque nem contagem: nao ha faixa. (O parser ja recusa esse caso;
  // esta guarda existe porque o componente e publico e pode ser chamado
  // diretamente.)
  if (view.headline === null && view.tally.label === null) return null;

  const tally =
    view.tally.label === null ? null : (
      <span className="awards-band__tally">{view.tally.label}</span>
    );

  return (
    <section aria-labelledby="awards-band-label" className="awards-band" data-vertical={vertical}>
      <span aria-hidden="true" className="awards-band__icon">
        <svg fill="none" height="30" viewBox="0 0 24 24" width="30">
          <path
            d="M8 21h8m-4-4v4m6-17v4a6 6 0 0 1-12 0V4h12ZM6 5H4a3 3 0 0 0 3 3m11-3h2a3 3 0 0 1-3 3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      </span>
      <p className="awards-band__text">
        <span className="awards-band__label" id="awards-band-label">
          Prêmios
        </span>
        {/* VERBATIM da fonte: "Won 3 Oscars" nao vira "Venceu 3 Oscars" — o nome
            do premio e afirmacao factual dela, e traduzir e inventar. */}
        {view.headline !== null ? (
          <span className="awards-band__headline">{view.headline}</span>
        ) : null}
      </p>
      {tally !== null ? (
        href !== undefined ? (
          <a className="awards-band__link" href={href}>
            {tally}
            <svg aria-hidden="true" fill="none" height="17" viewBox="0 0 24 24" width="17">
              <path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </a>
        ) : (
          tally
        )
      ) : null}
    </section>
  );
}
