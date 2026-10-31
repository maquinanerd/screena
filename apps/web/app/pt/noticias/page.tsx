import type { Metadata } from 'next'
import { Fragment } from 'react'

import { serializeJsonLd, websiteId } from '@screena/seo'

import { EmptyState } from '../../_components/ds'
import { AdSlot } from '../../_components/opapreco/ad-slot'
import type { NewsCardView } from '../../../src/lib/news-presenter'
import { HOME_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'
import { getNewsIndexData } from '../../../src/server/news-pages'
import './news.css'

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

/** Tags da página para o ad server OpaPreço: a vertical de notícias. */
const NEWS_AD_TAGS = { vertical: 'news' } as const

/** A grade OpaPreço do meio do feed entra depois deste card (`adAfter` do canônico). */
const FEED_INLINE_AFTER = 3
// O <title> diz o que a pagina tem; o H1 e a trilha continuam "Notícias" (ver a
// nota gemea em /pt/filmes/).
const META_TITLE = 'Notícias de cinema e séries'
// A descricao aparece no resultado da busca E abaixo do H1. Reescrita em
// 22/09/2026: a anterior tinha menos de 100 caracteres e prometia "paginas
// editoriais" que a ficha de catalogo nao e; esta diz o que a listagem entrega.
const DESCRIPTION =
  'Notícias de cinema e séries em português: estreias, trailers, bastidores e análises da redação da Cinerie.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getNewsIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: META_TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({ type: 'website', title: META_TITLE, description: DESCRIPTION, canonicalUrl }),
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
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
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
        {/* Header: tabs + faixa OpaPreço 728×90 à direita + divisor. A faixa é
            um product_compact_v1 (nunca uma grade) com `flex: 0 1 728px;
            min-width: 0`: encolhe com a coluna e, abaixo de 1024px, desce
            para uma linha própria sob as abas. */}
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
          <AdSlot className="nws-header__ad" id="news-top" tags={NEWS_AD_TAGS} />
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
                  {/* A imagem é o identificador visual do link, então carrega o
                      `alt` aprovado quando existe. `?? ""` quando não existe: o
                      CMS não aprovou descrição, e alt inventado é pior que
                      nenhum — o texto do card já nomeia o link. */}
                  {feature.image !== null ? (
                    <img alt={feature.image.alt ?? ''} fetchPriority="high" src={feature.image.src} />
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
                            <img alt={card.image.alt ?? ''} loading="lazy" src={card.image.src} />
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
                        <img alt={card.image.alt ?? ''} loading="lazy" src={card.image.src} />
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

        {/* OpaPreço · news-feed-01 — grade antes do feed (margem 56/0). */}
        <AdSlot className="cin-adslot--news-feed" id="news-feed-01" tags={NEWS_AD_TAGS} />

        {/* Feed + rail */}
        {feed.length > 0 ? (
          <div className="nws-feed section">
            <ul className="nws-feed__list">
              {feed.map((card, index) => (
                <Fragment key={card.href}>
                <li>
                  <a className="nws-feed__item" href={card.href}>
                    <span className="nws-feed__thumb">
                      {card.image !== null ? (
                        <img alt={card.image.alt ?? ''} loading="lazy" src={card.image.src} />
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
                {/* OpaPreço · news-feed-inline — uma grade depois do 3º card do
                    feed (o `adAfter` do canônico), só se houver feed depois
                    dela: dois slots nunca ficam colados sem editorial entre. */}
                {index === FEED_INLINE_AFTER - 1 && feed.length > FEED_INLINE_AFTER ? (
                  <li className="nws-feed__ad">
                    <AdSlot id="news-feed-inline" tags={NEWS_AD_TAGS} />
                  </li>
                ) : null}
                </Fragment>
              ))}
            </ul>
            {/* OpaPreço · news-sidebar — product_card_v1 sticky, só >= 1024px. */}
            <div className="nws-feed__rail">
              <AdSlot id="news-sidebar" tags={NEWS_AD_TAGS} />
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
