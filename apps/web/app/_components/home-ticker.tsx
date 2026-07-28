'use client'

/**
 * HomeTicker — faixa amarela do canonico: "episodios novos hoje", com dots
 * como tabs reais (role=tab, setas do teclado) rotacionando os itens.
 * So renderizada quando ha episodio REAL estreando hoje (dado do PostgreSQL);
 * o CTA leva a pagina real da serie.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { TickerEpisode } from '../../src/server/home-ticker'

export function HomeTicker({ items }: { items: readonly TickerEpisode[] }): ReactNode {
  const [active, setActive] = useState(0)
  if (items.length === 0) return null
  const item = items[Math.min(active, items.length - 1)] as TickerEpisode

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setActive((current) => (current + 1) % items.length)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setActive((current) => (current - 1 + items.length) % items.length)
    }
  }

  return (
    <div aria-label="Episódios novos hoje" className="ticker" role="region">
      <div className="ticker__inner">
        <div className="ticker__lead">
          <span className="ticker__label">NOVO</span>
          <span className="ticker__text">
            <strong>{item.series}</strong> · {item.seasonEp}
            {item.episodeTitle !== null ? <> · {item.episodeTitle}</> : null}
          </span>
        </div>
        <div className="ticker__controls">
          {items.length > 1 ? (
            <div aria-label="Selecionar episódio" className="ticker__dots" role="tablist">
              {items.map((entry, index) => (
                <button
                  aria-label={`${entry.series} ${entry.seasonEp}`}
                  aria-selected={index === active}
                  className="ticker__dot"
                  key={`${entry.href}:${entry.seasonEp}`}
                  onClick={() => setActive(index)}
                  onKeyDown={onKey}
                  role="tab"
                  tabIndex={index === active ? 0 : -1}
                  type="button"
                />
              ))}
            </div>
          ) : null}
          <a className="ticker__cta" href={item.href}>
            Ver série
          </a>
        </div>
      </div>
    </div>
  )
}
