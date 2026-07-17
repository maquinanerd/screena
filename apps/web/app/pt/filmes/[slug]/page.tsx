import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getMoviePageData } from '../../../../src/server/movie-page'

/**
 * Ficha pública mínima de filme. O shell não interpreta visualmente os dados:
 * ele mantém a rota, o conteúdo real e os contratos de SEO enquanto o design
 * público aguarda a próxima fonte canônica.
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

  const { view, seo, canonicalUrl, relatedNews, cast, watch, externalIds } = data
  const isUnderReview = seo.decision !== 'index'
  const externalLinks = buildExternalLinks(externalIds, 'movie')
  const summary = [view.year !== null ? String(view.year) : null, view.runtimeLabel].filter(
    (item): item is string => item !== null,
  )
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
  const primaryCast = cast.slice(0, 6)
  const editorialNews = relatedNews.slice(0, 3)

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
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={MOVIES_INDEX_PATH}>Filmes</a>
            </li>
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>

        <header>
          <p>
            <strong data-entity-badge="movie">Filme</strong>
          </p>
          <h1>{view.title}</h1>
          {summary.length > 0 ? <p>{summary.join(' · ')}</p> : null}
          {view.metaDescription !== null ? <p>{view.metaDescription}</p> : null}
          {externalLinks.length > 0 ? <EntityExternalIds links={externalLinks} /> : null}
        </header>

        {watch !== null ? (
          <section aria-label="Disponibilidade legal">
            <WatchAvailabilityPanel view={watch} />
            {watchContext !== null ? (
              <p data-block-type={watchContext.blockType}>{watchContext.content}</p>
            ) : null}
          </section>
        ) : null}

        {workBlocks.length > 0 ? (
          <section aria-labelledby="movie-work-title">
            <h2 id="movie-work-title">A obra</h2>
            {workBlocks.map((block) => (
              <p key={block.blockType} data-block-type={block.blockType}>
                {block.content}
              </p>
            ))}
          </section>
        ) : null}

        {critiqueBlock !== null ? (
          <section aria-labelledby="movie-review-title">
            <h2 id="movie-review-title">Crítica da redação</h2>
            <p data-block-type={critiqueBlock.blockType}>{critiqueBlock.content}</p>
          </section>
        ) : null}

        {primaryCast.length > 0 ? (
          <section aria-labelledby="movie-cast-title">
            <h2 id="movie-cast-title">Elenco principal</h2>
            {castContext !== null ? (
              <p data-block-type={castContext.blockType}>{castContext.content}</p>
            ) : null}
            <ul>
              {primaryCast.map((member, index) => (
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

        {editorialNews.length > 0 ? (
          <section aria-labelledby="movie-news-title">
            <h2 id="movie-news-title">Notícias relacionadas</h2>
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul>
              {editorialNews.map((article) => {
                const meta = [article.author, article.dateLabel, article.readTimeLabel].filter(
                  (item): item is string => item !== null,
                )

                return (
                  <li key={article.href}>
                    <article>
                      <h3>
                        <a href={article.href}>{article.title}</a>
                      </h3>
                      {article.category !== null ? <p>{article.category}</p> : null}
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
          <section aria-labelledby="movie-facts-title">
            <h2 id="movie-facts-title">Ficha técnica</h2>
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(movieJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
