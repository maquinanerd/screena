/**
 * gallery-pages.tsx — As DUAS páginas de galeria, parametrizadas por vertical.
 *
 * ============================================================================
 * POR QUE AS QUATRO ROTAS SÃO ARQUIVOS DE QUATRO LINHAS
 * ============================================================================
 * O App Router exige um `page.tsx` por rota. Isso obriga a QUATRO arquivos —
 * mas não obriga a quatro implementações. Aqui vivem as duas de verdade
 * (imagens e vídeos); cada rota só diz qual vertical é.
 *
 * A alternativa seria uma rota `[vertical]` capturando `filmes|series`, e ela é
 * pior: `/pt/qualquercoisa/x/imagens/` casaria e teria de ser rejeitada em
 * runtime, quando hoje o próprio roteador já rejeita.
 *
 * ============================================================================
 * A INDEXAÇÃO, E POR QUE ELA NÃO CONTRARIA A INVARIANTE 5
 * ============================================================================
 * "Indexação total" vale para a ENTIDADE: todo filme e toda série indexam. Uma
 * galeria com duas imagens não é uma entidade — é uma sub-página cujo conteúdo
 * já cabia na ficha, e indexá-la cria uma URL que compete com a do título sem
 * entregar nada a mais. `noindex` aqui é o CASO TÉCNICO da invariante 5, e a
 * entidade dona segue indexando normalmente.
 *
 * Invariantes 3/4: zero API externa e zero IA no render.
 */

import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { GalleryImageGrid, GalleryVideoList } from './gallery-grids'
import { GalleryShell } from './gallery-shell'
import { imagesGalleryPath, videosGalleryPath } from '../../src/lib/routes'
import { SITE_URL, gatePublicRobots } from '../../src/lib/site'
import {
  getImagesGalleryPageData,
  getVideosGalleryPageData,
  type GalleryVertical,
} from '../../src/server/gallery-page'

export interface GalleryRouteParams {
  slug: string
}

/** `Movie` | `TVSeries`. O SCHEMA da invariante 11. */
function schemaTypeOf(vertical: GalleryVertical): 'Movie' | 'TVSeries' {
  return vertical === 'filmes' ? 'Movie' : 'TVSeries'
}

/**
 * `BreadcrumbList` + a entidade dona.
 *
 * A galeria NÃO se declara `ImageGallery`/`VideoGallery`: esses tipos afirmam
 * uma coleção editorial própria, e o que existe aqui é arte de terceiro
 * exibida sob licença. O `mainEntity` aponta para o título, que é a entidade
 * de verdade — e é ele que o buscador deve associar às imagens.
 */
function galleryJsonLd(input: {
  vertical: GalleryVertical
  entityTitle: string
  entityPath: string
  canonicalUrl: string
  heading: string
}): string {
  const indexPath = input.vertical === 'filmes' ? '/pt/filmes/' : '/pt/series/'
  const indexName = input.vertical === 'filmes' ? 'Filmes' : 'Séries'
  return serializeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: indexName, item: `${SITE_URL}${indexPath}` },
      {
        '@type': 'ListItem',
        position: 2,
        name: input.entityTitle,
        item: `${SITE_URL}${input.entityPath}`,
      },
      { '@type': 'ListItem', position: 3, name: input.heading, item: input.canonicalUrl },
    ],
    mainEntity: {
      '@type': schemaTypeOf(input.vertical),
      name: input.entityTitle,
      url: `${SITE_URL}${input.entityPath}`,
    },
  })
}

/** Metadata da galeria de IMAGENS. */
export async function imagesGalleryMetadata(
  vertical: GalleryVertical,
  slug: string,
): Promise<Metadata> {
  const data = await getImagesGalleryPageData(vertical, slug)
  if (data === null) {
    return { title: 'Galeria não encontrada', robots: { index: false, follow: false } }
  }
  const title = `Imagens e pôsteres de ${data.entityTitle}`
  return {
    title,
    description: `${data.gallery.total} imagens de ${data.entityTitle}, fornecidas pelo TMDB.`,
    robots: gatePublicRobots({
      index: data.gallery.indexable,
      follow: true,
    }),
    alternates: { canonical: data.canonicalUrl },
    openGraph: { title, url: data.canonicalUrl, type: 'website' },
  }
}

