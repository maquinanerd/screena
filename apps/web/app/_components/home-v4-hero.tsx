import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";
import { EXPLORE_PATH, MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from "../../src/lib/site";

/**
 * HomeV4Hero + HomeV4Ticker — topo cinematografico da home, portado da tela
 * canonica `Screen Screens v4.dc.html` (bloco HOME: hero full-bleed + faixa
 * amarela de novidade).
 *
 * PRESENTACIONAL e PURO: recebe o destaque REAL (`EntityCard` do banco) por
 * props e so produz JSX (invariantes 3/4). NADA e inventado: sem nota/estrela
 * fake, sem "onde assistir" fake, sem watchlist/avaliar reais. O destaque usa
 * so titulo/tipo/meta/poster/link que vieram do PostgreSQL; sem destaque, cai
 * para o hero institucional. Diferenciacao filme/serie por texto (eyebrow
 * "Filme"/"Serie") + cor de apoio, nunca so cor (invariante 11).
 */

const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

function heroVertical(card: EntityCard | null): "movie" | "series" {
  return card?.kind === "series" ? "series" : "movie";
}

function ArrowIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="18.5" y2="12" />
      <polyline points="12.5 6 19 12 12.5 18" />
    </svg>
  );
}

export function HomeV4Hero({ featured }: { featured: EntityCard | null }): ReactNode {
  const vertical = heroVertical(featured);
  const label = featured?.kind === "series" ? "Série" : "Filme";

  return (
    <section className="home-v4-hero" data-vertical={featured ? vertical : "neutral"}>
      <div className={`home-v4-hero__wash home-v4-hero__wash--${featured ? vertical : "neutral"}`} aria-hidden="true" />
      <div className="home-v4-hero__scrim" aria-hidden="true" />
      <div className="home-v4-hero__side-scrim" aria-hidden="true" />
      <div className="home-v4-hero__inner">
        <div className="home-v4-hero__lead">
          {featured ? (
            <>
              <span className="home-v4-hero__eyebrow" data-vertical={vertical}>
                {label} em destaque
              </span>
              <h1 className="home-v4-hero__title">{featured.title}</h1>
              {featured.meta !== null ? (
                <div className="home-v4-hero__meta">{featured.meta}</div>
              ) : null}
              <div className="home-v4-hero__actions">
                <a className="home-v4-hero__btn home-v4-hero__btn--primary" data-vertical={vertical} href={featured.href}>
                  Ver ficha
                </a>
                <a className="home-v4-hero__btn home-v4-hero__btn--ghost" href={MOVIES_INDEX_PATH}>
                  Ver filmes
                </a>
                <a className="home-v4-hero__btn home-v4-hero__btn--ghost" href={SERIES_INDEX_PATH}>
                  Ver séries
                </a>
              </div>
            </>
          ) : (
            <>
              <span className="home-v4-hero__eyebrow" data-vertical="neutral">
                Screen
              </span>
              <h1 className="home-v4-hero__title home-v4-hero__title--institutional">
                Filmes, séries, pessoas e notícias — em um só lugar.
              </h1>
              <p className="home-v4-hero__desc">{HOME_DESCRIPTION}</p>
              <div className="home-v4-hero__actions">
                <a className="home-v4-hero__btn home-v4-hero__btn--primary" href={EXPLORE_PATH}>
                  Explorar o catálogo
                </a>
              </div>
            </>
          )}
        </div>

        {featured && featured.image !== null ? (
          <aside className="home-v4-hero__aside">
            <div className="home-v4-hero__poster">
              <img
                src={featured.image.src}
                alt={`Pôster de ${featured.title}`}
                width={featured.image.width}
                height={featured.image.height}
                loading="eager"
              />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Indicador de slides (decorativo — sem carrossel funcional nesta fase). */}
      <div className="home-v4-hero__dots" aria-hidden="true">
        <span />
        <span className="home-v4-hero__dot--active" data-vertical={vertical} />
        <span />
        <span />
      </div>
    </section>
  );
}

/**
 * Faixa amarela de destaque (equivalente honesto ao ticker "novo episódio" do
 * design). Aponta para a ficha REAL do destaque; sem plataforma/data fabricada.
 */
export function HomeV4Ticker({ featured }: { featured: EntityCard | null }): ReactNode {
  if (featured === null) return null;
  const label = featured.kind === "series" ? "Série" : "Filme";
  return (
    <div className="home-v4-ticker">
      <div className="container home-v4-ticker__inner">
        <div className="home-v4-ticker__lead">
          <span className="home-v4-ticker__tag">DESTAQUE</span>
          <span className="home-v4-ticker__text">
            {label} em destaque no Screen · {featured.title}
            {featured.meta !== null ? ` · ${featured.meta}` : ""}
          </span>
        </div>
        <a className="home-v4-ticker__cta" href={featured.href}>
          Ver ficha
          <span className="home-v4-ticker__cta-icon">
            <ArrowIcon />
          </span>
        </a>
      </div>
    </div>
  );
}
