import type { ReactNode } from 'react'

import { serializeJsonLd } from '@screena/seo'

import { EmptyState, PosterGrid } from './ds'
import type { EntityIndexView } from '../../src/lib/entity-index-presenter'
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

const DEFAULT_EMPTY_MESSAGES: Readonly<Record<EntityIndexVertical, string>> = {
  movie: 'Ainda não há filmes publicados nesta seção.',
  series: 'Ainda não há séries publicadas nesta seção.',
  person: 'Ainda não há pessoas publicadas nesta seção.',
}

/** Rotulo textual do contexto — a cor NUNCA e o unico sinal (invariante 11). */
const VERTICAL_EYEBROW: Readonly<Record<EntityIndexVertical, string>> = {
  movie: 'Cinema',
  series: 'Séries',
  person: 'Pessoas',
}

/**
 * Listagem de entidades no design canonico (tela 04 / CatalogBrowseTemplate):
 * breadcrumb + hero compacto com eyebrow por contexto + grid de posteres 2/3.
 * Dados 100% reais; sem card fantasma; empty state honesto.
 */
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

        <header className="compact-hero page-header">
          <p className="compact-hero__eyebrow">{VERTICAL_EYEBROW[vertical]}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </header>

        {hasItems ? (
          <>
            <PosterGrid cards={view.cards} />
            {view.hasMore ? (
              <p className="muted" style={{ marginTop: 24 }}>
                Mostrando os primeiros {view.cards.length} de {view.totalCount}.
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState title={emptyMessage ?? DEFAULT_EMPTY_MESSAGES[vertical]} />
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
