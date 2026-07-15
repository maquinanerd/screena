import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import type { PersonCreditEntityType } from '../../../../src/lib/person-presenter'
import { SITE_URL } from '../../../../src/lib/site'
import { getPersonPageData } from '../../../../src/server/person-page'

/**
 * Ficha pública mínima de pessoa. O shell conserva somente conteúdo real,
 * navegação, identidade externa e contratos de SEO.
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

  const { view, indexability, canonicalUrl } = data
  const shouldIndex = indexability.decision === 'index'
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.name} - Pessoa`,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
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

  const { view, indexability, canonicalUrl, relatedNews, externalIds } = data
  const isUnderReview = indexability.decision !== 'index'
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
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={PESSOAS_INDEX_PATH}>Pessoas</a>
            </li>
            <li aria-current="page">{view.name}</li>
          </ol>
        </nav>

        <header>
          <p>Pessoa</p>
          <h1>{view.name}</h1>
          {summary.length > 0 ? <p>{summary.join(' · ')}</p> : null}
          {biography.map((paragraph, index) => (
            <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
          ))}
          {externalLinks.length > 0 ? <EntityExternalIds links={externalLinks} /> : null}
        </header>

        <section aria-labelledby="person-filmography-title">
          <h2 id="person-filmography-title">Filmografia</h2>
          {hasCredits ? (
            <ul>
              {view.credits.map((credit, index) => (
                <li key={`${credit.entityType}-${credit.href}-${index}`}>
                  <a data-entity-type={credit.entityType} href={credit.href}>
                    <strong>{credit.title}</strong>
                    <span> — {CREDIT_TYPE_LABELS[credit.entityType]}</span>
                    {credit.year !== null ? <span> · {credit.year}</span> : null}
                    {credit.roleLabel !== null ? <span> · {credit.roleLabel}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>Filmografia ainda não disponível.</p>
          )}
        </section>

        {personalDetails.length > 0 ? (
          <section aria-labelledby="person-details-title">
            <h2 id="person-details-title">Detalhes pessoais</h2>
            <dl>
              {personalDetails.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {relatedNews.length > 0 ? (
          <section aria-labelledby="person-related-news-title">
            <h2 id="person-related-news-title">Notícias relacionadas</h2>
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <ul>
              {relatedNews.map((card) => {
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
          </section>
        ) : null}

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta página ainda está em revisão editorial.</p>
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
