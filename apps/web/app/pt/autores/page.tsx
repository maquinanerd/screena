import type { Metadata } from 'next'

import { serializeJsonLd, websiteId } from '@screena/seo'

import { EmptyState } from '../../_components/ds'
import { InstitutionalPage } from '../../_components/institutional-page'
import { articleCountLabel } from '../../../src/lib/author-presenter'
import { trailBreadcrumbJsonLd, type TrailStep } from '../../../src/lib/institutional-trail'
import { AUTHORS_INDEX_PATH } from '../../../src/lib/routes'
import { SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { socialMetadata } from '../../../src/lib/social-metadata'
import { getAuthorDirectoryData } from '../../../src/server/news-pages'

/**
 * Autores — quem assina as matérias da Cinerie.
 *
 * AUDITORIA DE SEO (11/09/2026, seção 3.6): não havia página de autor. Esta lista
 * e a página de cada autor mostram o que o banco público sabe de quem escreve — o
 * nome que assina e as matérias no ar — e nada além disso (ver
 * `src/lib/author-presenter.ts`).
 *
 * `force-dynamic` pelo mesmo motivo da listagem de notícias: DESPUBLICAÇÃO DE
 * EMERGÊNCIA. Uma matéria retirada sai desta página na requisição seguinte, e não
 * quando uma cópia guardada expirar.
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Autores'
const META_TITLE = 'Autores das notícias da Cinerie'
const DESCRIPTION = 'Quem assina as notícias publicadas na Cinerie, com as matérias de cada autor.'
const TRAIL: readonly TrailStep[] = [{ label: TITLE, href: null }]

export async function generateMetadata(): Promise<Metadata> {
  const { authors } = await getAuthorDirectoryData()
  const canonicalUrl = canonicalPublicUrl(AUTHORS_INDEX_PATH)
  return {
    title: META_TITLE,
    description: DESCRIPTION,
    // Sem matéria no ar não há autor para listar: a página vazia não indexa, e a
    // MESMA lista decide se ela entra no sitemap (`defaultStaticHubDecisions`).
    robots: publicRobots(authors.length > 0),
    alternates: { canonical: canonicalUrl },
    ...socialMetadata({
      type: 'website',
      title: META_TITLE,
      description: DESCRIPTION,
      canonicalUrl,
    }),
  }
}

export default async function AuthorsIndexPage() {
  const { authors } = await getAuthorDirectoryData()
  const canonicalUrl = canonicalPublicUrl(AUTHORS_INDEX_PATH)

  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
    inLanguage: 'pt-BR',
    isPartOf: { '@id': websiteId(SITE_URL) },
  }
  if (authors.length > 0) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: authors.length,
      itemListElement: authors.map((author, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: canonicalPublicUrl(author.href),
        name: author.name,
      })),
    }
  }

  return (
    <>
      <InstitutionalPage
        lede="Quem assina as matérias publicadas na Cinerie. A página de cada autor reúne as matérias com aquela assinatura, da mais recente para a mais antiga."
        title={TITLE}
        trail={TRAIL}
      >
        {authors.length > 0 ? (
          <ul>
            {authors.map((author) => (
              <li key={author.slug}>
                <a href={author.href}>{author.name}</a> — {articleCountLabel(author.articleCount)}
                {author.latestDateLabel !== null
                  ? `, a mais recente em ${author.latestDateLabel}`
                  : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ainda não há matérias publicadas.">
            <p>Quando houver matérias no ar, quem as assina aparece aqui.</p>
          </EmptyState>
        )}
      </InstitutionalPage>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(trailBreadcrumbJsonLd(TRAIL, SITE_URL, canonicalUrl)),
        }}
      />
    </>
  )
}
