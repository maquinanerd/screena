import type { ReactNode } from "react";

import type { AwardsCredit, AwardsView } from "../../src/lib/awards-presenter";

export type { AwardsCredit };

/**
 * AwardsBand — a faixa do trofeu do canonico (telas 06 e 07).
 *
 * ESTADO: LIGADO. A faixa e importada pelo detalhe de filme e de serie, dentro
 * de um `<SectionBoundary>`. Ela so aparece quando existe `entity_awards` com
 * `display_allowed = true` para o titulo; sem isso o bloco sai do DOM e o
 * motivo vai para log (`no_awards_source`).
 *
 * O DADO. O literal `Awards` da OMDb, promovido de `api_cache` para
 * `entity_awards` pelo worker offline e reconhecido por
 * `@screena/schemas` (`parseOmdbAwards`). O render nunca chama a OMDb
 * (invariante 3) e nunca interpreta a frase por conta propria.
 *
 * A TRADUCAO. O NOME do premio sai VERBATIM da fonte ("Oscars", "Primetime
 * Emmys"); a ESTRUTURA da frase e pt-BR ("Venceu 4 Oscars"). Quem compoe e
 * `awards-presenter.ts` — este componente so escreve o que recebe.
 *
 * O CREDITO FICA AQUI DENTRO, e isso e condicao de licenca, nao decoracao:
 * a atribuicao pertence ao MESMO bloco visual do fato, como nos chips de nota.
 * Sem `credit.text` a faixa NAO renderiza — mesma trava, mesmo motivo que
 * `ratings-presenter.ts`. Nunca existe faixa sem credito.
 *
 * `href` e opcional e so vira link quando houver uma pagina de premios de
 * verdade. Sem ela, o resumo e texto — nunca um CTA que nao leva a lugar
 * nenhum.
 */

interface AwardsBandProps {
  view: AwardsView;
  credit: AwardsCredit;
  /** Vertical, para o acento da seta (vermelho = filme, verde = serie). */
  vertical: "movie" | "series";
  /** Destino do detalhamento, quando existir. */
  href?: string;
}

export function AwardsBand({ view, credit, vertical, href }: AwardsBandProps): ReactNode {
  // Nem destaque nem contagem: nao ha faixa. (O reconhecedor ja recusa esse
  // caso; esta guarda existe porque o componente e publico e pode ser chamado
  // diretamente.)
  if (view.headline === null && view.tally.label === null) return null;
  // Credito ausente = nao exibe. NUNCA "exibe sem credito" (invariante 6).
  if (credit.text.trim() === "") return null;

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
        {view.headline !== null ? (
          <span className="awards-band__headline">{view.headline}</span>
        ) : null}
        {/* Credito no MESMO bloco do fato — nunca rodape, nunca tooltip. */}
        <span className="awards-band__credit">
          {credit.url !== null ? (
            <a href={credit.url} rel="noopener noreferrer nofollow" target="_blank">
              {credit.text}
            </a>
          ) : (
            credit.text
          )}
        </span>
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
