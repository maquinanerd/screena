import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";

/**
 * Trilhos de cards da home v4 (Top 10, poster rails, "Em breve") + abas de
 * plataforma. Portados da tela `Screen Screens v4.dc.html`.
 *
 * PRESENTACIONAIS e PUROS: recebem `EntityCard` REAIS por props e so produzem
 * JSX (invariantes 3/4). Governanca: NENHUMA nota/estrela e exibida (ratings
 * ainda nao sao produto), NENHUMA data/plataforma por titulo e afirmada, e o
 * poster so aparece quando ha imagem local segura — caso contrario, placeholder
 * visual (gradiente), nunca imagem externa nem dado falso. O tipo aparece
 * SEMPRE como texto (badge "Filme"/"Serie") alem da cor (invariante 11).
 */

const KIND_LABELS: Readonly<Record<EntityCard["kind"], string>> = {
  movie: "Filme",
  series: "Série",
  person: "Pessoa",
};

/** Item de ranking: card real + posicao (numeracao editorial, nao nota). */
export interface RankItem {
  card: EntityCard;
  rank: number;
}

function PosterMedia({ card, rounded }: { card: EntityCard; rounded?: boolean }): ReactNode {
  return (
    <span className={`home-v4-poster__media${rounded ? " home-v4-poster__media--round" : ""}`}>
      {card.image !== null ? (
        <img
          src={card.image.src}
          alt={`Pôster de ${card.title}`}
          width={card.image.width}
          height={card.image.height}
          className="home-v4-poster__img"
          loading="lazy"
        />
      ) : (
        <span className="home-v4-poster__fallback" data-entity-type={card.kind} aria-hidden="true" />
      )}
      <span className="home-v4-poster__badge" data-entity-type={card.kind}>
        {KIND_LABELS[card.kind]}
      </span>
    </span>
  );
}

/** Top 10: 4 cards grandes ranqueados + até 6 cards pequenos. Sem nota. */
export function HomeV4RankRail({ big, small }: { big: RankItem[]; small: RankItem[] }): ReactNode {
  return (
    <>
      {big.length > 0 ? (
        <div className="home-v4-rank-big">
          {big.map(({ card, rank }) => (
            <a key={`${card.href}-${rank}`} className="home-v4-rank-card" href={card.href}>
              <span className="home-v4-poster__media">
                {card.image !== null ? (
                  <img
                    src={card.image.src}
                    alt={`Pôster de ${card.title}`}
                    width={card.image.width}
                    height={card.image.height}
                    className="home-v4-poster__img"
                    loading="lazy"
                  />
                ) : (
                  <span className="home-v4-poster__fallback" data-entity-type={card.kind} aria-hidden="true" />
                )}
                <span className="home-v4-rank-card__num">#{rank}</span>
              </span>
              <span className="home-v4-rank-card__body">
                <span className="home-v4-poster__badge home-v4-poster__badge--inline" data-entity-type={card.kind}>
                  {KIND_LABELS[card.kind]}
                </span>
                <span className="home-v4-rank-card__title">{card.title}</span>
                {card.meta !== null ? (
                  <span className="home-v4-rank-card__meta">{card.meta}</span>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      ) : null}

      {small.length > 0 ? (
        <div className="home-v4-rank-small">
          {small.map(({ card, rank }) => (
            <a key={`${card.href}-${rank}`} className="home-v4-rank-row" href={card.href}>
              <span className="home-v4-rank-row__top">
                <span className="home-v4-rank-row__thumb" data-entity-type={card.kind} aria-hidden="true">
                  {card.image !== null ? (
                    <img src={card.image.src} alt="" width={card.image.width} height={card.image.height} loading="lazy" />
                  ) : null}
                </span>
                <span className="home-v4-rank-row__head">
                  <span className="home-v4-rank-row__num">#{rank}</span>
                  <span className="home-v4-rank-row__title">{card.title}</span>
                </span>
              </span>
              {card.meta !== null ? (
                <span className="home-v4-rank-row__meta">{card.meta}</span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** Grade de 6 posters (Filmes em alta / Séries da semana). Sem nota. */
export function HomeV4PosterRail({ items }: { items: EntityCard[] }): ReactNode {
  return (
    <div className="home-v4-poster-rail">
      {items.map((card) => (
        <a key={card.href} className="home-v4-poster-card" href={card.href}>
          <PosterMedia card={card} />
          <span className="home-v4-poster-card__title">{card.title}</span>
          {card.meta !== null ? (
            <span className="home-v4-poster-card__meta">{card.meta}</span>
          ) : null}
        </a>
      ))}
    </div>
  );
}

/**
 * Abas de plataforma (visual do design). DECORATIVAS: sem busca/filtro
 * funcional e sem afirmar que um titulo especifico esta em uma plataforma
 * (isso exigiria dado de disponibilidade licenciado, ainda inativo).
 */
export function HomeV4PlatformTabs(): ReactNode {
  const platforms = ["Netflix", "Prime Video", "Disney+", "Max", "Apple TV+"];
  return (
    <div className="home-v4-platform-tabs" aria-hidden="true">
      {platforms.map((name, index) => (
        <span key={name} className={`home-v4-platform-tab${index === 0 ? " home-v4-platform-tab--active" : ""}`}>
          {name}
        </span>
      ))}
    </div>
  );
}

/**
 * "Em breve": trilho horizontal 16:9. Usa placeholders visuais (gradiente) por
 * tipo — sem afirmar data de estreia, duração ou trailer que não existam. O
 * título e o link vêm do banco.
 */
export function HomeV4ComingRail({ items }: { items: EntityCard[] }): ReactNode {
  return (
    <div className="home-v4-coming-rail">
      {items.map((card) => (
        <a key={card.href} className="home-v4-coming-card" href={card.href}>
          <span className="home-v4-coming-card__media" data-entity-type={card.kind}>
            <span className="home-v4-coming-card__type">{KIND_LABELS[card.kind]}</span>
          </span>
          <span className="home-v4-coming-card__title">{card.title}</span>
          {card.meta !== null ? (
            <span className="home-v4-coming-card__meta">{card.meta}</span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
