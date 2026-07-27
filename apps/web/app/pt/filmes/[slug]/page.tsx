import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { NewsListCard, SectionHead } from '../../../_components/ds'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getMoviePageData } from '../../../../src/server/movie-page'

/**
 * Detalhe de filme — tela 06 do handoff (MovieDetailTemplate, EX-06-nohero):
 * top info bar CLARA (sem hero cover, por decisao registrada no canonico) com
 * poster 2/3 + titulo + metadata + acoes + ratings/streaming governados, e
 * secoes editoriais (sinopse, ficha, elenco, noticias) em container editorial.
 *
 * Todos os dados vem do PostgreSQL local (invariantes 3/4); campo ausente e
 * OMITIDO (nunca "N/D"); ratings cada um na escala da propria fonte.
 */

/** ISR relê apenas o snapshot local do PostgreSQL. */
export const revalidate = 3600

const REVIEW_BLOCK_TYPE = 'review_summary'
const WORK_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'editorial_intro',
  'summary_without_spoilers',
  'franchise_context',
])

interface MoviePageParams {
  slug: string
}

interface MovieFact {
  label: string
  value: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<MoviePageParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getMoviePageData(slug)

  if (data === null) {
    return {
      title: 'Filme não encontrado',
      robots: { index: false, follow: false },
    }
  }

  const { view, seo, canonicalUrl } = data
  const title =
    view.metaTitle ?? `${view.title}${view.year !== null ? ` (${view.year})` : ''} — Filme`

  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
  }
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription
  }
  return metadata
}

export default async function MoviePage({ params }: { params: Promise<MoviePageParams> }) {
  const { slug } = await params
  const data = await getMoviePageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(MOVIES_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, entityId, seo, canonicalUrl, relatedNews, cast, watch, ratings, externalIds } = data
  const isUnderReview = seo.decision !== 'index'
  const externalLinks = buildExternalLinks(externalIds, 'movie')
  const facts = [
    view.year === null ? null : { label: 'Ano', value: String(view.year) },
    view.runtimeLabel === null ? null : { label: 'Duração', value: view.runtimeLabel },
    view.statusLabel === null ? null : { label: 'Situação', value: view.statusLabel },
    view.originalLanguageLabel === null
      ? null
      : { label: 'Idioma original', value: view.originalLanguageLabel },
  ].filter((fact): fact is MovieFact => fact !== null)

  const critiqueBlock = view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null
  const workBlocks = view.blocks.filter((block) => WORK_BLOCK_TYPES.has(block.blockType))
  const watchContext =
    view.blocks.find((block) => block.blockType === 'where_to_watch_text') ?? null
  const castContext = view.blocks.find((block) => block.blockType === 'cast_intro') ?? null
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const primaryCast = cast.slice(0, 8)
  const editorialNews = relatedNews.slice(0, 3)
  const topMeta = [
    view.year !== null ? String(view.year) : null,
    view.runtimeLabel,
    view.statusLabel,
  ].filter((item): item is string => item !== null)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Filmes',
        item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.title, item: canonicalUrl },
    ],
  }

  const movieJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    '@id': canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  }
  if (view.year !== null) movieJsonLd.datePublished = String(view.year)
  if (view.metaDescription !== null) {
    movieJsonLd.description = view.metaDescription
  }
  const sameAs = buildSameAs(externalIds, 'movie')
  if (sameAs.length > 0) movieJsonLd.sameAs = sameAs

  return (
    <main data-vertical="movie">
      {/* Top info bar clara (EX-06-nohero) */}
      <div className="topinfo">
        <div className="container">
          <nav aria-label="Trilha de navegação" className="breadcrumb">
            <ol>
              <li>
                <a href="/pt/">Início</a>
              </li>
              <li>
                <a href={MOVIES_INDEX_PATH}>Filmes</a>
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
              <span className="badge badge--movie" data-entity-badge="movie">
                Filme
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
                {/* Acoes de biblioteca (C8): client component fala com /api/me
                    por fetch apos clique; zero chamada externa no render. */}
                <EntityActions entityType="movie" entityId={entityId} />
              </div>
              {externalLinks.length > 0 ? (
                <div className="entity-links" style={{ marginTop: 18 }}>
                  <EntityExternalIds links={externalLinks} />
                </div>
              ) : null}
            </header>

            <aside aria-label="Notas e disponibilidade" className="topinfo__aside">
              {/* Notas de terceiros, cada uma na escala da propria fonte e
                  creditada; o painel se auto-omite sem nota licenciada. */}
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
        {workBlocks.length > 0 ? (
          <section aria-labelledby="movie-work-title" className="section">
            <SectionHead id="movie-work-title" title="A obra" />
            {workBlocks.map((block) => (
              <p key={block.blockType} data-block-type={block.blockType}>
                {block.content}
              </p>
            ))}
          </section>
        ) : null}

        {critiqueBlock !== null ? (
          <section aria-labelledby="movie-review-title" className="section">
            <SectionHead id="movie-review-title" title="Crítica da redação" />
            <p data-block-type={critiqueBlock.blockType}>{critiqueBlock.content}</p>
          </section>
        ) : null}

        {primaryCast.length > 0 ? (
          <section aria-labelledby="movie-cast-title" className="section">
            <SectionHead id="movie-cast-title" title="Elenco principal" />
            {castContext !== null ? (
              <p data-block-type={castContext.blockType}>{castContext.content}</p>
            ) : null}
            <ul className="cast-grid">
              {primaryCast.map((member, index) => (
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

        {editorialNews.length > 0 ? (
          <section aria-labelledby="movie-news-title" className="section">
            <SectionHead
              id="movie-news-title"
              seeAllHref={NEWS_INDEX_PATH}
              seeAllLabel="Ver todas"
              title="Notícias relacionadas"
            />
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul className="news-grid">
              {editorialNews.map((article) => (
                <li key={article.href}>
                  <NewsListCard card={article} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {facts.length > 0 ? (
          <section aria-labelledby="movie-facts-title" className="section">
            <SectionHead id="movie-facts-title" title="Ficha técnica" />
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(movieJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
