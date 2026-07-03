import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";

/**
 * Trilhos de cards da home v4 (Top 10, series em destaque, poster rails,
 * "Em breve") + abas de plataforma. Portados de `Screen Screens v4.dc.html`.
 *
 * PRESENTACIONAIS e PUROS (invariantes 3/4): recebem `EntityCard` REAIS por
 * props. Governanca: NENHUMA nota/estrela numerica exibida (ratings nao sao
 * produto) — as afordancias "Avaliar"/"Marcar como assistido" sao VISUAIS
 * (nao interativas, sem numero fake); NENHUMA plataforma por titulo e afirmada;
 * poster so quando ha imagem local, senao placeholder gradiente. Tipo sempre
 * como TEXTO (badge "Filme"/"Serie") alem da cor (invariante 11).
 */

const KIND_LABELS: Readonly<Record<EntityCard["kind"], string>> = {
  movie: "Filme",
  series: "Série",
  person: "Pessoa",
};

export interface RankItem {
  card: EntityCard;
  rank: number;
}

function StarOutline(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.6l2.7 5.78 6.3.83-4.66 4.37 1.2 6.27L12 17.9l-5.54 3.1 1.2-6.27L3 10.21l6.3-.83z" />
    </svg>
  );
}

function CheckIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 12.5 8 17.5 15 8" />
      <polyline points="12 15 14 17 21 7.5" />
    </svg>
  );
}

function PosterMedia({ card }: { card: EntityCard }): ReactNode {
  return (
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
      <span className="home-v4-poster__badge" data-entity-type={card.kind}>
        {KIND_LABELS[card.kind]}
      </span>
    </span>
  );
}

/** Top 10: 4 cards grandes ranqueados + até 6 cards pequenos. Sem nota numerica. */
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
                {/* Afordancia visual (sem numero fake): convite a avaliar. */}
                <span className="home-v4-rank-card__rate" aria-hidden="true">
                  <StarOutline />
                  Avaliar
                </span>
                <span className="home-v4-rank-card__watched" aria-hidden="true">
                  <CheckIcon />
                  Marcar como assistido
                </span>
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

/**
 * Séries da semana — linha de cards grandes escuros com título central
 * (visual do design). Sem plataforma por título (evita afirmar disponibilidade
 * falsa); a diferenciacao vem do badge "Série" + título + URL.
 */
export function HomeV4SeriesFeatureRail({ items }: { items: EntityCard[] }): ReactNode {
  return (
    <div className="home-v4-series-feature">
      {items.map((card, index) => (
        <a key={`${card.href}-${index}`} className="home-v4-series-card" href={card.href}>
          {card.image !== null ? (
            <img
              src={card.image.src}
              alt={`Pôster de ${card.title}`}
              width={card.image.width}
              height={card.image.height}
              className="home-v4-series-card__img"
              loading="lazy"
            />
          ) : (
            <span className="home-v4-series-card__fallback" aria-hidden="true" />
          )}
          <span className="home-v4-series-card__scrim" aria-hidden="true" />
          <span className="home-v4-series-card__badge">Série</span>
          <span className="home-v4-series-card__title">{card.title}</span>
        </a>
      ))}
    </div>
  );
}

/** Grade de 6 posters (Filmes em alta / grade de séries). Sem nota numerica. */
export function HomeV4PosterRail({ items }: { items: EntityCard[] }): ReactNode {
  return (
    <div className="home-v4-poster-rail">
      {items.map((card, index) => (
        <a key={`${card.href}-${index}`} className="home-v4-poster-card" href={card.href}>
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
 * Abas de plataforma (visual do design). DECORATIVAS: sem filtro funcional e
 * sem afirmar que um titulo especifico esta em uma plataforma.
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
 * "Em breve": grade CONTIDA no container (sem overflow/scroll horizontal, sem
 * card cortado). Placeholders 16:9 por tipo — sem data/duração fabricada; o
 * título e o link vêm do banco.
 */
export function HomeV4ComingRail({ items }: { items: EntityCard[] }): ReactNode {
  return (
    <div className="home-v4-coming-grid">
      {items.map((card, index) => (
        <a key={`${card.href}-${index}`} className="home-v4-coming-card" href={card.href}>
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
