import type { ReactNode } from 'react'

import type { EntityCard, EntityIndexView } from '../../src/lib/entity-index-presenter'
import { SITE_URL } from '../../src/lib/site'

export type EntityIndexVertical = 'movie' | 'series' | 'person'

interface EntityIndexProps {
  title: string
  description: string
  breadcrumbLabel: string
  canonicalUrl: string
  vertical: EntityIndexVertical
  view: EntityIndexView
  emptyMessage?: string
}

const ENTITY_KIND_LABELS: Readonly<Record<EntityCard['kind'], string>> = {
  movie: 'Filme',
  series: 'Série',
  person: 'Pessoa',
}

const DEFAULT_EMPTY_MESSAGES: Readonly<Record<EntityIndexVertical, string>> = {
  movie: 'Ainda não há filmes publicados nesta seção.',
  series: 'Ainda não há séries publicadas nesta seção.',
  person: 'Ainda não há pessoas publicadas nesta seção.',
}

/** Lista textual de entidades reais; sem pôster, card ou fallback decorativo. */
export function EntityIndex({
  title,
  description,
  breadcrumbLabel,
  canonicalUrl,
  vertical,
  view,
  emptyMessage,
}: EntityIndexProps): ReactNode {
  const hasItems = view.cards.length > 0
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: breadcrumbLabel, item: canonicalUrl },
    ],
  }
  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    url: canonicalUrl,
    description,
  }

  if (hasItems) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: view.cards.length,
      itemListElement: view.cards.map((card, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    }
  }

  return (
    <main className="entity-index" data-vertical={vertical}>
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href="/pt/">Início</a>
            </li>
            <li aria-current="page">{breadcrumbLabel}</li>
          </ol>
        </nav>

        <header className="page-header">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>

        {hasItems ? (
          <>
            <ul className="entity-list">
              {view.cards.map((card) => (
                <li key={card.href}>
                  <a href={card.href}>
                    <span className="entity-list__kind">{ENTITY_KIND_LABELS[card.kind]}: </span>
                    <span>{card.title}</span>
                    {card.meta !== null ? <span> — {card.meta}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
            {view.hasMore ? (
              <p>
                Mostrando os primeiros {view.cards.length} de {view.totalCount}.
              </p>
            ) : null}
          </>
        ) : (
          <p>{emptyMessage ?? DEFAULT_EMPTY_MESSAGES[vertical]}</p>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  )
}
