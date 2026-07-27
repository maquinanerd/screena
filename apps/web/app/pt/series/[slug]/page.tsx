import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import type { SeriesEpisodeView, SeriesSeasonView } from '../../../../src/lib/series-presenter'
import { NEWS_INDEX_PATH, SITE_URL, gatePublicRobots, seasonPath } from '../../../../src/lib/site'
import { getSeriesPageData } from '../../../../src/server/series-page'

/**
 * Ficha pública mínima de série. O shell mantém dados, navegação de temporadas
 * e contratos de SEO sem carregar a composição visual do design anterior.
 */

export const revalidate = 3600

const SERIES_INDEX_PATH = '/pt/series/'
const REVIEW_BLOCK_TYPE = 'review_summary'
const WORK_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'editorial_intro',
  'summary_without_spoilers',
  'franchise_context',
])
const EPISODE_BLOCK_TYPES: ReadonlySet<string> = new Set(['season_guide', 'episode_context'])

interface SeriesPageParams {
  slug: string
}

interface SeriesPageSearchParams {
  temporada?: string | string[]
}

interface SeriesFact {
  label: string
  value: string
}

function seasonNumberFromQuery(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === undefined || !/^\d+$/.test(candidate)) return null
  const seasonNumber = Number(candidate)
  return Number.isSafeInteger(seasonNumber) ? seasonNumber : null
}

function EpisodeRow({
  episode,
  seasonNumber,
}: {
  episode: SeriesEpisodeView
  seasonNumber: number
}): ReactNode {
  const episodeMeta = [
    episode.airYear !== null ? String(episode.airYear) : null,
    episode.runtimeLabel,
  ].filter((item): item is string => item !== null)

  return (
    <li>
      <article>
        <h4>
          T{seasonNumber} · E{episode.episodeNumber}
        </h4>
        {episode.title !== null ? <p>{episode.title}</p> : null}
        {episode.overview !== null ? <p>{episode.overview}</p> : null}
        {episodeMeta.length > 0 ? <p>{episodeMeta.join(' · ')}</p> : null}
      </article>
    </li>
  )
}

function SeasonGroup({ season }: { season: SeriesSeasonView }): ReactNode {
  const seasonMeta = [
    season.episodeCountLabel,
    season.airYear !== null ? String(season.airYear) : null,
  ].filter((item): item is string => item !== null)

  return (
    <section
      id={`temporada-${season.seasonNumber}`}
      aria-labelledby={`temporada-${season.seasonNumber}-titulo`}
    >
      <h3 id={`temporada-${season.seasonNumber}-titulo`}>{season.title}</h3>
      {seasonMeta.length > 0 ? <p>{seasonMeta.join(' · ')}</p> : null}
      {season.overview !== null ? <p>{season.overview}</p> : null}
      {season.episodes.length > 0 ? (
        <ol>
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={episode.episodeNumber}
              episode={episode}
              seasonNumber={season.seasonNumber}
            />
          ))}
        </ol>
      ) : (
        <p>Nenhum episódio publicado nesta temporada.</p>
      )}
    </section>
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SeriesPageParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getSeriesPageData(slug)

  if (data === null) {
    return {
      title: 'Série não encontrada',
      robots: { index: false, follow: false },
    }
  }

  const { view, seo, canonicalUrl } = data
  const title =
    view.metaTitle ??
    `${view.title}${view.periodLabel !== null ? ` (${view.periodLabel})` : ''} — Série`

  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
  }
  if (view.metaDescription !== null) metadata.description = view.metaDescription
  return metadata
}

