import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { EmptyState, SectionHead } from '../../_components/ds'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getWatchBrowseData } from '../../../src/server/watch-browse'

/**
 * Onde assistir — tela 10 do handoff (CatalogBrowseTemplate, contexto neutro):
 * hub por PROVEDOR com titulos licenciados. So oferta com licenca vigente e
 * credito devido (invariante 6, mesma clausula do painel por entidade);
 * provedor sem titulos elegiveis e OMITIDO — nunca "streaming inventado".
 * Carimbo "Atualizado em" sempre presente quando ha dado (regra de ingestao).
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Onde assistir'
const DESCRIPTION =
  'Filmes e séries com disponibilidade legal de streaming no Brasil, organizados por provedor.'
const BROWSE_PATH = '/pt/onde-assistir/'

const OFFER_LABELS: Readonly<Record<string, string>> = {
  subscription: 'Assinatura',
  rent: 'Aluguel',
  buy: 'Compra',
  free: 'Grátis',
  ads: 'Com anúncios',
  addon: 'Canal adicional',
}

function formatUpdatedAt(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(date)
}

export async function generateMetadata(): Promise<Metadata> {
  const { providers } = await getWatchBrowseData()
  return {
    title: TITLE,
    description: DESCRIPTION,
    // Indexa so quando ha conteudo real (listagem vazia = noindex tecnico).
    robots: publicRobots(providers.length > 0),
    alternates: { canonical: canonicalPublicUrl(BROWSE_PATH) },
  }
}

export default async function WatchBrowsePage() {
  const { providers, updatedAtIso, attributions } = await getWatchBrowseData()
  const updatedLabel = formatUpdatedAt(updatedAtIso)
  const canonicalUrl = canonicalPublicUrl(BROWSE_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  return (
    <main data-vertical="watch">
      <div className="container">
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header className="compact-hero page-header">
          <h1>{TITLE}</h1>
          <p>{DESCRIPTION}</p>
          {updatedLabel !== null ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Atualizado em {updatedLabel}. As ofertas podem mudar conforme região e assinatura.
            </p>
          ) : null}
        </header>

        <AdSlot format="leaderboard" slotId="browse-filters" />

        {providers.length > 0 ? (
          providers.map((provider) => (
            <section
              aria-labelledby={`provider-${provider.providerKey}`}
              className="section"
              key={provider.providerKey}
            >
              <SectionHead id={`provider-${provider.providerKey}`} title={provider.providerName} />
              <ul className="news-grid">
                {provider.titles.map((title) => (
                  <li key={`${provider.providerKey}:${title.href}`}>
                    <article className="news-list-card" style={{ gridTemplateColumns: '1fr' }}>
                      <div>
                        <span
                          className={
                            title.entityType === 'movie'
                              ? 'badge badge--movie'
                              : 'badge badge--series'
                          }
                        >
                          {title.entityType === 'movie' ? 'Filme' : 'Série'}
                        </span>
                        <h3 className="news-list-card__title">
                          <a href={title.href}>{title.title}</a>
                        </h3>
                        {title.offerTypes.length > 0 ? (
                          <p className="news-list-card__meta">
                            {title.offerTypes
                              .map((offer) => OFFER_LABELS[offer] ?? offer)
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <EmptyState title="Ainda não há disponibilidade de streaming licenciada para exibir.">
            <p>
              Quando houver ofertas com licença de exibição confirmada, elas aparecem aqui com o
              provedor e a data de atualização.
            </p>
          </EmptyState>
        )}

        {attributions.length > 0 ? (
          <p className="watch-availability__attribution" style={{ marginTop: 32 }}>
            {attributions.map((attribution, index) => (
              <span key={attribution.text}>
                {index > 0 ? ' · ' : null}
                {attribution.url !== null ? (
                  <a href={attribution.url} rel="nofollow noopener" target="_blank">
                    {attribution.text}
                  </a>
                ) : (
                  attribution.text
                )}
              </span>
            ))}
          </p>
        ) : null}

        <AdSlot format="leaderboard" slotId="browse-grid" />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
