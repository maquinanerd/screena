import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { PrevNextNav } from '../../../../../_components/prev-next-nav'
import { parseRouteNumber, seasonPath } from '../../../../../../src/lib/routes'
import { SERIES_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../../../src/lib/site'
import { getSeasonPageData } from '../../../../../../src/server/season-page'

/**
 * Pagina publica de temporada (/pt/series/[slug]/temporadas/[season]/). Shell
 * textual atual: mantem dados reais, navegacao e contratos de SEO da Fase 3 sem
 * introduzir a camada visual do design (imagens ficam resolvidas na view,
 * prontas para o design futuro, como nas paginas de filme/serie).
 */

export const revalidate = 3600

interface SeasonRouteParams {
  slug: string
  season: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SeasonRouteParams>
}): Promise<Metadata> {
  const { slug, season } = await params
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }
  const data = await getSeasonPageData(slug, seasonNumber)
  if (data === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }

  const { view, seo, canonicalUrl } = data
  const title = `${view.seriesTitle} — ${view.seasonTitle}`
  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
    openGraph: { title, url: canonicalUrl, type: 'website' },
  }
  if (view.overview !== null) {
    metadata.description = view.overview
    metadata.openGraph = { ...metadata.openGraph, description: view.overview }
  }
  return metadata
}

export default async function SeasonPage({ params }: { params: Promise<SeasonRouteParams> }) {
  const { slug, season } = await params
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) notFound()

  const data = await getSeasonPageData(slug, seasonNumber)
  if (data === null) notFound()

  if (slug !== data.canonicalSlug) {
    const target = seasonPath(data.canonicalSlug, seasonNumber)
    if (target !== null) permanentRedirect(target)
  }

  const { view, seo, canonicalUrl, seriesUrl } = data
  const isUnderReview = seo.decision !== 'index'
  const seriesHref = `${SERIES_INDEX_PATH}${view.seriesSlug}/`
  const headerMeta = [view.dateLabel, view.episodeCountLabel].filter(
    (item): item is string => item !== null,
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: 'Séries', item: `${SITE_URL}${SERIES_INDEX_PATH}` },
      { '@type': 'ListItem', position: 3, name: view.seriesTitle, item: seriesUrl },
      { '@type': 'ListItem', position: 4, name: view.seasonTitle, item: canonicalUrl },
    ],
  }

  const seasonJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVSeason',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: view.seasonTitle,
    seasonNumber: view.seasonNumber,
    mainEntityOfPage: canonicalUrl,
    partOfSeries: { '@type': 'TVSeries', name: view.seriesTitle, url: seriesUrl },
  }
  if (view.overview !== null) seasonJsonLd.description = view.overview
  if (view.episodeCount !== null) seasonJsonLd.numberOfEpisodes = view.episodeCount
  if (view.airYear !== null) seasonJsonLd.datePublished = String(view.airYear)

  return (
    <main data-vertical="series">
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={SERIES_INDEX_PATH}>Séries</a>
            </li>
            <li>
              <a href={seriesHref}>{view.seriesTitle}</a>
            </li>
            <li aria-current="page">{view.seasonTitle}</li>
          </ol>
        </nav>

        <header>
          <p>
            <strong data-entity-badge="series">Temporada</strong>
          </p>
          <h1>
            {view.seriesTitle} — {view.seasonTitle}
          </h1>
          {headerMeta.length > 0 ? <p>{headerMeta.join(' · ')}</p> : null}
          {view.overview !== null ? <p>{view.overview}</p> : null}
          <p>
            <a href={seriesHref}>Voltar para {view.seriesTitle}</a>
          </p>
        </header>

        <PrevNextNav
          ariaLabel="Navegação entre temporadas"
          previousItemLabel="Temporada anterior"
          nextItemLabel="Próxima temporada"
          previous={view.prevSeason}
          next={view.nextSeason}
        />

        <section aria-labelledby="temporada-episodios-titulo">
          <h2 id="temporada-episodios-titulo">Episódios</h2>
          {view.episodes.length > 0 ? (
            <ol>
              {view.episodes.map((episode) => {
                const meta = [episode.dateLabel, episode.runtimeLabel].filter(
                  (item): item is string => item !== null,
                )
                return (
                  <li key={episode.episodeNumber}>
                    <article>
                      <h3>
                        <a href={episode.href}>
                          E{episode.episodeNumber}
                          {episode.title !== null ? ` · ${episode.title}` : ''}
                        </a>
                      </h3>
                      {meta.length > 0 ? <p>{meta.join(' · ')}</p> : null}
                      {episode.summary !== null ? <p>{episode.summary}</p> : null}
                    </article>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p>Nenhum episódio publicado nesta temporada.</p>
          )}
        </section>

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta página ainda está em revisão editorial.</p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(seasonJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