/** Metadata da galeria de VÍDEOS. */
export async function videosGalleryMetadata(
  vertical: GalleryVertical,
  slug: string,
): Promise<Metadata> {
  const data = await getVideosGalleryPageData(vertical, slug)
  if (data === null) {
    return { title: 'Galeria não encontrada', robots: { index: false, follow: false } }
  }
  const title = `Trailers e vídeos de ${data.entityTitle}`
  return {
    title,
    description: `${data.gallery.total} vídeos de ${data.entityTitle}, fornecidos pelo TMDB.`,
    robots: gatePublicRobots({ index: data.gallery.indexable, follow: true }),
    alternates: { canonical: data.canonicalUrl },
    openGraph: { title, url: data.canonicalUrl, type: 'website' },
  }
}

/** A página de IMAGENS. */
export async function ImagesGalleryPage({
  vertical,
  slug,
}: {
  vertical: GalleryVertical
  slug: string
}) {
  const data = await getImagesGalleryPageData(vertical, slug)
  if (data === null) notFound()

  // Slug não-canônico redireciona 301, igual à ficha. Sem isto, cada slug
  // antigo viraria uma galeria duplicada com canonical apontando para outra.
  if (data.canonicalSlug !== slug) {
    const destino = imagesGalleryPath(vertical, data.canonicalSlug)
    if (destino !== null) permanentRedirect(destino)
  }

  const heading = 'Imagens e pôsteres'
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: galleryJsonLd({
            vertical,
            entityTitle: data.entityTitle,
            entityPath: data.entityPath,
            canonicalUrl: data.canonicalUrl,
            heading,
          }),
        }}
        type="application/ld+json"
      />
      <GalleryShell
        belowFloor={!data.gallery.indexable}
        entityPath={data.entityPath}
        entityTitle={data.entityTitle}
        facets={[...data.gallery.kindFacets, ...data.gallery.languageFacets]}
        facetsLabel="Composição da galeria"
        heading={heading}
        total={data.gallery.total}
        unit={['imagem', 'imagens']}
        vertical={vertical}
        verticalLabel={data.verticalLabel}
      >
        {data.gallery.total === 0 ? (
          // A ausência FALA e diz a causa provável, sem prometer prazo.
          <p className="gallery-empty">
            Ainda não há imagens sincronizadas para {data.entityTitle}.
          </p>
        ) : (
          <GalleryImageGrid images={data.gallery.images} />
        )}
      </GalleryShell>
    </>
  )
}

/** A página de VÍDEOS. */
export async function VideosGalleryPage({
  vertical,
  slug,
}: {
  vertical: GalleryVertical
  slug: string
}) {
  const data = await getVideosGalleryPageData(vertical, slug)
  if (data === null) notFound()

  if (data.canonicalSlug !== slug) {
    const destino = videosGalleryPath(vertical, data.canonicalSlug)
    if (destino !== null) permanentRedirect(destino)
  }

  const heading = 'Trailers e vídeos'
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: galleryJsonLd({
            vertical,
            entityTitle: data.entityTitle,
            entityPath: data.entityPath,
            canonicalUrl: data.canonicalUrl,
            heading,
          }),
        }}
        type="application/ld+json"
      />
      <GalleryShell
        belowFloor={!data.gallery.indexable}
        entityPath={data.entityPath}
        entityTitle={data.entityTitle}
        facets={data.gallery.typeFacets}
        facetsLabel="Tipos de vídeo"
        heading={heading}
        total={data.gallery.total}
        unit={['vídeo', 'vídeos']}
        vertical={vertical}
        verticalLabel={data.verticalLabel}
      >
        {data.gallery.total === 0 ? (
          <p className="gallery-empty">
            Ainda não há vídeos liberados para {data.entityTitle}.
          </p>
        ) : (
          <GalleryVideoList entityTitle={data.entityTitle} videos={data.gallery.videos} />
        )}
      </GalleryShell>
    </>
  )
}