export default async function SeriesPage({
  params,
  searchParams,
}: {
  params: Promise<SeriesPageParams>
  searchParams: Promise<SeriesPageSearchParams>
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  const data = await getSeriesPageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(SERIES_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, entityId, seo, canonicalUrl, relatedNews, cast, watch, ratings, externalIds } = data
  const isUnderReview = seo.decision !== 'index'
  const summary = [view.periodLabel, view.seasonsCountLabel, view.episodesCountLabel].filter(
    (item): item is string => item !== null,
  )
  const facts = [
    view.periodLabel === null ? null : { label: 'Período', value: view.periodLabel },
    view.statusLabel === null ? null : { label: 'Situação', value: view.statusLabel },
    view.seasonsCountLabel === null ? null : { label: 'Temporadas', value: view.seasonsCountLabel },
    view.episodesCountLabel === null
      ? null
      : { label: 'Episódios', value: view.episodesCountLabel },
    view.originalLanguageLabel === null
      ? null
      : { label: 'Idioma original', value: view.originalLanguageLabel },
  ].filter((fact): fact is SeriesFact => fact !== null)
  const externalLinks = buildExternalLinks(externalIds, 'tv')
  const critiqueBlock = view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null
  const editorialBlocks = view.blocks.filter((block) => WORK_BLOCK_TYPES.has(block.blockType))
  const episodeContextBlocks = view.blocks.filter((block) =>
    EPISODE_BLOCK_TYPES.has(block.blockType),
  )
  const watchContext =
    view.blocks.find((block) => block.blockType === 'where_to_watch_text') ?? null
  const castContext = view.blocks.find((block) => block.blockType === 'cast_intro') ?? null
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const requestedSeasonNumber = seasonNumberFromQuery(query.temporada)
  const selectedSeason =
    view.seasons.find((season) => season.seasonNumber === requestedSeasonNumber) ??
    view.seasons[0] ??
    null
  const visibleCast = cast.slice(0, 6)
  const visibleNews = relatedNews.slice(0, 3)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Séries',
        item: `${SITE_URL}${SERIES_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.title, item: canonicalUrl },
    ],
  }

  const seriesJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    '@id': canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  }
  if (view.firstAirYear !== null) seriesJsonLd.startDate = String(view.firstAirYear)
  if (view.lastAirYear !== null) seriesJsonLd.endDate = String(view.lastAirYear)
  if (view.metaDescription !== null) seriesJsonLd.description = view.metaDescription
  const sameAs = buildSameAs(externalIds, 'tv')
  if (sameAs.length > 0) seriesJsonLd.sameAs = sameAs

  return (
    <main data-vertical="series">
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={SERIES_INDEX_PATH}>Séries</a>
            </li>
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>

        <header>
          <p>
            <strong data-entity-badge="series">Série</strong>
          </p>
          <h1>{view.title}</h1>
          {summary.length > 0 ? <p>{summary.join(' · ')}</p> : null}
          {view.metaDescription !== null ? <p>{view.metaDescription}</p> : null}
          {externalLinks.length > 0 ? <EntityExternalIds links={externalLinks} /> : null}
        </header>

        {/* Acoes de biblioteca e tracker (C8). Client component, sem chamada
            externa no render. */}
        <EntityActions entityType="tv" entityId={entityId} />
        <p>
          <a href="/pt/tracker">Acompanhar o progresso desta serie no tracker</a>
        </p>

        {watch !== null ? (
          <section aria-label="Disponibilidade legal">
            <WatchAvailabilityPanel view={watch} />
            {watchContext !== null ? (
              <p data-block-type={watchContext.blockType}>{watchContext.content}</p>
            ) : null}
          </section>
        ) : null}

        {/* Notas de terceiros, cada uma na escala da propria fonte e creditada.
            O painel se auto-omite quando nao ha nota licenciada: fonte desligada
            some da pagina sem deixar buraco nem quebrar o layout. */}
        <RatingsPanel view={ratings} />

        {editorialBlocks.length > 0 ? (
          <section aria-labelledby="series-work-title">
            <h2 id="series-work-title">A obra</h2>
            {editorialBlocks.map((block) => (
              <p key={block.blockType} data-block-type={block.blockType}>
                {block.content}
              </p>
            ))}
          </section>
        ) : null}

        {critiqueBlock !== null ? (
          <section aria-labelledby="series-review-title">
            <h2 id="series-review-title">Crítica da redação</h2>
            <p data-block-type={critiqueBlock.blockType}>{critiqueBlock.content}</p>
          </section>
        ) : null}

        {view.seasons.length > 0 ? (
          <section id="episodios" aria-labelledby="series-episodes-title">
            <h2 id="series-episodes-title">Episódios</h2>
            <nav aria-label="Temporadas">
              <ul>
                {view.seasons.map((season) => {
                  const seasonHref =
                    seasonPath(data.canonicalSlug, season.seasonNumber) ??
                    `?temporada=${season.seasonNumber}#episodios`
                  return (
                    <li key={season.seasonNumber}>
                      <a href={seasonHref}>Temporada {season.seasonNumber}</a>
                    </li>
                  )
                })}
              </ul>
            </nav>
            {episodeContextBlocks.map((block) => (
              <p key={block.blockType} data-block-type={block.blockType}>
                {block.content}
              </p>
            ))}
            {selectedSeason !== null ? (
              <SeasonGroup key={selectedSeason.seasonNumber} season={selectedSeason} />
            ) : null}
          </section>
        ) : null}

        {visibleCast.length > 0 ? (
          <section aria-labelledby="series-cast-title">
            <h2 id="series-cast-title">Elenco principal</h2>
            {castContext !== null ? (
              <p data-block-type={castContext.blockType}>{castContext.content}</p>
            ) : null}
            <ul>
              {visibleCast.map((member, index) => (
                <li key={`${member.name}-${index}`}>
                  {member.href !== null ? (
                    <a href={member.href}>{member.name}</a>
                  ) : (
                    <span>{member.name}</span>
                  )}
                  {member.character !== null ? <span> — {member.character}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {visibleNews.length > 0 ? (
          <section aria-labelledby="series-news-title">
            <h2 id="series-news-title">Notícias relacionadas</h2>
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul>
              {visibleNews.map((card) => {
                const meta = [card.author, card.dateLabel, card.readTimeLabel].filter(
                  (item): item is string => item !== null,
                )

                return (
                  <li key={card.href}>
                    <article>
                      <h3>
                        <a href={card.href}>{card.title}</a>
                      </h3>
                      {card.category !== null ? <p>{card.category}</p> : null}
                      {meta.length > 0 ? <p>{meta.join(' · ')}</p> : null}
                    </article>
                  </li>
                )
              })}
            </ul>
            <p>
              <a href={NEWS_INDEX_PATH}>Ver todas as notícias</a>
            </p>
          </section>
        ) : null}

        {facts.length > 0 ? (
          <section aria-labelledby="series-details-title">
            <h2 id="series-details-title">Ficha técnica</h2>
            <dl>
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta página ainda está em revisão editorial.</p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(seriesJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
