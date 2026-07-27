'use client'

/**
 * Filmografia — tela 09 do canônico: lista tabular (ano · dot por tipo ·
 * título · papel) com filtro real Tudo/Filmes/Séries. Sem célula de rating:
 * ratings externos seguem inativos como produto (estado honesto — a coluna
 * não existe até haver dado licenciado; nunca outra métrica no lugar).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

export interface FilmographyItem {
  entityType: 'movie' | 'tv'
  title: string
  href: string
  year: number | null
  roleLabel: string | null
}

type Filter = 'all' | 'movie' | 'tv'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'movie', label: 'Filmes' },
  { key: 'tv', label: 'Séries' },
]

export function Filmography({ items }: { items: FilmographyItem[] }): ReactNode {
  const [filter, setFilter] = useState<Filter>('all')
  const visible = filter === 'all' ? items : items.filter((item) => item.entityType === filter)

  return (
    <>
      <div className="filmo-tabs" role="tablist" aria-label="Filtrar filmografia">
        {FILTERS.map((f) => (
          <button
            aria-selected={filter === f.key}
            className="filmo-tab"
            key={f.key}
            onClick={() => setFilter(f.key)}
            role="tab"
            type="button"
          >
            {f.label}
          </button>
        ))}
      </div>
      <ul className="filmo">
        {visible.map((item, index) => (
          <li key={`${item.entityType}-${item.href}-${index}`}>
            <a className="filmo__row" data-entity-type={item.entityType} href={item.href}>
              <span className="filmo__year">{item.year !== null ? item.year : '—'}</span>
              <span
                aria-hidden="true"
                className={
                  item.entityType === 'movie' ? 'filmo__dot filmo__dot--movie' : 'filmo__dot filmo__dot--series'
                }
              />
              <span className="filmo__title">{item.title}</span>
              <span className="filmo__role">
                {/* Badge textual: a diferenciação nunca é só cor (invariante 11) */}
                <span className="visually-hidden">
                  {item.entityType === 'movie' ? 'Filme · ' : 'Série · '}
                </span>
                {item.roleLabel ?? ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {visible.length === 0 ? (
        <p className="muted">Nenhum crédito nesse filtro.</p>
      ) : null}
    </>
  )
}
