"use client";

import { Fragment, useCallback, useState, type KeyboardEvent, type ReactNode } from "react";

import type { HeroSlide } from "../../src/lib/home-hero-presenter";
import { RatingStars } from "./rating-stars";
import { CertificationBadge } from "./certification-badge";

/**
 * HeroCarousel — hero-carousel cinematografico da home publica (design v4).
 *
 * CLIENT component: mantem so o estado do slide ativo (`useState`) e a
 * navegacao (dots + setas do teclado). NAO faz IO — recebe `slides` ja montados
 * e SERIALIZAVEIS do server (`getHomeHeroSlides` -> `home-hero-presenter`), em
 * respeito as invariantes 3/4 (zero API externa / zero Gemini no render).
 *
 * Estrutura de CADA slide (identica para todos):
 *   eyebrow -> titulo -> linha de metadados (info · estrelas · classificacao)
 *   -> botoes (Onde assistir + Ver ficha) -> creditos (diretor/elenco/sinopse).
 * SEM poster/card lateral (o design aprovado nao usa poster no hero).
 */

interface HeroCarouselProps {
  slides: HeroSlide[];
}

/** Itens validos da linha de metadados (o separador "·" so entra entre eles). */
function metaItems(slide: HeroSlide): { key: string; node: ReactNode }[] {
  const items: { key: string; node: ReactNode }[] = [];
  slide.primaryMeta.forEach((text, i) => {
    items.push({ key: `p${i}`, node: <span className="sc-hero__meta-item">{text}</span> });
  });
  if (slide.rating !== null) {
    items.push({
      key: "rating",
      node: <RatingStars value={slide.rating.value} scale={slide.rating.scale} />,
    });
  }
  if (slide.certification !== null) {
    items.push({ key: "cert", node: <CertificationBadge value={slide.certification} /> });
  }
  return items;
}

export function HeroCarousel({ slides }: HeroCarouselProps): ReactNode {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (count < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(index - 1);
      }
    },
    [count, go, index],
  );

  // Guard duplo (a home tambem trata o caso vazio antes de renderizar).
  if (count === 0) return null;
  const slide = slides[Math.min(index, count - 1)] ?? slides[0];
  if (!slide) return null;

  const items = metaItems(slide);
  const hasCredits =
    slide.director !== null || slide.cast.length > 0 || slide.synopsis !== null;

  return (
    <section
      className="sc-hero sc-hero--carousel"
      data-vertical={slide.vertical}
      aria-roledescription="carrossel"
      aria-label="Destaques do Screen"
      onKeyDown={onKeyDown}
    >
      <div
        className={`sc-hero__wash sc-hero__wash--${slide.vertical}`}
        aria-hidden="true"
      />
      <div className="sc-hero__scrim" aria-hidden="true" />

      <div className="sc-hero__inner">
        <div className="sc-hero__lead">
          <span className="sc-hero__eyebrow" data-vertical={slide.vertical}>
            {slide.eyebrow}
          </span>
          <h1 className="sc-hero__title">{slide.title}</h1>

          {items.length > 0 ? (
            <div className="sc-hero__meta" aria-label="Informações do título">
              {items.map((item, i) => (
                <Fragment key={item.key}>
                  {i > 0 ? (
                    <span className="sc-hero__sep" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  {item.node}
                </Fragment>
              ))}
            </div>
          ) : null}

          <div className="sc-hero__actions">
            <a
              className="sc-hero__btn sc-hero__btn--primary"
              data-vertical={slide.vertical}
              href={slide.href}
            >
              Onde assistir
            </a>
            <a className="sc-hero__btn sc-hero__btn--ghost" href={slide.href}>
              Ver ficha
            </a>
          </div>
        </div>

        {hasCredits ? (
          <div className="sc-hero__credits">
            {slide.director !== null ? (
              <p className="sc-hero__credit sc-hero__credit--dir">
                <strong>{slide.director}</strong>
              </p>
            ) : null}
            {slide.cast.length > 0 ? (
              <p className="sc-hero__credit sc-hero__credit--cast">
                {slide.cast.join(", ")}
              </p>
            ) : null}
            {slide.synopsis !== null ? (
              <p className="sc-hero__credit sc-hero__credit--synopsis">{slide.synopsis}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="sc-hero__dots" role="tablist" aria-label="Selecionar destaque">
          {slides.map((item, i) => (
            <button
              key={item.href}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Destaque ${i + 1} de ${count}: ${item.title}`}
              className={`sc-hero__dot${i === index ? " is-active" : ""}`}
              data-vertical={item.vertical}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
