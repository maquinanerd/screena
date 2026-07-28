'use client'

/**
 * Rail — trilho horizontal com setas prev/next do canonico (icon-buttons com
 * aria-label, 40-INTERACTIVE-SEMANTICS: controle de carrossel = icon-button).
 * O conteudo continua sendo server-rendered (children); este wrapper so
 * adiciona o scroll programatico. Sem JS, o trilho segue rolavel por toque/
 * teclado (overflow-x nativo).
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'

export function Rail({
  children,
  className,
  dark = false,
  label,
}: {
  children: ReactNode
  className: string
  dark?: boolean
  label: string
}): ReactNode {
  const trackRef = useRef<HTMLDivElement>(null)

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current
    if (track === null) return
    track.scrollBy({ left: direction * Math.round(track.clientWidth * 0.8), behavior: 'smooth' })
  }

  return (
    <div className="rail-wrap">
      <div className={className} ref={trackRef} role="group" aria-label={label}>
        {children}
      </div>
      <button
        aria-label={`${label}: anterior`}
        className={dark ? 'rail-arrow rail-arrow--dark rail-arrow--prev' : 'rail-arrow rail-arrow--prev'}
        onClick={() => scrollBy(-1)}
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
          <path d="m14 6-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </button>
      <button
        aria-label={`${label}: próximo`}
        className={dark ? 'rail-arrow rail-arrow--dark rail-arrow--next' : 'rail-arrow rail-arrow--next'}
        onClick={() => scrollBy(1)}
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
          <path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </button>
    </div>
  )
}
