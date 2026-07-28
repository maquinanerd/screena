'use client'

/**
 * HomeEditorialHighlights — "Destaques de hoje": TRÊS MATÉRIAS publicadas, não
 * fichas de catálogo.
 *
 * Cada card é uma notícia e leva a `/pt/noticias/{slug}/`. Nenhum pôster de
 * filme, nenhuma metadata de entidade ("Filme · 2026", classificação, nota,
 * temporada, duração) aparece aqui — esses cards são jornalismo.
 *
 * `Filmes` / `Séries` são TABS de verdade (`role="tab"` sobre `<button>`), não
 * links: elas não navegam, não trocam a rota, não recarregam a página. Elas
 * apenas trocam QUAIS matérias estão visíveis — e o conteúdo muda de fato,
 * porque cada vertical carrega a sua própria lista vinda do servidor.
 *
 * Independente do hero: a tab ativa nunca segue o slide do carrossel.
 */

import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { SectionTitle } from './ds'
import type {
  HomeEditorialHighlight,
  HomeEditorialHighlights as Highlights,
  HomeEditorialVertical,
} from '../../src/lib/home-editorial-presenter'

const TABS: ReadonlyArray<{ vertical: HomeEditorialVertical; label: string }> = [
  { vertical: 'movies', label: 'Filmes' },
  { vertical: 'series', label: 'Séries' },
]

const EMPTY_MESSAGE: Readonly<Record<HomeEditorialVertical, string>> = {
  movies: 'Ainda não há destaques de filmes publicados.',
  series: 'Ainda não há destaques de séries publicados.',
}

/**
 * Placeholder editorial neutro. Preserva o layout do card SEM fingir ser a capa
 * real da matéria: quando o artigo não tem imagem publicável, o pôster da
 * entidade relacionada NÃO entra no lugar (seria vender catálogo como
 * jornalismo) e nenhuma mídia externa é buscada no render.
 */
function EditorialImage({ card }: { card: HomeEditorialHighlight }): ReactNode {
  if (card.imagePath === null) {
    return <span aria-hidden="true" className="feat-card__placeholder" />
  }
  // `loading="lazy"` nos TRÊS cards, inclusive o principal: a seção fica abaixo
  // do hero e da faixa amarela, ou seja, fora da primeira dobra em todas as
  // viewports medidas. Priorizar esta imagem competiria com o backdrop do hero,
  // que é o LCP real da página.
  return <img alt={card.imageAlt} className="feat-card__img" loading="lazy" src={card.imagePath} />
}

function LeadCard({ card }: { card: HomeEditorialHighlight }): ReactNode {
  return (
    <a className="feat-card feat-card--lead" href={card.href}>
      <EditorialImage card={card} />
      <span className="feat-card__scrim" />
      <span className="feat-card__body">
        <span className="feat-card__kicker">{card.eyebrow}</span>
        <h3 className="feat-card__title">{card.title}</h3>
        {card.deck !== null ? <p className="feat-card__sub">{card.deck}</p> : null}
      </span>
    </a>
  )
}

function PosterCard({
  card,
  dim,
}: {
  card: HomeEditorialHighlight
  dim: boolean
}): ReactNode {
  return (
    <a className="feat-card feat-card--poster" href={card.href}>
      <EditorialImage card={card} />
      <span className="feat-card__scrim" />
      <span className="feat-card__body">
        <span
          className={dim ? 'feat-card__kicker feat-card__kicker--dim' : 'feat-card__kicker'}
        >
          {card.eyebrow}
        </span>
        <h3 className="feat-card__title--sm">{card.title}</h3>
      </span>
    </a>
  )
}

export function HomeEditorialHighlights({
  highlights,
  headingId,
  initialVertical = 'movies',
}: {
  highlights: Highlights
  /** `id` do heading da seção. */
  headingId: string
  /**
   * Tab inicial. Na home geral é `movies` (composição canônica); nas categorias
   * é a vertical da ROTA. Nunca derivada do slide do hero — o hero e esta seção
   * são componentes independentes, e trocar de slide não troca a tab.
   */
  initialVertical?: HomeEditorialVertical
}): ReactNode {
  const [active, setActive] = useState<HomeEditorialVertical>(initialVertical)
  const baseId = useId()
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const cards = active === 'movies' ? highlights.movies : highlights.series
  const visible = cards.slice(0, 3)
  const [lead, ...rest] = visible

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const index = TABS.findIndex((tab) => tab.vertical === active)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (next === undefined) return
    setActive(next.vertical)
    tabRefs.current[next.vertical]?.focus()
  }

  return (
    <>
      <div className="feat-head">
        <SectionTitle id={headingId} title="Destaques de hoje" />
        <div
          aria-label="Filtrar destaques editoriais"
          className="seg-toggle"
          role="tablist"
        >
          {TABS.map((tab) => (
            <button
              aria-controls={`${baseId}-panel-${tab.vertical}`}
              aria-selected={active === tab.vertical}
              className="seg-toggle__opt"
              id={`${baseId}-tab-${tab.vertical}`}
              key={tab.vertical}
              onClick={() => setActive(tab.vertical)}
              onKeyDown={onKeyDown}
              ref={(node) => {
                tabRefs.current[tab.vertical] = node
              }}
              role="tab"
              tabIndex={active === tab.vertical ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {TABS.map((tab) =>
        tab.vertical === active ? (
          <div
            aria-labelledby={`${baseId}-tab-${tab.vertical}`}
            id={`${baseId}-panel-${tab.vertical}`}
            key={tab.vertical}
            role="tabpanel"
            tabIndex={0}
          >
            {visible.length === 0 ? (
              // Estado vazio HONESTO: nunca troca silenciosamente de vertical e
              // nunca preenche o buraco com cards de catálogo.
              <p className="feat-empty">{EMPTY_MESSAGE[tab.vertical]}</p>
            ) : (
              // `data-count` deixa o grid se adaptar a 1 ou 2 matérias sem
              // inventar a terceira.
              <div className="feat-grid" data-count={visible.length}>
                {lead !== undefined ? <LeadCard card={lead} /> : null}
                {rest.map((card, index) => (
                  <PosterCard card={card} dim={index > 0} key={card.articleId} />
                ))}
              </div>
            )}
          </div>
        ) : null,
      )}
    </>
  )
}
