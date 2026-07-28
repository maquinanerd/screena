'use client'

/**
 * Trilhos do Explorar (tela 11): filtro REAL Tudo/Filmes/Séries aplicado aos
 * trilhos de poster ("Em Alta" ranqueado + "Populares"). Sem chip de
 * variação diária nem métrica social: não há esse sinal persistido nem agregado
 * de avaliações exibível (estado honesto; ordenação usa sinais técnicos
 * locais documentados no loader). Badge textual por tipo (invariante 11).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

export interface DiscoverRailCard {
  entityType: 'movie' | 'tv'
  entityId: string
  title: string
  href: string
  posterUrl: string | null
  year: number | null
}

type Filter = 'all' | 'movie' | 'tv'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'movie', label: 'Filmes' },
  { key: 'tv', label: 'Séries' },
]

function applyFilter(cards: DiscoverRailCard[], filter: Filter): DiscoverRailCard[] {
  return filter === 'all' ? cards : cards.filter((card) => card.entityType === filter)
}

function RankRail({
  cards,
  ranked,
}: {
  cards: DiscoverRailCard[]
  ranked: boolean
}): ReactNode {
  if (cards.length === 0) {
    return <p className="muted">Nenhum título nesse filtro.</p>
  }
  return (
    <div className="disc-rank">
      {cards.map((card, index) => (
        <a
          className="disc-rank__card"
          data-entity-type={card.entityType}
          href={card.href}
          key={`${card.entityType}:${card.entityId}`}
        >
          <span className="disc-rank__poster">
            {card.posterUrl !== null ? <img alt="" loading="lazy" src={card.posterUrl} /> : null}
            <span
              className={
                card.entityType === 'movie'
                  ? 'disc-rank__type'
                  : 'disc-rank__type disc-rank__type--series'
              }
            >
              {card.entityType === 'movie' ? 'Filme' : 'Série'}
            </span>
            {ranked ? (
              <span aria-hidden="true" className="disc-rank__num">
                {index + 1}
              </span>
            ) : null}
          </span>
          <span className="disc-rank__title">{card.title}</span>
          {card.year !== null ? <span className="disc-rank__meta">{card.year}</span> : null}
        </a>
      ))}
    </div>
  )
}

export function DiscoverFilterableRails({
  emAlta,
  populares,
  lead,
  children,
}: {
  emAlta: DiscoverRailCard[]
  populares: DiscoverRailCard[]
  /** DESTAQUE escuro — vem ANTES do "Em Alta", como no canônico. */
  lead?: ReactNode
  /** Seções fixas (Continuar assistindo, Lançamentos, Mais aguardados) — não filtradas. */
  children?: ReactNode
}): ReactNode {
  const [filter, setFilter] = useState<Filter>('all')

  return (
    <>
      <div className="disc-head">
        <div>
          <h1 className="disc-title">Explorar</h1>
          <p className="disc-sub">
            Busque um título ou navegue pelas estreias, tendências e de onde você parou.
          </p>
        </div>
        <div aria-label="Filtrar por tipo" className="disc-tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              aria-selected={filter === f.key}
              className="disc-tab"
              key={f.key}
              onClick={() => setFilter(f.key)}
              role="tab"
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {lead}

      <section aria-labelledby="disc-alta-title" className="disc-section">
        <div className="disc-section-head">
          <div className="eyebrow-bar">
            <span aria-hidden="true" className="eyebrow-bar__mark" />
            <h2 className="section-title section-title--sm" id="disc-alta-title">
              <strong>Em</strong> <span>Alta</span>
            </h2>
          </div>
          {/* Sem sinal de variação diária persistido — rótulo honesto */}
          <span className="disc-note">Mais populares no catálogo agora</span>
        </div>
        <RankRail cards={applyFilter(emAlta, filter)} ranked />
      </section>

      {children}

      <section aria-labelledby="disc-pop-title" className="disc-section" data-vertical="series">
        <div className="disc-section-head">
          <div className="eyebrow-bar">
            <span aria-hidden="true" className="eyebrow-bar__mark" />
            <h2 className="section-title section-title--sm" id="disc-pop-title">
              <strong>Populares</strong>
            </h2>
          </div>
          {/* Ordenado por volume de avaliações (sinal técnico local; número não exibido) */}
          <span className="disc-note">Mais avaliados no catálogo</span>
        </div>
        <RankRail cards={applyFilter(populares, filter)} ranked={false} />
      </section>
    </>
  )
}
