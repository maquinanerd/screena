import type { ReactNode } from 'react'

import type { EntityCard } from '../../src/lib/entity-index-presenter'
import type { NewsCardView } from '../../src/lib/news-presenter'

/**
 * ds.tsx — Composicoes visuais compartilhadas do design canonico (server
 * components puros; sem rede/banco/estado). Cada componente mapeia 1:1 um
 * padrao do handoff: SectionHeader de duas pesagens, poster card com
 * stretched-link acessivel (DD-19), news cards, empty state.
 *
 * "Sem dado inventado": todo campo opcional ausente e OMITIDO — nunca "N/D".
 */

/* ------------------------------------------------------------------ */
/* SectionHeader: 1a palavra 800, resto 300, CAIXA ALTA (heading-h2)   */
/* ------------------------------------------------------------------ */

export function SectionTitle({ id, title }: { id?: string; title: string }): ReactNode {
  const [first, ...rest] = title.split(' ')
  return (
    <h2 className="section-title" id={id}>
      <strong>{first}</strong>
      {rest.length > 0 ? ` ${rest.join(' ')}` : null}
    </h2>
  )
}

export function SectionHead({
  id,
  title,
  seeAllHref,
  seeAllLabel,
}: {
  id?: string
  title: string
  seeAllHref?: string | null
  seeAllLabel?: string
}): ReactNode {
  return (
    <div className="section-head">
      <SectionTitle id={id} title={title} />
      {seeAllHref ? (
        <a className="see-all" href={seeAllHref}>
          {seeAllLabel ?? 'Ver tudo'}
        </a>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Poster card (2/3) — titulo e o link principal; card todo clicavel   */
/* ------------------------------------------------------------------ */

const KIND_BADGE: Record<string, { label: string; className: string }> = {
  movie: { label: 'Filme', className: 'badge badge--movie badge--overlay' },
  series: { label: 'Série', className: 'badge badge--series badge--overlay' },
  person: { label: 'Pessoa', className: 'badge badge--overlay' },
}

export function PosterCard({
  card,
  showBadge = false,
  wide = false,
}: {
  card: EntityCard
  showBadge?: boolean
  wide?: boolean
}): ReactNode {
  const badge = KIND_BADGE[card.kind]
  const mediaClass = [
    'poster-card__media',
    wide ? 'poster-card__media--wide' : '',
    card.kind === 'person' ? 'poster-card__media--portrait' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className="poster-card">
      <div className={card.image === null ? `${mediaClass} poster-card__media--empty` : mediaClass}>
        {showBadge && badge ? <span className={badge.className}>{badge.label}</span> : null}
        {card.image !== null ? (
          <img
            alt=""
            height={card.image.height}
            loading="lazy"
            src={card.image.src}
            width={card.image.width}
          />
        ) : (
          <span aria-hidden="true">{card.title.slice(0, 1).toUpperCase()}</span>
        )}
      </div>
      <div>
        <h3 className="poster-card__title">
          <a href={card.href}>{card.title}</a>
        </h3>
        {card.meta !== null ? <p className="poster-card__meta">{card.meta}</p> : null}
      </div>
    </article>
  )
}

export function PosterGrid({
  cards,
  columns,
  showBadge = false,
}: {
  cards: readonly EntityCard[]
  columns?: 4 | 6
  showBadge?: boolean
}): ReactNode {
  return (
    <ul className={columns === 4 ? 'poster-grid poster-grid--4' : 'poster-grid'}>
      {cards.map((card) => (
        <li key={card.href}>
          <PosterCard card={card} showBadge={showBadge} />
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* News cards                                                          */
/* ------------------------------------------------------------------ */

export function NewsOverlayCard({
  card,
  lead = false,
}: {
  card: NewsCardView
  lead?: boolean
}): ReactNode {
  return (
    <article className={lead ? 'news-overlay-card news-overlay-card--lead' : 'news-overlay-card'}>
      {card.image !== null ? (
        <img
          alt=""
          className="news-overlay-card__img"
          height={card.image.height}
          loading="lazy"
          src={card.image.src}
          width={card.image.width}
        />
      ) : null}
      <div className="news-overlay-card__scrim" />
      <div className="news-overlay-card__body">
        {card.category !== null ? <span className="eyebrow">{card.category}</span> : null}
        <h3 className="news-overlay-card__title">
          <a href={card.href}>{card.title}</a>
        </h3>
        <p className="news-overlay-card__meta">
          {[card.author, card.dateLabel].filter((part) => part !== null).join(' · ')}
        </p>
      </div>
    </article>
  )
}

export function NewsListCard({ card }: { card: NewsCardView }): ReactNode {
  return (
    <article className="news-list-card">
      <div className="news-list-card__media">
        {card.image !== null ? (
          <img
            alt=""
            height={card.image.height}
            loading="lazy"
            src={card.image.src}
            width={card.image.width}
          />
        ) : null}
      </div>
      <div>
        {card.category !== null ? (
          <span className="eyebrow news-list-card__eyebrow">{card.category}</span>
        ) : null}
        <h3 className="news-list-card__title">
          <a href={card.href}>{card.title}</a>
        </h3>
        <p className="news-list-card__meta">
          {[card.author, card.dateLabel, card.readTimeLabel]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Empty state honesto (sem cards fantasma)                            */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {children}
      {action}
    </div>
  )
}
