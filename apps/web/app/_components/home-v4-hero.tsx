import type { ReactNode } from "react";

import type { EntityCard } from "../../src/lib/entity-index-presenter";
import { EXPLORE_PATH } from "../../src/lib/site";

/**
 * HomeV4Hero + HomeV4Ticker — topo cinematografico da home, portado da tela
 * canonica `Screen Screens v4.dc.html` (bloco HOME).
 *
 * PRESENTACIONAL e PURO: recebe o destaque REAL (`EntityCard`) e, quando
 * disponivel, um `detail` REAL (elenco + sinopse vindos do banco pelos getters
 * de detalhe) por props; so produz JSX (invariantes 3/4). NADA e inventado:
 * SEM nota/estrela/certificacao fake (o design mostra "★★★★☆ TV-MA", mas nao ha
 * rating como produto — omitido, nunca fabricado). Os botoes seguem o rotulo do
 * design e NAVEGAM para a ficha real (nao executam feature inexistente). Sem
 * destaque, cai para o hero institucional. Diferenciacao filme/serie por texto
 * (eyebrow "Filme"/"Serie") + cor de apoio (invariante 11).
 */

export interface HeroDetail {
  castNames: string | null;
  synopsis: string | null;
}

const HOME_DESCRIPTION =
  "Base editorial de entretenimento em português: fichas de filmes e séries, perfis de pessoas e notícias com curadoria própria da redação do Screen.";

function ArrowIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="18.5" y2="12" />
      <polyline points="12.5 6 19 12 12.5 18" />
    </svg>
  );
}

function PlayIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.6v14.8L19.5 12z" />
    </svg>
  );
}

export function HomeV4Hero({
  featured,
  detail,
}: {
  featured: EntityCard | null;
  detail: HeroDetail | null;
}): ReactNode {
  const vertical = featured?.kind === "series" ? "series" : "movie";
  const label = featured?.kind === "series" ? "Série" : "Filme";
  const hasDetail = detail !== null && (detail.castNames !== null || detail.synopsis !== null);

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
                  Onde assistir
                </a>
                <a className="home-v4-hero__btn home-v4-hero__btn--ghost" href={featured.href}>
                  Adicionar à lista
                </a>
                <a className="home-v4-hero__btn home-v4-hero__btn--ghost" href={featured.href}>
                  Avaliar
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

        {/* Painel lateral direito do design: elenco + sinopse REAIS do banco
            (quando existirem) + poster de apoio quando ha imagem. */}
        {featured && (hasDetail || featured.image !== null) ? (
          <aside className="home-v4-hero__aside">
            {hasDetail ? (
              <div className="home-v4-hero__detail">
                {detail!.castNames !== null ? (
                  <div className="home-v4-hero__cast">{detail!.castNames}</div>
                ) : null}
                {detail!.synopsis !== null ? (
                  <p className="home-v4-hero__synopsis">{detail!.synopsis}</p>
                ) : null}
              </div>
            ) : null}
            {featured.image !== null ? (
              <div className="home-v4-hero__poster">
                <img
                  src={featured.image.src}
                  alt={`Pôster de ${featured.title}`}
                  width={featured.image.width}
                  height={featured.image.height}
                  loading="eager"
                />
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>

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
 * Faixa amarela de destaque (visual do ticker "novo episódio" do design).
 * Aponta para a ficha REAL; sem plataforma/data fabricada.
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
          <span className="home-v4-ticker__cta-icon">
            <PlayIcon />
          </span>
          Ver ficha
          <span className="home-v4-ticker__cta-icon">
            <ArrowIcon />
          </span>
        </a>
      </div>
    </div>
  );
}
