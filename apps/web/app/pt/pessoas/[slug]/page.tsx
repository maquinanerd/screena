import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../../_components/ad-slot'
import { EmptyState, NewsListCard, SectionHead } from '../../../_components/ds'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import type { PersonCreditEntityType } from '../../../../src/lib/person-presenter'
import { SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getPersonPageData } from '../../../../src/server/person-page'

/**
 * Pessoa — tela 09 do handoff (PersonDetailTemplate, contexto neutro):
 * person-hero com portrait 3/4 (sem portrait -> avatar de iniciais, nunca
 * imagem inventada), biografia em largura de leitura, filmografia com badge
 * textual Filme/Série (invariante 11) e notícias relacionadas.
 */

export const revalidate = 3600

const PESSOAS_INDEX_PATH = '/pt/pessoas/'
const BIOGRAPHY_BLOCK_TYPES: ReadonlySet<string> = new Set(['editorial_intro'])

const CREDIT_TYPE_LABELS: Readonly<Record<PersonCreditEntityType, string>> = {
  movie: 'Filme',
  tv: 'Série',
}

interface PersonPageParams {
  slug: string
}

interface PersonalDetail {
  label: string
  value: string
}

function formatPersonDate(isoDate: string | null): string | null {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null

  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function collectPersonalDetails(view: {
  originalName: string | null
  roleLabel: string | null
  birthDateIso: string | null
  deathDateIso: string | null
  placeOfBirth: string | null
}): PersonalDetail[] {
  const birthDate = formatPersonDate(view.birthDateIso)
  const deathDate = formatPersonDate(view.deathDateIso)
  const details: Array<PersonalDetail | null> = [
    view.originalName === null ? null : { label: 'Nome original', value: view.originalName },
    birthDate === null ? null : { label: 'Nascimento', value: birthDate },
    deathDate === null ? null : { label: 'Falecimento', value: deathDate },
    view.placeOfBirth === null ? null : { label: 'Local', value: view.placeOfBirth },
    view.roleLabel === null ? null : { label: 'Atuação principal', value: view.roleLabel },
  ]

  return details.filter((detail): detail is PersonalDetail => detail !== null)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PersonPageParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getPersonPageData(slug)

  if (data === null) {
    return {
      title: 'Pessoa não encontrada',
      robots: { index: false, follow: false },
    }
  }

  const { view, seo, canonicalUrl } = data
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.name} - Pessoa`,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
  }

  if (view.metaDescription !== null) metadata.description = view.metaDescription
  return metadata
}

export default async function PersonPage({ params }: { params: Promise<PersonPageParams> }) {
  const { slug } = await params
  const data = await getPersonPageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(PESSOAS_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, seo, canonicalUrl, relatedNews, externalIds } = data
  const isUnderReview = seo.decision !== 'index'
  const hasCredits = view.credits.length > 0
  const personalDetails = collectPersonalDetails(view)
  const biography = [
    view.metaDescription,
    ...view.blocks
      .filter((block) => BIOGRAPHY_BLOCK_TYPES.has(block.blockType))
      .map((block) => block.content),
  ].filter((paragraph): paragraph is string => paragraph !== null)
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const summary = [view.roleLabel, view.lifeLabel, view.placeOfBirth].filter(
    (item): item is string => item !== null,
  )
  const externalLinks = buildExternalLinks(externalIds, 'person')
  const initials = view.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Pessoas',
        item: `${SITE_URL}${PESSOAS_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.name, item: canonicalUrl },
    ],
  }

  const personJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': canonicalUrl,
    name: view.name,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  }
  if (view.originalName !== null) personJsonLd.alternateName = view.originalName
  if (view.roleLabel !== null) personJsonLd.jobTitle = view.roleLabel
  if (view.birthDateIso !== null) personJsonLd.birthDate = view.birthDateIso
  if (view.deathDateIso !== null) personJsonLd.deathDate = view.deathDateIso
  if (view.placeOfBirth !== null) {
    personJsonLd.birthPlace = { '@type': 'Place', name: view.placeOfBirth }
  }
  if (view.metaDescription !== null) personJsonLd.description = view.metaDescription
  const sameAs = buildSameAs(externalIds, 'person')
  if (sameAs.length > 0) personJsonLd.sameAs = sameAs

  return (
    <main data-vertical="person">
      {/* Person hero: portrait 3/4 + nome (topinfo claro, contexto neutro) */}
      <div className="topinfo">
        <div className="container">
          <nav aria-label="Trilha de navegação" className="breadcrumb">
            <ol>
              <li>
                <a href="/pt/">Início</a>
              </li>
              <li>
                <a href={PESSOAS_INDEX_PATH}>Pessoas</a>
              </li>
              <li aria-current="page">{view.name}</li>
            </ol>
          </nav>

          <div className="topinfo__grid">
            <div
              className={
                view.profile === null
                  ? 'topinfo__poster topinfo__poster--empty'
                  : 'topinfo__poster'
              }
              style={{ aspectRatio: '3 / 4' }}
            >
              {view.profile !== null ? (
                <img
                  alt={`Retrato de ${view.name}`}
                  fetchPriority="high"
                  height={view.profile.height}
                  src={view.profile.src}
                  width={view.profile.width}
                />
              ) : (
                <span aria-hidden="true">{initials}</span>
              )}
            </div>

            <header>
              <span className="badge">Pessoa</span>
              <h1 className="topinfo__title">{view.name}</h1>
              {summary.length > 0 ? (
                <ul className="topinfo__meta">
                  {summary.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {externalLinks.length > 0 ? (
                <div className="entity-links" style={{ marginTop: 18 }}>
                  <EntityExternalIds links={externalLinks} />
                </div>
              ) : null}
            </header>
          </div>
        </div>
      </div>

      <div className="container">
        {biography.length > 0 ? (
          <section aria-labelledby="person-bio-title" className="section">
            <SectionHead id="person-bio-title" title="Biografia" />
            <div className="article-body" style={{ maxWidth: 720, marginTop: 0 }}>
              {biography.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="person-filmography-title" className="section">
          <SectionHead id="person-filmography-title" title="Filmografia" />
          {hasCredits ? (
            <ul className="news-grid">
              {view.credits.map((credit, index) => (
                <li key={`${credit.entityType}-${credit.href}-${index}`}>
                  <article className="news-list-card" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <span
                        className={
                          credit.entityType === 'movie'
                            ? 'badge badge--movie'
                            : 'badge badge--series'
                        }
                      >
                        {CREDIT_TYPE_LABELS[credit.entityType]}
                      </span>
                      <h3 className="news-list-card__title">
                        <a data-entity-type={credit.entityType} href={credit.href}>
                          {credit.title}
                        </a>
                      </h3>
                      <p className="news-list-card__meta">
                        {[
                          credit.year !== null ? String(credit.year) : null,
                          credit.roleLabel,
                        ]
                          .filter((item): item is string => item !== null)
                          .join(' · ')}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Filmografia ainda não disponível." />
          )}
        </section>

        <AdSlot format="leaderboard" slotId="person-credits" />

        {personalDetails.length > 0 ? (
          <section aria-labelledby="person-details-title" className="section">
            <SectionHead id="person-details-title" title="Detalhes pessoais" />
            <dl className="facts">
              {personalDetails.map((detail) => (
                <div className="facts__row" key={detail.label}>
                  <dt className="facts__label">{detail.label}</dt>
                  <dd className="facts__value">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {relatedNews.length > 0 ? (
          <section aria-labelledby="person-related-news-title" className="section">
            <SectionHead id="person-related-news-title" title="Notícias relacionadas" />
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul className="news-grid">
              {relatedNews.map((card) => (
                <li key={card.href}>
                  <NewsListCard card={card} />
                </li>
              ))}
            </ul>
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(personJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
