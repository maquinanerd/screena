import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { SectionBoundary } from '../../../_components/section-boundary'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { decideSection } from '../../../../src/lib/section-absence'
import type { SeriesEpisodeView, SeriesSeasonView } from '../../../../src/lib/series-presenter'
import { NEWS_INDEX_PATH, SITE_URL, gatePublicRobots, seasonPath } from '../../../../src/lib/site'
import { getSeriesPageData } from '../../../../src/server/series-page'

/**
 * Detalhe de série — tela 07 do canônico, na ESTRUTURA EXATA do HTML:
 * hero editorial CLARO (verde = série) → Sinopse ("A obra") → Guia crítica
 * (overlay verde) → EPISÓDIOS (catálogo assistível: eyebrow "Catálogo",
 * tabs de temporada à direita, linha de info da temporada, rows com still
 * 288px + badge de número + título 19/750 + sinopse 66ch + chevron) →
 * Elenco (faixa 6 col) → Notícias relacionadas → Detalhes (ficha 320px).
 * A tela 08 (mobile) é ESTE MESMO template no breakpoint 390 (media queries).
 *
 * Série de ~21k episódios nunca vira 20k nós: só a temporada SELECIONADA
 * renderiza (paginação por temporada já vem do getter).
 *
 * A PALETA É A ÚNICA DIFERENÇA VISUAL para o filme, e ela vive em CSS
 * (`[data-vertical='series']`), não duplicada aqui: selo verde, links
 * `--c-vertical-link`, kicker `--c-vertical-kicker`, overlay da crítica em
 * `rgba(16,32,22,…)`. A diferenciação NUNCA depende só da cor (invariante 11):
 * label "Série" + badge + breadcrumb + schema `TVSeries` + URL `/pt/series/`.
 *
 * O botão "Ver no celular" do canônico é ferramenta de protótipo e NÃO é
 * portado. As mesmas ausências da página de filme valem aqui (Cinerie Score,
 * prêmios, "Original Screen") — ver o cabeçalho de `filmes/[slug]/page.tsx` e
 * docs/frontend/DESIGN-DELTA-detalhe.md.
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
        <div className="episode-row__media">
          <span className="episode-row__num">
            T{seasonNumber} · E{episode.episodeNumber}
          </span>
          {episode.still !== null ? (
            <img
              alt=""
              height={episode.still.height}
              loading="lazy"
              src={episode.still.src}
              width={episode.still.width}
            />
          ) : null}
        </div>
        <div>
          {episode.title !== null ? (
            <h4 className="episode-row__title" style={{ letterSpacing: '-0.01em', textTransform: 'none' }}>
              {episode.title}
            </h4>
          ) : null}
          {episode.overview !== null ? (
            <p className="episode-row__synopsis">{episode.overview}</p>
          ) : null}
          {episodeMeta.length > 0 ? (
            <p className="episode-row__meta">{episodeMeta.join(' · ')}</p>
          ) : null}
        </div>
        <span aria-hidden="true" className="episode-row__chevron">
          <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
            <path d="m10 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </span>
      </article>
    </li>
  )
}

function SeasonGroup({ season }: { season: SeriesSeasonView }): ReactNode {
  const seasonMeta = [
    season.episodeCountLabel,
    season.airYear !== null ? `estreou em ${season.airYear}` : null,
  ].filter((item): item is string => item !== null)

  return (
    <section
      id={`temporada-${season.seasonNumber}`}
      aria-labelledby={`temporada-${season.seasonNumber}-titulo`}
    >
      <h3 className="visually-hidden" id={`temporada-${season.seasonNumber}-titulo`}>
        {season.title}
      </h3>
      <div className="season-info">
        {seasonMeta.length > 0 ? <span>{seasonMeta.join(' · ')}</span> : null}
      </div>
      {season.overview !== null ? <p className="synopsis-body" style={{ marginTop: 8 }}>{season.overview}</p> : null}
      {season.episodes.length > 0 ? (
        <ol className="episode-list" style={{ marginTop: 6 }}>
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
  const metaText = [view.periodLabel, view.seasonsCountLabel, view.episodesCountLabel]
    .filter((item): item is string => item !== null)
    .join(' · ')
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
  // Default canônico: Temporada 1 (primeira temporada REGULAR). "Especiais"
  // (season 0) só aparece quando pedida explicitamente — ela pode ter dezenas
  // de itens e nunca deve ser a carga inicial da página.
  const selectedSeason =
    view.seasons.find((season) => season.seasonNumber === requestedSeasonNumber) ??
    view.seasons.find((season) => season.seasonNumber > 0) ??
    view.seasons[0] ??
    null
  const visibleCast = cast.slice(0, 6)
  const visibleNews = relatedNews.slice(0, 3)
  const synopsisLead = editorialBlocks[0] ?? null
  const synopsisRest = editorialBlocks.slice(1)

  // Blocos dirigidos por dado; cada ausência carrega o motivo (section-absence).
  const entityRef = { entityType: 'tv', entityId: String(entityId) } as const
  const ratingsSection = decideSection(ratings, {
    ...entityRef,
    section: 'avaliacoes',
    reason: 'no_authorized_rating',
  })
  const watchSection = decideSection(watch, {
    ...entityRef,
    section: 'onde-assistir',
    reason: 'no_authorized_provider',
  })
  const critiqueSection = decideSection(critiqueBlock, {
    ...entityRef,
    section: 'guia-critica',
    reason: 'no_editorial_review',
  })
  const castSection = decideSection(visibleCast, {
    ...entityRef,
    section: 'elenco',
    reason: 'no_cast',
  })
  const newsSection = decideSection(visibleNews, {
    ...entityRef,
    section: 'noticias',
    reason: 'no_linked_article',
  })

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
      {/* ===== HERO editorial claro (canônico: verde = série) ===== */}
      <div className="detail-hero">
        <div className="detail-container">
          <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
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

          <div className="detail-hero__grid">
            <div className="detail-hero__main">
              <div className="detail-badge-row">
                <span className="detail-badge" data-entity-badge="series">
                  Série
                </span>
                {view.statusLabel !== null ? (
                  <span className="season-info__status">{view.statusLabel}</span>
                ) : null}
              </div>
              <h1 className="detail-hero__title">{view.title}</h1>
              <ul className="detail-hero__chips">
                {metaText !== '' ? (
                  <li className="detail-hero__meta-text">{metaText}</li>
                ) : null}
              </ul>
              {view.metaDescription !== null ? (
                <p className="detail-hero__synopsis">{view.metaDescription}</p>
              ) : null}
              <div className="detail-actions">
                {/* Ações REAIS de biblioteca e tracker (C8). */}
                <EntityActions entityType="tv" entityId={entityId} />
                <a href="/pt/tracker/">Acompanhar no tracker</a>
              </div>
              {externalLinks.length > 0 ? (
                <div className="entity-links" style={{ marginTop: 20 }}>
                  <EntityExternalIds links={externalLinks} />
                </div>
              ) : null}
            </div>

            <aside aria-label="Notas e disponibilidade" className="detail-hero__aside">
              {/* Sem Cinerie Score: não há fórmula aprovada. Ver o cabeçalho. */}
              <SectionBoundary decision={ratingsSection}>
                {(view) => (
                  <div className="detail-aside-block detail-aside-block--first">
                    <p className="detail-aside-block__label">Avaliações</p>
                    <RatingsPanel view={view} />
                  </div>
                )}
              </SectionBoundary>
              <SectionBoundary decision={watchSection}>
                {(view) => (
                  <div className="detail-aside-block">
                    <p className="detail-aside-block__label">Onde assistir</p>
                    <WatchAvailabilityPanel view={view} />
                    {watchContext !== null ? (
                      <p className="watch-panel__note" data-block-type={watchContext.blockType}>
                        {watchContext.content}
                      </p>
                    ) : null}
                  </div>
                )}
              </SectionBoundary>
            </aside>
          </div>
        </div>
      </div>

      {/* ===== Mídia (pôster/backdrop reais) ===== */}
      {view.media.poster !== null || view.media.backdrop !== null ? (
        <div className="media-strip">
          <div className="media-strip__grid">
            <div className="media-strip__cell">
              {view.media.poster !== null ? (
                <img
                  alt={`Pôster de ${view.title}`}
                  fetchPriority="high"
                  height={view.media.poster.height}
                  src={view.media.poster.src}
                  width={view.media.poster.width}
                />
              ) : null}
            </div>
            <div className="media-strip__cell">
              {view.media.backdrop !== null ? (
                <img
                  alt=""
                  height={view.media.backdrop.height}
                  loading="lazy"
                  src={view.media.backdrop.src}
                  width={view.media.backdrop.width}
                />
              ) : null}
              <span className="media-strip__caption">Mídia do título</span>
            </div>
            <div className="media-strip__stack">
              <a className="media-strip__cell" href="#episodios">
                {view.media.backdrop !== null ? (
                  <img alt="" loading="lazy" src={view.media.backdrop.src} />
                ) : null}
                <span className="media-strip__caption">Episódios</span>
              </a>
              <a className="media-strip__cell" href={NEWS_INDEX_PATH}>
                {view.media.poster !== null ? (
                  <img alt="" loading="lazy" src={view.media.poster.src} />
                ) : null}
                <span className="media-strip__caption">Notícias e Eventos</span>
              </a>
              <a className="media-strip__cell" href="/pt/onde-assistir/">
                {view.media.backdrop !== null ? (
                  <img alt="" loading="lazy" src={view.media.backdrop.src} />
                ) : null}
                <span className="media-strip__caption">Onde assistir</span>
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== A obra ===== */}
      {(synopsisLead !== null || synopsisRest.length > 0) ? (
        <section aria-labelledby="series-work-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="eyebrow-bar">
            <span id="series-work-title">A obra</span>
          </div>
          {synopsisLead !== null ? (
            <p className="synopsis-lead" data-block-type={synopsisLead.blockType}>
              {synopsisLead.content}
            </p>
          ) : null}
          {synopsisRest.map((block) => (
            <p className="synopsis-body" data-block-type={block.blockType} key={block.blockType}>
              {block.content}
            </p>
          ))}
        </section>
      ) : null}

      {/* ===== Guia Cinerie · crítica (overlay verde) =====
          O kicker verde vem do token da vertical em CSS
          (`[data-vertical='series'] .critic-band__eyebrow`), não de um hex
          inline: cor de marca hardcoded em componente é o que faz filme e série
          divergirem em silêncio quando um dos dois é editado. */}
      <SectionBoundary decision={critiqueSection}>
        {(block) => (
          <section aria-label="Crítica da redação" className="critic-band">
            {view.media.backdrop !== null ? (
              <img alt="" className="critic-band__img" loading="lazy" src={view.media.backdrop.src} />
            ) : null}
            <div className="critic-band__scrim-h" />
            <div className="critic-band__scrim-v" />
            <div className="critic-band__inner">
              <div className="critic-band__content">
                <span className="critic-band__eyebrow">Guia Cinerie · Crítica da redação</span>
                <p className="critic-band__quote" data-block-type={block.blockType}>
                  {block.content}
                </p>
                <p className="critic-band__byline">Redação Cinerie</p>
              </div>
            </div>
          </section>
        )}
      </SectionBoundary>

      {/* ===== Episódios (catálogo assistível) ===== */}
      {view.seasons.length > 0 ? (
        <section aria-labelledby="series-episodes-title" className="detail-container" id="episodios" style={{ paddingTop: 60 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow-bar">
                <span>Catálogo</span>
              </div>
              <h2 className="detail-section-title" id="series-episodes-title">
                Episódios
              </h2>
            </div>
            {/* Tabs de temporada: links REAIS (rotas dedicadas de temporada,
                com fallback por query) — overflow horizontal no mobile. */}
            {view.seasons.length > 1 ? (
              <nav aria-label="Temporadas" className="season-tabs">
                {view.seasons.map((season) => {
                  const seasonHref =
                    seasonPath(data.canonicalSlug, season.seasonNumber) ??
                    `?temporada=${season.seasonNumber}#episodios`
                  const isSelected = selectedSeason?.seasonNumber === season.seasonNumber
                  return (
                    <a
                      aria-current={isSelected ? 'true' : undefined}
                      href={seasonHref}
                      key={season.seasonNumber}
                    >
                      Temporada {season.seasonNumber}
                    </a>
                  )
                })}
              </nav>
            ) : null}
          </div>
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

      {/* ===== Elenco · faixa visual ===== */}
      <SectionBoundary decision={castSection}>
        {(members) => (
        <section aria-labelledby="series-cast-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
            <div>
              <div className="eyebrow-bar">
                <span>Elenco</span>
              </div>
              <h2 className="detail-section-title" id="series-cast-title">
                Elenco <span className="thin">principal</span>
              </h2>
            </div>
            <a className="detail-see-all" href="/pt/pessoas/">
              Ver pessoas →
            </a>
          </div>
          {castContext !== null ? (
            <p data-block-type={castContext.blockType}>{castContext.content}</p>
          ) : null}
          <ul className="cast-strip">
            {members.map((member, index) => (
              <li key={`${member.name}-${index}`}>
                {member.href !== null ? (
                  <a className="cast-tile" href={member.href}>
                    <span className="cast-tile__photo">
                      {member.profile !== null ? (
                        <img alt="" loading="lazy" src={member.profile.src} />
                      ) : (
                        <span aria-hidden="true">
                          {member.name
                            .split(' ')
                            .slice(0, 2)
                            .map((part) => part.slice(0, 1))
                            .join('')}
                        </span>
                      )}
                    </span>
                    <p className="cast-tile__name">{member.name}</p>
                    {member.character !== null ? (
                      <p className="cast-tile__role">{member.character}</p>
                    ) : null}
                  </a>
                ) : (
                  <div className="cast-tile">
                    <span className="cast-tile__photo">
                      {member.profile !== null ? (
                        <img alt="" loading="lazy" src={member.profile.src} />
                      ) : (
                        <span aria-hidden="true">
                          {member.name
                            .split(' ')
                            .slice(0, 2)
                            .map((part) => part.slice(0, 1))
                            .join('')}
                        </span>
                      )}
                    </span>
                    <p className="cast-tile__name">{member.name}</p>
                    {member.character !== null ? (
                      <p className="cast-tile__role">{member.character}</p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
        )}
      </SectionBoundary>

      {/* ===== Notícias relacionadas ===== */}
      <SectionBoundary decision={newsSection}>
        {(articles) => (
        <section aria-labelledby="series-news-title" className="detail-container" style={{ paddingTop: 64 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
            <div>
              <div className="eyebrow-bar">
                <span>Editorial</span>
              </div>
              <h2 className="detail-section-title" id="series-news-title">
                Notícias <span className="thin">relacionadas</span>
              </h2>
            </div>
            <a className="see-all" href={NEWS_INDEX_PATH}>
              Ver tudo
            </a>
          </div>
          {newsContext !== null ? (
            <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
          ) : null}
          <ul className="mnews-grid">
            {articles.map((card) => (
              <li key={card.href}>
                <a className="mnews-card" href={card.href}>
                  <span className="mnews-card__cover">
                    {card.image !== null ? (
                      <img alt="" loading="lazy" src={card.image.src} />
                    ) : null}
                  </span>
                  {/* Cor do kicker por vertical vem do CSS, não de inline. */}
                  {card.category !== null ? (
                    <span className="mnews-card__cat">{card.category}</span>
                  ) : null}
                  <span className="mnews-card__title">{card.title}</span>
                  <span className="mnews-card__meta">
                    {[card.author, card.readTimeLabel]
                      .filter((item): item is string => item !== null)
                      .join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        )}
      </SectionBoundary>

      {/* ===== Detalhes (ficha 320px) ===== */}
      {facts.length > 0 ? (
        <section aria-labelledby="series-details-title" className="detail-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
          <div className="ficha-grid">
            <div>
              <div className="eyebrow-bar">
                <span id="series-details-title">Detalhes</span>
              </div>
              <dl className="ficha-rows">
                {facts.map((fact) => (
                  <div className="ficha-row" key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div />
          </div>
        </section>
      ) : null}

      <div className="detail-container">
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
