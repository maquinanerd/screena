import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { NewsListCard, SectionHead } from '../../../_components/ds'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import type { SeriesEpisodeView, SeriesSeasonView } from '../../../../src/lib/series-presenter'
import { NEWS_INDEX_PATH, SITE_URL, gatePublicRobots, seasonPath } from '../../../../src/lib/site'
import { getSeriesPageData } from '../../../../src/server/series-page'

/**
 * Detalhe de série — tela 07 do handoff (SeriesDetailTemplate, EX-07-nohero):
 * top info bar CLARA com acento verde ESCURO em texto (DD-03: branco sobre
 * verde claro falha AA), seletor de temporadas com overflow horizontal (a
 * variante mobile da tela 08 e este mesmo template no breakpoint 390) e lista
 * de episódios da temporada SELECIONADA — nunca as ~21k linhas de uma serie
 * grande de uma vez: a paginacao por temporada ja vem do getter.
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
      <article className="episode-row">
        {episode.still !== null ? (
          <div className="episode-row__media">
            <img
              alt=""
              height={episode.still.height}
              loading="lazy"
              src={episode.still.src}
              width={episode.still.width}
            />
          </div>
        ) : (
          <div aria-hidden="true" className="episode-row__media" />
        )}
        <div>
          <p className="episode-row__code">
            T{seasonNumber} · E{episode.episodeNumber}
          </p>
          {episode.title !== null ? (
            <h4 className="episode-row__title" style={{ letterSpacing: 0, textTransform: 'none' }}>
              {episode.title}
            </h4>
          ) : null}
          {episode.overview !== null ? (
            <p className="episode-row__meta">{episode.overview}</p>
          ) : null}
          {episodeMeta.length > 0 ? (
            <p className="episode-row__meta">{episodeMeta.join(' · ')}</p>
          ) : null}
        </div>
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
      {seasonMeta.length > 0 ? <p className="muted">{seasonMeta.join(' · ')}</p> : null}
      {season.overview !== null ? <p>{season.overview}</p> : null}
      {season.episodes.length > 0 ? (
        <ol className="episode-list">
          {season.episodes.map((episode) => (
            <EpisodeRow
              key={episode.episodeNumber}
              episode={episode}
              seasonNumber={season.seasonNumber}
            />
          ))}
        </ol>
      ) : (
        <p className="muted">Nenhum episódio publicado nesta temporada.</p>
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
  const topMeta = [view.periodLabel, view.seasonsCountLabel, view.episodesCountLabel, view.statusLabel].filter(
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
  const visibleCast = cast.slice(0, 8)
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
      {/* Top info bar clara (EX-07-nohero) */}
      <div className="topinfo">
        <div className="container">
          <nav aria-label="Trilha de navegação" className="breadcrumb">
            <ol>
              <li>
                <a href="/pt/">Início</a>
              </li>
              <li>
                <a href={SERIES_INDEX_PATH}>Séries</a>
              </li>
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>

          <div className="topinfo__grid">
            <div
              className={
                view.media.poster === null
                  ? 'topinfo__poster topinfo__poster--empty'
                  : 'topinfo__poster'
              }
            >
              {view.media.poster !== null ? (
                <img
                  alt={`Pôster de ${view.title}`}
                  fetchPriority="high"
                  height={view.media.poster.height}
                  src={view.media.poster.src}
                  width={view.media.poster.width}
                />
              ) : (
                <span aria-hidden="true">{view.title.slice(0, 1).toUpperCase()}</span>
              )}
            </div>

            <header>
              <span className="badge badge--series" data-entity-badge="series">
                Série
              </span>
              <h1 className="topinfo__title">{view.title}</h1>
              {topMeta.length > 0 ? (
                <ul className="topinfo__meta">
                  {topMeta.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {view.metaDescription !== null ? (
                <p style={{ marginTop: 16 }}>{view.metaDescription}</p>
              ) : null}
              <div className="topinfo__actions">
                {/* Acoes de biblioteca e tracker (C8): client component fala com
                    /api/me por fetch apos clique; zero chamada externa no render. */}
                <EntityActions entityType="tv" entityId={entityId} />
                <a className="btn btn--outline" href="/pt/tracker">
                  Acompanhar no tracker
                </a>
              </div>
              {externalLinks.length > 0 ? (
                <div className="entity-links" style={{ marginTop: 18 }}>
                  <EntityExternalIds links={externalLinks} />
                </div>
              ) : null}
            </header>

            <aside aria-label="Notas e disponibilidade" className="topinfo__aside">
              <RatingsPanel view={ratings} />
              {watch !== null ? (
                <div>
                  <WatchAvailabilityPanel view={watch} />
                  {watchContext !== null ? (
                    <p className="watch-panel__note" data-block-type={watchContext.blockType}>
                      {watchContext.content}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </div>

      <div className="container">
        {editorialBlocks.length > 0 ? (
          <section aria-labelledby="series-work-title" className="section">
            <SectionHead id="series-work-title" title="A obra" />
            {editorialBlocks.map((block) => (
              <p key={block.blockType} data-block-type={block.blockType}>
                {block.content}
              </p>
            ))}
          </section>
        ) : null}

        {critiqueBlock !== null ? (
          <section aria-labelledby="series-review-title" className="section">
            <SectionHead id="series-review-title" title="Crítica da redação" />
            <p data-block-type={critiqueBlock.blockType}>{critiqueBlock.content}</p>
          </section>
        ) : null}

        {view.seasons.length > 0 ? (
          <section id="episodios" aria-labelledby="series-episodes-title" className="section">
            <SectionHead id="series-episodes-title" title="Episódios" />
            {/* Seletor de temporadas: links reais (URL muda), overflow
                horizontal no mobile (tela 08); 1 temporada -> sem seletor. */}
            {view.seasons.length > 1 ? (
              <nav aria-label="Temporadas" className="season-nav">
                {view.seasons.map((season) => {
                  const seasonHref =
                    seasonPath(data.canonicalSlug, season.seasonNumber) ??
                    `?temporada=${season.seasonNumber}#episodios`
                  const isSelected = selectedSeason?.seasonNumber === season.seasonNumber
                  return (
                    <a
                      aria-current={isSelected ? 'true' : undefined}
                      className={isSelected ? 'chip chip--active' : 'chip'}
                      href={seasonHref}
                      key={season.seasonNumber}
                    >
                      Temporada {season.seasonNumber}
                    </a>
                  )
                })}
              </nav>
            ) : null}
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
          <section aria-labelledby="series-cast-title" className="section">
            <SectionHead id="series-cast-title" title="Elenco principal" />
            {castContext !== null ? (
              <p data-block-type={castContext.blockType}>{castContext.content}</p>
            ) : null}
            <ul className="cast-grid">
              {visibleCast.map((member, index) => (
                <li key={`${member.name}-${index}`}>
                  <article className="cast-card">
                    <span aria-hidden="true" className="cast-card__photo">
                      {member.profile !== null ? (
                        <img alt="" loading="lazy" src={member.profile.src} />
                      ) : (
                        member.name
                          .split(' ')
                          .slice(0, 2)
                          .map((part) => part.slice(0, 1))
                          .join('')
                      )}
                    </span>
                    <div>
                      <p className="cast-card__name">
                        {member.href !== null ? (
                          <a href={member.href}>{member.name}</a>
                        ) : (
                          <span>{member.name}</span>
                        )}
                      </p>
                      {member.character !== null ? (
                        <p className="cast-card__role">{member.character}</p>
                      ) : null}
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {visibleNews.length > 0 ? (
          <section aria-labelledby="series-news-title" className="section">
            <SectionHead
              id="series-news-title"
              seeAllHref={NEWS_INDEX_PATH}
              seeAllLabel="Ver todas"
              title="Notícias relacionadas"
            />
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul className="news-grid">
              {visibleNews.map((card) => (
                <li key={card.href}>
                  <NewsListCard card={card} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {facts.length > 0 ? (
          <section aria-labelledby="series-details-title" className="section">
            <SectionHead id="series-details-title" title="Ficha técnica" />
            <dl className="facts">
              {facts.map((fact) => (
                <div className="facts__row" key={fact.label}>
                  <dt className="facts__label">{fact.label}</dt>
                  <dd className="facts__value">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
          </p>
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
