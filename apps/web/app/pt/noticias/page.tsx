import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { EmptyState } from '../../_components/ds'
import type { NewsCardView } from '../../../src/lib/news-presenter'
import { HOME_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getNewsIndexData } from '../../../src/server/news-pages'

/**
 * Notícias — tela 03 do canônico, layout MAGAZINE na estrutura EXATA do HTML:
 * header com tabs + leaderboard à direita (74%) + divisor → magazine lead
 * (grid 1fr/290px: coluna esquerda com feature texto+imagem 1.02fr/1.18fr e
 * fileira de 3 cards 16/10; rail direita com posts 4/5 em overlay) → Ad →
 * feed (1fr/340px, itens 240px/1fr) com rail de anúncio. Só artigos
 * PUBLICADOS do CMS real (draft/agendada/retratada nunca chegam aqui).
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Notícias'
const DESCRIPTION =
  'Últimas notícias e análises editoriais da Cinerie sobre cinema e séries, em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getNewsIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

function NewsMeta({ card, light = false }: { card: NewsCardView; light?: boolean }) {
  const items = [card.dateLabel, card.author !== null ? `por ${card.author}` : null].filter(
    (item): item is string => item !== null,
  )
  if (items.length === 0) return null
  return (
    <div className="nws-meta" style={light ? { color: 'rgba(255,255,255,0.78)' } : undefined}>
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  )
}

export default async function NewsIndexPage() {
  const { view, canonicalUrl } = await getNewsIndexData()
  const orderedCards = [view.featured, ...view.cards].filter(
    (card): card is NewsCardView => card !== null,
  )
  const feature = orderedCards[0]
  const cards3 = orderedCards.slice(1, 4)
  const railPosts = orderedCards.slice(4, 6)
  const feed = orderedCards.slice(6)
  const categories = [
    ...new Set(orderedCards.map((card) => card.category).filter((c): c is string => c !== null)),
  ].slice(0, 4)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Início',
        item: `${SITE_URL}${HOME_PATH}`,
      },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  }
  if (orderedCards.length > 0) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: orderedCards.length,
      itemListElement: orderedCards.map((card, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    }
  }

  return (
    <main data-vertical="news">
      <h1 className="visually-hidden">{TITLE}</h1>

      <div className="container">
        {/* Header: tabs + leaderboard à direita + divisor */}
        <div className="nws-header">
          <nav aria-label="Categorias de notícias" className="nws-tabs">
            <a aria-current="true" href="/pt/noticias/">
              Todas
            </a>
            {categories.map((category) => (
              <a href="/pt/noticias/" key={category}>
                {category}
              </a>
            ))}
          </nav>
          <div className="nws-header__ad">
            <AdSlot format="leaderboard" slotId="news-header" />
          </div>
        </div>
        <div className="nws-divider" />

        {feature !== undefined ? (
          <div className="nws-lead-grid">
            {/* LEFT: feature + 3 cards */}
            <div>
              <div className="nws-feature">
                <a href={feature.href}>
                  {feature.category !== null ? (
                    <span className="nws-cat">{feature.category}</span>
                  ) : null}
                  <h2 className="nws-feature__title">{feature.title}</h2>
                  <NewsMeta card={feature} />
                  {feature.deck !== null ? (
                    <p className="nws-feature__excerpt">{feature.deck}</p>
                  ) : null}
                  <span className="nws-readmore">Ler mais →</span>
                </a>
                <a aria-hidden="true" className="nws-feature__img" href={feature.href} tabIndex={-1}>
                  {feature.image !== null ? (
                    <img alt="" fetchPriority="high" src={feature.image.src} />
                  ) : null}
                </a>
              </div>

              {cards3.length > 0 ? (
                <ul className="nws-cards3">
                  {cards3.map((card) => (
                    <li key={card.href}>
                      <a href={card.href}>
                        <span className="nws-card__cover">
                          {card.image !== null ? (
                            <img alt="" loading="lazy" src={card.image.src} />
                          ) : null}
                        </span>
                        <h3 className="nws-card__title">{card.title}</h3>
                        {card.deck !== null ? (
                          <p className="nws-card__excerpt">{card.deck}</p>
                        ) : null}
                        <NewsMeta card={card} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* RAIL: posts 4/5 em overlay */}
            {railPosts.length > 0 ? (
              <ul className="nws-rail">
                {railPosts.map((card) => (
                  <li key={card.href}>
                    <a className="nws-rail__post" href={card.href}>
                      {card.image !== null ? (
                        <img alt="" loading="lazy" src={card.image.src} />
                      ) : null}
                      <span className="nws-rail__body">
                        <h3 className="nws-rail__title">{card.title}</h3>
                        <NewsMeta card={card} light />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="section">
            <EmptyState title="Ainda não há notícias publicadas nesta seção.">
              <p>A redação da Cinerie publica novas matérias em breve.</p>
            </EmptyState>
          </div>
        )}

        <AdSlot format="leaderboard" slotId="news-mid" />

        {/* Feed + rail */}
        {feed.length > 0 ? (
          <div className="nws-feed section">
            <ul className="nws-feed__list">
              {feed.map((card) => (
                <li key={card.href}>
                  <a className="nws-feed__item" href={card.href}>
                    <span className="nws-feed__thumb">
                      {card.image !== null ? (
                        <img alt="" loading="lazy" src={card.image.src} />
                      ) : null}
                    </span>
                    <span>
                      {card.category !== null ? (
                        <span className="eyebrow news-list-card__eyebrow">{card.category}</span>
                      ) : null}
                      <h3 className="nws-card__title" style={{ marginTop: 8 }}>
                        {card.title}
                      </h3>
                      {card.deck !== null ? (
                        <p className="nws-card__excerpt">{card.deck}</p>
                      ) : null}
                      <NewsMeta card={card} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <div>
              <AdSlot format="skyscraper" slotId="news-feed-rail" />
            </div>
          </div>
        ) : null}

        {view.hasMore ? (
          <p className="muted" style={{ marginTop: 20 }}>
            Mostrando {orderedCards.length} de {view.totalCount} notícias.
          </p>
        ) : null}
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
