import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { PrevNextNav } from '../../../../../../../_components/prev-next-nav'
import { episodePath, parseRouteNumber } from '../../../../../../../../src/lib/routes'
import { SERIES_INDEX_PATH, SITE_URL } from '../../../../../../../../src/lib/site'
import { getEpisodePageData } from '../../../../../../../../src/server/episode-page'

/**
 * Pagina publica de episodio
 * (/pt/series/[slug]/temporadas/[season]/episodios/[episode]/). Shell textual
 * atual: dados reais + navegacao + contratos de SEO da Fase 3, sem introduzir a
 * camada visual do design (still resolvido na view, pronto para o design).
 */

export const revalidate = 3600

interface EpisodeRouteParams {
  slug: string
  season: string
  episode: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<EpisodeRouteParams>
}): Promise<Metadata> {
  const { slug, season, episode } = await params
  const seasonNumber = parseRouteNumber(season)
  const episodeNumber = parseRouteNumber(episode)
  if (seasonNumber === null || episodeNumber === null) {
    return { title: 'Episódio não encontrado', robots: { index: false, follow: false } }
  }
  const data = await getEpisodePageData(slug, seasonNumber, episodeNumber)
  if (data === null) {
    return { title: 'Episódio não encontrado', robots: { index: false, follow: false } }
  }

  const { view, seo, canonicalUrl } = data
  const title = `${view.episodeTitle} — ${view.seriesTitle}, T${view.seasonNumber} E${view.episodeNumber}`
  const metadata: Metadata = {
    title,
    robots: seo.robots,
    alternates: { canonical: canonicalUrl },
    openGraph: { title, url: canonicalUrl, type: 'website' },
  }
  if (view.overview !== null) {
    metadata.description = view.overview
    metadata.openGraph = { ...metadata.openGraph, description: view.overview }
  }
  return metadata
}

export default async function EpisodePage({ params }: { params: Promise<EpisodeRouteParams> }) {
  const { slug, season, episode } = await params
  const seasonNumber = parseRouteNumber(season)
  const episodeNumber = parseRouteNumber(episode)
  if (seasonNumber === null || episodeNumber === null) notFound()

  const data = await getEpisodePageData(slug, seasonNumber, episodeNumber)
  if (data === null) notFound()

  if (slug !== data.canonicalSlug) {
    const target = episodePath(data.canonicalSlug, seasonNumber, episodeNumber)
    if (target !== null) permanentRedirect(target)
  }

  const { view, seo, canonicalUrl, seasonUrl, seriesUrl } = data
  const isUnderReview = seo.decision !== 'index'
  const seriesHref = `${SERIES_INDEX_PATH}${view.seriesSlug}/`
  const headerMeta = [view.dateLabel, view.runtimeLabel].filter(
    (item): item is string => item !== null,
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: 'Séries', item: `${SITE_URL}${SERIES_INDEX_PATH}` },
      { '@type': 'ListItem', position: 3, name: view.seriesTitle, item: seriesUrl },
      { '@type': 'ListItem', position: 4, name: view.seasonTitle, item: seasonUrl },
      { '@type': 'ListItem', position: 5, name: view.episodeTitle, item: canonicalUrl },
    ],
  }

  const episodeJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: view.episodeTitle,
    episodeNumber: view.episodeNumber,
    mainEntityOfPage: canonicalUrl,
    partOfSeason: {
      '@type': 'TVSeason',
      seasonNumber: view.seasonNumber,
      url: seasonUrl,
    },
    partOfSeries: { '@type': 'TVSeries', name: view.seriesTitle, url: seriesUrl },
  }
  if (view.overview !== null) episodeJsonLd.description = view.overview
  if (view.airYear !== null) episodeJsonLd.datePublished = String(view.airYear)

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
            <li>
              {view.seasonHref !== null ? (
                <a href={view.seasonHref}>{view.seasonTitle}</a>
              ) : (
                <span>{view.seasonTitle}</span>
              )}
            </li>
            <li aria-current="page">{view.episodeTitle}</li>
          </ol>
        </nav>

        <header>
          <p>
            <strong data-entity-badge="series">Episódio</strong>
          </p>
          <h1>{view.episodeTitle}</h1>
          <p>
            {view.seriesTitle} · T{view.seasonNumber} E{view.episodeNumber}
          </p>
          {headerMeta.length > 0 ? <p>{headerMeta.join(' · ')}</p> : null}
          {view.overview !== null ? <p>{view.overview}</p> : null}
        </header>

        <PrevNextNav
          ariaLabel="Navegação entre episódios"
          previousItemLabel="Episódio anterior"
          nextItemLabel="Próximo episódio"
          previous={view.prevEpisode}
          next={view.nextEpisode}
        />

        <nav aria-label="Voltar">
          <ul>
            {view.seasonHref !== null ? (
              <li>
                <a href={view.seasonHref}>Ver {view.seasonTitle}</a>
              </li>
            ) : null}
            <li>
              <a href={seriesHref}>Ver {view.seriesTitle}</a>
            </li>
          </ul>
        </nav>

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta página ainda está em revisão editorial.</p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(episodeJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
