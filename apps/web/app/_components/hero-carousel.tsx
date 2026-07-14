"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from "react";

import type { HeroSlide } from "../../src/lib/home-hero-presenter";
import { RatingStars } from "./rating-stars";
import { CertificationBadge } from "./certification-badge";

/**
 * HeroCarousel — hero-carousel cinematografico da home publica (design v4).
 *
 * CLIENT component: mantem so o estado do slide ativo (`useState`) e a navegacao
 * (autoplay + dots + setas + teclado + swipe). NAO faz IO — recebe `slides` ja
 * montados e SERIALIZAVEIS do server (`getHomeHeroSlides` -> `home-hero-presenter`),
 * em respeito as invariantes 3/4 (zero API externa / zero Gemini no render). A
 * imagem de fundo (`slide.imageUrl`) e a URL publica REMOTA do TMDB, ja construida
 * no presenter pelo helper governado a partir do `file_path` cru; o servidor nao
 * salva imagem (sem `/media/tmdb`).
 *
 * Carrossel REAL: todos os slides ficam empilhados (crossfade por opacidade) e o
 * ativo troca sozinho (autoplay ~6s), com setas ‹ ›, dots, teclado (setas) e swipe
 * no mobile. O autoplay pausa em hover/foco/interacao e respeita
 * `prefers-reduced-motion` (sem troca automatica quando o usuario pede menos
 * movimento).
 *
 * Estrutura de CADA slide (identica para todos): imagem de fundo (ou wash) + scrim
 * -> eyebrow -> titulo -> linha de metadados (info · estrelas · classificacao)
 * -> CTA de ficha -> creditos (diretor/elenco/sinopse).
 */

/** Intervalo do autoplay (ms) — janela confortavel de leitura por slide. */
const AUTOPLAY_MS = 6000;

/** Deslocamento horizontal minimo (px) para um swipe contar como troca de slide. */
const SWIPE_THRESHOLD = 40;

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
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  // prefers-reduced-motion reativo: sem troca automatica quando o usuario pede
  // menos movimento (o carousel continua navegavel por setas/dots/teclado).
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReduceMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Autoplay: reagenda a cada troca (index nas deps) — nav manual/hover reinicia o
  // timer. Pausa em hover/foco (`paused`) e sob reduce-motion. Limpa no unmount.
  useEffect(() => {
    if (count < 2 || paused || reduceMotion) return;
    const id = window.setTimeout(() => {
      setIndex((i) => (i + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [count, paused, reduceMotion, index]);

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

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const start = touchStartX.current;
      touchStartX.current = null;
      if (start === null || count < 2) return;
      const endX = event.changedTouches[0]?.clientX;
      if (endX === undefined) return;
      const dx = endX - start;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      go(index + (dx < 0 ? 1 : -1));
    },
    [count, go, index],
  );

  // Guard duplo (a home tambem trata o caso vazio antes de renderizar).
  if (count === 0) return null;
  const activeIndex = Math.min(index, count - 1);
  const activeSlide = slides[activeIndex] ?? slides[0];
  if (!activeSlide) return null;

  return (
    <section
      className="sc-hero sc-hero--carousel"
      data-vertical={activeSlide.vertical}
      aria-roledescription="carrossel"
      aria-label="Destaques da cinerie"
      onKeyDown={onKeyDown}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {slides.map((slide, i) => {
        const isActive = i === activeIndex;
        const items = metaItems(slide);
        const hasCredits =
          slide.director !== null || slide.cast.length > 0 || slide.synopsis !== null;
        return (
          <div
            key={`slide-${i}-${slide.href}`}
            className="sc-hero__slide"
            data-active={isActive}
            data-vertical={slide.vertical}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} de ${count}`}
            aria-hidden={!isActive}
          >
            {slide.imageUrl !== null ? (
              <img
                className="sc-hero__bg"
                src={slide.imageUrl}
                alt=""
                aria-hidden="true"
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
              />
            ) : (
              <div
                className={`sc-hero__wash sc-hero__wash--${slide.vertical}`}
                aria-hidden="true"
              />
            )}
            <div className="sc-hero__scrim" aria-hidden="true" />

            <div className="sc-hero__inner">
              <div className="sc-hero__lead">
                <span className="sc-hero__eyebrow" data-vertical={slide.vertical}>
                  {slide.eyebrow}
                </span>
                {/* O H1 unico da home descreve a cinerie (sr-only em pt/page.tsx),
                    nao o filme rotativo. O titulo do slide e <h2> quando ativo e
                    <p> nos demais (mesma classe) — SEO entity-first, um so H1
                    institucional na pagina, nunca o titulo do slide como H1. */}
                {isActive ? (
                  <h2 className="sc-hero__title">{slide.title}</h2>
                ) : (
                  <p className="sc-hero__title">{slide.title}</p>
                )}

                {items.length > 0 ? (
                  <div className="sc-hero__meta" aria-label="Informações do título">
                    {items.map((item, k) => (
                      <Fragment key={item.key}>
                        {k > 0 ? (
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
                    tabIndex={isActive ? undefined : -1}
                  >
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
                    <p className="sc-hero__credit sc-hero__credit--cast">{slide.cast.join(", ")}</p>
                  ) : null}
                  {slide.synopsis !== null ? (
                    <p className="sc-hero__credit sc-hero__credit--synopsis">{slide.synopsis}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      {count > 1 ? (
        <>
          <button
            type="button"
            className="sc-hero__arrow sc-hero__arrow--prev"
            aria-label="Slide anterior"
            onClick={() => go(index - 1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            className="sc-hero__arrow sc-hero__arrow--next"
            aria-label="Próximo slide"
            onClick={() => go(index + 1)}
          >
            <span aria-hidden="true">›</span>
          </button>

          <div className="sc-hero__dots" role="tablist" aria-label="Selecionar destaque">
            {slides.map((item, i) => (
              <button
                key={`dot-${i}-${item.href}`}
                type="button"
                role="tab"
                aria-selected={i === activeIndex}
                aria-label={`Ir para o slide ${i + 1} de ${count}: ${item.title}`}
                className={`sc-hero__dot${i === activeIndex ? " is-active" : ""}`}
                data-vertical={item.vertical}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
