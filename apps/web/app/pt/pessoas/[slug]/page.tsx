import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../../_components/ad-slot'
import { SectionTitle } from '../../../_components/ds'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { Filmography } from '../../../_components/filmography'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getPersonPageData } from '../../../../src/server/person-page'

/**
 * Pessoa — tela 09 do canônico, estrutura EXATA: header 200px/1fr (retrato
 * CIRCULAR + kicker + nome 56 + chips + bio 68ch) → [banda de mídia: omitida —
 * sem vídeo/entrevista licenciados; delta registrado] → [barra de prêmios:
 * omitida — sem dado de awards no banco; delta] → CONHECIDO POR (5 cards com
 * poster real) → FOTOS (só galeria LICENCIADA; invariante 6) → Ad → FILMOGRAFIA
 * (tabela com filtro real Tudo/Filmes/Séries; sem célula de rating — ratings
 * externos inativos) → DETALHES PESSOAIS (2 colunas) → NOTÍCIAS RELACIONADAS
 * (2 cards horizontais). Dados 100% do PostgreSQL.
 */

export const revalidate = 3600

const PESSOAS_INDEX_PATH = '/pt/pessoas/'
const BIOGRAPHY_BLOCK_TYPES: ReadonlySet<string> = new Set(['editorial_intro'])
const KNOWN_FOR_LIMIT = 5

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

  const { view, seo, canonicalUrl, relatedNews, externalIds, gallery } = data
  const isUnderReview = seo.decision !== 'index'
  const personalDetails = collectPersonalDetails(view)
  const biography = [
    view.metaDescription,
    ...view.blocks
      .filter((block) => BIOGRAPHY_BLOCK_TYPES.has(block.blockType))
      .map((block) => block.content),
  ].filter((paragraph): paragraph is string => paragraph !== null)
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const externalLinks = buildExternalLinks(externalIds, 'person')
  const initials = view.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')

  // Chips do header: só fatos reais (créditos, nascimento/local)
  const birthYear =
    view.birthDateIso !== null && /^\d{4}/.test(view.birthDateIso)
      ? view.birthDateIso.slice(0, 4)
      : null
  const birthChip = [
    birthYear !== null ? `Nascido em ${birthYear}` : null,
    view.placeOfBirth,
  ].filter((item): item is string => item !== null)
  const chips = [
    view.credits.length > 0
      ? `${view.credits.length} ${view.credits.length === 1 ? 'crédito' : 'créditos'}`
      : null,
    birthChip.length > 0 ? birthChip.join(' · ') : null,
  ].filter((item): item is string => item !== null)

  const knownFor = view.credits.filter((credit) => credit.posterUrl !== null).slice(0, KNOWN_FOR_LIMIT)
  const galleryPhotos = gallery.urls
  const galleryRest = gallery.total - galleryPhotos.length

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
      {/* Header canônico: retrato circular 200px + kicker/nome/chips/bio */}
      <div className="person-head">
        <div
          className="person-head__avatar"
          style={view.profile === null ? undefined : { borderRadius: '50%' }}
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
          <div className="person-head__kicker">
            Pessoa{view.roleLabel !== null ? ` · ${view.roleLabel}` : ''}
          </div>
          <h1 className="person-head__name">{view.name}</h1>
          {chips.length > 0 ? (
            <div className="person-chips">
              {chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          ) : null}
          {biography.length > 0 ? <p className="person-bio">{biography[0]}</p> : null}
          {externalLinks.length > 0 ? (
            <div className="entity-links" style={{ marginTop: 18 }}>
              <EntityExternalIds links={externalLinks} />
            </div>
          ) : null}
        </header>
      </div>

      {/* Banda de mídia (vídeos/entrevistas) e barra de prêmios do canônico:
          omitidas — sem vídeo licenciado nem dado de premiação no banco
          (DESIGN-DELTA; nada de conteúdo inventado). */}

      <div className="container">
        {biography.length > 1 ? (
          <section aria-labelledby="person-bio-title" className="section">
            <SectionTitle id="person-bio-title" title="Biografia" />
            <div className="art-body" style={{ margin: 0, padding: 0, textAlign: 'left' }}>
              {biography.slice(1).map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
              ))}
            </div>
          </section>
        ) : null}

        {knownFor.length > 0 ? (
          <section aria-labelledby="person-known-for-title" className="section">
            <SectionTitle id="person-known-for-title" title="Conhecido por" />
            <div className="known-for">
              {knownFor.map((credit) => (
                <a
                  className="known-for__card"
                  data-entity-type={credit.entityType}
                  href={credit.href}
                  key={credit.href}
                >
                  <span className="known-for__poster">
                    {credit.posterUrl !== null ? (
                      <img alt="" loading="lazy" src={credit.posterUrl} />
                    ) : null}
                    <span
                      className={
                        credit.entityType === 'movie'
                          ? 'known-for__type'
                          : 'known-for__type known-for__type--series'
                      }
                    >
                      {credit.entityType === 'movie' ? 'Filme' : 'Série'}
                    </span>
                  </span>
                  <span className="known-for__body">
                    <span className="known-for__title">{credit.title}</span>
                    {credit.roleLabel !== null ? (
                      <span className="known-for__role">{credit.roleLabel}</span>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* Fotos: SÓ galeria licenciada (invariante 6) — vazia até decisão humana */}
        {galleryPhotos.length > 0 ? (
          <section aria-labelledby="person-photos-title" className="section">
            <SectionTitle id="person-photos-title" title="Fotos" />
            <div className="person-photos">
              {galleryPhotos.map((url, index) => (
                <div key={url}>
                  <img alt={`Foto de ${view.name}`} loading="lazy" src={url} />
                  {index === galleryPhotos.length - 1 && galleryRest > 0 ? (
                    <span className="person-photos__more">+{galleryRest}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <AdSlot format="leaderboard" slotId="person-credits" />

        <section aria-labelledby="person-filmography-title" className="section">
          <div className="section-head">
            <SectionTitle id="person-filmography-title" title="Filmografia" />
          </div>
          {view.credits.length > 0 ? (
            <Filmography
              items={view.credits.map((credit) => ({
                entityType: credit.entityType,
                title: credit.title,
                href: credit.href,
                year: credit.year,
                roleLabel: credit.roleLabel,
              }))}
            />
          ) : (
            <p className="muted">Filmografia ainda não disponível.</p>
          )}
        </section>

        {personalDetails.length > 0 ? (
          <section aria-labelledby="person-details-title" className="section">
            <SectionTitle id="person-details-title" title="Detalhes pessoais" />
            <dl className="person-details">
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
          <section aria-labelledby="person-related-news-title" className="section">
            <SectionTitle id="person-related-news-title" title="Notícias relacionadas" />
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <div className="person-news">
              {relatedNews.slice(0, 2).map((card) => (
                <a className="person-news__card" href={card.href} key={card.href}>
                  <span className="person-news__img">
                    {card.image !== null ? <img alt="" loading="lazy" src={card.image.src} /> : null}
                  </span>
                  <span className="person-news__body">
                    {card.category !== null ? (
                      <span className="person-news__cat">{card.category}</span>
                    ) : null}
                    <span className="person-news__title">{card.title}</span>
                    {card.dateLabel !== null ? (
                      <span className="person-news__meta">{card.dateLabel}</span>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
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
