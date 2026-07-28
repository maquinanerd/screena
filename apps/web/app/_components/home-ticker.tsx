'use client'

/**
 * HomeTicker — faixa amarela do canonico, entre o hero e "Destaques de hoje".
 * Ela e ESTRUTURA da home: nao some quando o slide ativo e um filme nem quando
 * nao ha estreia hoje.
 *
 * O que muda e so o TEXTO, sempre com dado real do PostgreSQL:
 *  - `today`    -> selo NOVO + episodio que estreia hoje;
 *  - `upcoming` -> selo EM BREVE + proxima estreia JA CONFIRMADA (com a data);
 *  - lista vazia -> estado neutro e honesto, sem episodio, data ou plataforma
 *    inventados.
 *
 * Dots como tabs reais (role=tab, setas do teclado) rotacionando os itens; o
 * CTA leva a uma rota real.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import type { TickerEpisode } from '../../src/server/home-ticker'
// `routes` (nao `site`): modulo puro, importavel em client component.
import { SERIES_INDEX_PATH } from '../../src/lib/routes'

const BADGE: Readonly<Record<TickerEpisode['kind'], string>> = {
  today: 'NOVO',
  upcoming: 'EM BREVE',
}

export function HomeTicker({ items }: { items: readonly TickerEpisode[] }): ReactNode {
  const [active, setActive] = useState(0)
  const item = items.length > 0 ? (items[Math.min(active, items.length - 1)] as TickerEpisode) : null

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
    <div aria-label="Agenda de episódios" className="ticker" role="region">
      <div className="ticker__inner">
        <div className="ticker__lead">
          <span className="ticker__label">{item === null ? 'AGENDA' : BADGE[item.kind]}</span>
          <span className="ticker__text">
            {item === null ? (
              'Nenhum episódio novo confirmado para hoje'
            ) : (
              <>
                <strong>{item.series}</strong> · {item.seasonEp}
                {item.episodeTitle !== null ? <> · {item.episodeTitle}</> : null}
                {item.airDateLabel !== null ? <> · estreia em {item.airDateLabel}</> : null}
              </>
            )}
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
          <a className="ticker__cta" href={item === null ? SERIES_INDEX_PATH : item.href}>
            {item === null ? 'Ver séries' : 'Ver série'}
          </a>
        </div>
      </div>
    </div>
  )
}
