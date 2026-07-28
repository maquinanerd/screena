'use client'

/**
 * HomeHeroCarousel — hero full-bleed em SLIDES do canonico (tela 02).
 *
 * Fidelidade ao handoff:
 *  - 88vh (min 620 / max 880), scrims vertical + horizontal;
 *  - eyebrow por vertical (11/800/0.16em), titulo display-xl 84/800/0.9;
 *  - estrelas #F5C84B + chip de certificacao; coluna direita com diretor,
 *    elenco e sinopse;
 *  - dots como TABS (role=tablist/tab, aria-selected, setas do teclado);
 *  - autoplay 6s PAUSAVEL: para em hover/foco e e DESLIGADO por
 *    prefers-reduced-motion.
 *
 * Dados: `HeroSlide[]` ja resolvidos no servidor (PostgreSQL local; imagem e
 * URL remota TMDB montada por helper governado). Zero fetch aqui.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { HeroSlide } from '../../src/lib/home-hero-presenter'

const AUTOPLAY_MS = 6000

function starsOf(rating: { value: number; scale: number } | null): {
  on: string
  off: string
} | null {
  if (rating === null) return null
  const five = Math.round((rating.value / rating.scale) * 5)
  const on = Math.min(5, Math.max(0, five))
  return { on: '★'.repeat(on), off: '★'.repeat(5 - on) }
}

export function HomeHeroCarousel({ slides }: { slides: readonly HeroSlide[] }): ReactNode {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const regionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (slides.length < 2 || paused) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % slides.length),
      AUTOPLAY_MS,
    )
    return () => window.clearInterval(timer)
  }, [slides.length, paused])

  if (slides.length === 0) return null
  const slide = slides[Math.min(active, slides.length - 1)] as HeroSlide
  const stars = starsOf(slide.rating)

  const onDotKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setActive((c) => (c + 1) % slides.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setActive((c) => (c - 1 + slides.length) % slides.length)
    }
  }

  return (
    <section
      aria-label="Destaques"
      className="hero"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false)
      }}
      onFocus={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      ref={regionRef}
    >
      {slide.imageUrl !== null ? (
        // Candidato a LCP: imagem prioritaria, sem lazy.
        <img alt="" className="hero__image" fetchPriority="high" src={slide.imageUrl} />
      ) : null}
      <div className="hero__scrim-v" />
      <div className="hero__scrim-h" />

      <div className="hero__content">
        <div className="hero__inner">
          <div className="hero__main">
            <a
              className={
                slide.vertical === 'series' ? 'hero__eyebrow hero__eyebrow--series' : 'hero__eyebrow'
              }
              href={slide.href}
            >
              {[slide.eyebrow, ...slide.primaryMeta].join(' · ')}
            </a>
            {/* Visual do H1 do canonico; o H1 SEMANTICO unico da home e o
                institucional (governanca home-seo-identity). NAO e <p>: o
                estilo global `p a` sublinharia o titulo. */}
            <div className="hero__title">
              <a href={slide.href}>{slide.title}</a>
            </div>
            {stars !== null || slide.certification !== null ? (
              <div className="hero__meta-row">
                {stars !== null ? (
                  <span aria-label={`Nota ${slide.rating?.value} de ${slide.rating?.scale}`} className="hero__stars">
                    {stars.on}
                    <span aria-hidden="true" className="hero__stars-off">
                      {stars.off}
                    </span>
                  </span>
                ) : null}
                {slide.certification !== null ? (
                  <span className="hero__cert">{slide.certification}</span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hero__side">
            {slide.director !== null ? (
              <div>
                <strong>Direção</strong> {slide.director}
              </div>
            ) : null}
            {slide.cast.length > 0 ? (
              <div className="hero__side-cast">{slide.cast.join(' · ')}</div>
            ) : null}
            {slide.synopsis !== null ? (
              <p className="hero__side-synopsis">{slide.synopsis}</p>
            ) : null}
          </div>
        </div>
      </div>

      {slides.length > 1 ? (
        <div aria-label="Selecionar destaque" className="hero__dots" role="tablist">
          {slides.map((s, index) => (
            <button
              aria-label={`Destaque ${index + 1}: ${s.title}`}
              aria-selected={index === active}
              className="hero__dot"
              data-vertical={s.vertical}
              key={s.href}
              onClick={() => setActive(index)}
              onKeyDown={onDotKey}
              role="tab"
              tabIndex={index === active ? 0 : -1}
              type="button"
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
