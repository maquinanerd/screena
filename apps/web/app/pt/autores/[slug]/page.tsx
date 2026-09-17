import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { buildMetaDescription, profilePersonId, serializeJsonLd, websiteId } from '@screena/seo'

import { InstitutionalPage } from '../../../_components/institutional-page'
import {
  describeAuthorProfile,
  findAuthorProfile,
  type AuthorProfileView,
} from '../../../../src/lib/author-presenter'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../../src/lib/institutional-trail'
import { AUTHORS_INDEX_PATH } from '../../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../../src/lib/site'
import { socialMetadata } from '../../../../src/lib/social-metadata'
import { getAuthorDirectoryData } from '../../../../src/server/news-pages'
import '../../../_components/legal.css'

/**
 * Página de autor — o nome que assina e as matérias no ar com essa assinatura.
 *
 * Sem biografia, foto, cargo ou credencial: o banco público não guarda nada disso,
 * e a página não inventa (ver `src/lib/author-presenter.ts`). O que ela prova é
 * verificável na própria página — cada matéria listada leva à matéria.
 *
 * O `Person` do JSON-LD usa o MESMO `@id` que o `author` de cada matéria
 * (`profilePersonId`): é assim que o buscador liga a assinatura a esta página.
 *
 * Slug que não corresponde a um autor com matéria no ar dá 404. `force-dynamic`
 * pelo motivo de `/pt/autores/`: despublicação de emergência.
 */
export const dynamic = 'force-dynamic'

interface AuthorParams {
  slug: string
}

async function loadAuthor(slug: string): Promise<AuthorProfileView | null> {
  const { authors } = await getAuthorDirectoryData()
  return findAuthorProfile(authors, slug)
}

function metaTitleOf(author: AuthorProfileView): string {
  return `${author.name}: matérias na Cinerie`
}

export async function generateMetadata({
  params,
}: {
  params: Promise<AuthorParams>
}): Promise<Metadata> {
  const { slug } = await params
  const author = await loadAuthor(slug)
  if (author === null) {
    return { title: 'Autor não encontrado', robots: { index: false, follow: false } }
  }

  const canonicalUrl = canonicalPublicUrl(author.href)
  const title = metaTitleOf(author)
  const description = buildMetaDescription(describeAuthorProfile(author))
  return {
    title,
    description,
    robots: publicRobots(true),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({ type: 'profile', title, description, canonicalUrl }),
  }
}

export default async function AuthorPage({ params }: { params: Promise<AuthorParams> }) {
  const { slug } = await params
  const author = await loadAuthor(slug)
  if (author === null) notFound()

  const canonicalUrl = canonicalPublicUrl(author.href)
  const trail: readonly TrailStep[] = [
    { label: 'Autores', href: AUTHORS_INDEX_PATH },
    { label: author.name, href: null },
  ]

  const profileJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: canonicalUrl,
    name: metaTitleOf(author),
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
    mainEntity: {
      '@type': 'Person',
      ...(canonicalUrl === null ? {} : { '@id': profilePersonId(canonicalUrl), url: canonicalUrl }),
      name: author.name,
    },
  }

  return (
    <>
      <InstitutionalPage lede={describeAuthorProfile(author)} title={author.name} trail={trail}>
        <h2>Matérias</h2>
        <ul>
          {author.articles.map((article) => (
            <li key={article.href}>
              <a href={article.href}>{article.title}</a>
              {article.dateLabel !== null ? (
                <>
                  {' — '}
                  {article.dateIso !== null ? (
                    <time dateTime={article.dateIso}>{article.dateLabel}</time>
                  ) : (
                    article.dateLabel
                  )}
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </InstitutionalPage>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(profileJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(trailBreadcrumbJsonLd(trail, SITE_URL, canonicalUrl)),
        }}
      />
    </>
  )
}
