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
 * A INDEXAÇÃO: GALERIA NUNCA INDEXA COMO PÁGINA PRÓPRIA (desde 2026-09-11)
 * ============================================================================
 * Decisão do dono D1 (`docs/seo/DECISOES-DO-DONO-2026-09-11.md`), medida pela
 * auditoria de SEO: 69.016 URLs de galeria, 42,7% do sitemap, com 0 palavras de
 * conteúdo principal. Elas só pediam rastreio, sem alimentar Google Imagens.
 *
 * Até essa data o PISO de quantidade decidia o índice (abaixo dele, `noindex`).
 * Agora toda galeria sai `noindex, follow` pelo portão `evaluateGalleryGate` —
 * a página continua acessível, e é a ENTIDADE dona quem se oferece ao índice. O
 * piso continua existindo, mas decide só o aviso da tela (`belowFloor`).
 *
 * "Indexação total" (invariante 5) vale para a ENTIDADE, e a entidade segue
 * indexando: uma galeria não é uma entidade, é uma sub-página dela.
 *
 * Invariantes 3/4: zero API externa e zero IA no render.
 */

import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { QUALITY_GATE_ROBOTS, serializeJsonLd } from '@screena/seo'

import { GalleryImageGrid, GalleryVideoList, PersonPhotoGrid } from './gallery-grids'
import { GalleryShell } from './gallery-shell'
import { imagesGalleryPath, personPhotosPath, videosGalleryPath } from '../../src/lib/routes'
import { PEOPLE_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../src/lib/site'
import {
  getImagesGalleryPageData,
  getVideosGalleryPageData,
  type GalleryVertical,
} from '../../src/server/gallery-page'
import { getPersonPhotosPageData } from '../../src/server/person-photos-page'

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
    // D1 (decisão do dono, 2026-09-11): galeria nunca indexa como página
    // própria. O piso de quantidade continua decidindo o aviso da tela
    // (`belowFloor`), e não mais o índice.
    robots: gatePublicRobots(QUALITY_GATE_ROBOTS),
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
    // D1: galeria nunca indexa como página própria (ver a nota do cabeçalho).
    robots: gatePublicRobots(QUALITY_GATE_ROBOTS),
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

/** Metadata da galeria de FOTOS de uma pessoa. */
export async function personPhotosGalleryMetadata(slug: string): Promise<Metadata> {
  const data = await getPersonPhotosPageData(slug)
  if (data === null) {
    return { title: 'Galeria não encontrada', robots: { index: false, follow: false } }
  }
  const title = `Fotos de ${data.personName}`
  return {
    title,
    description: `${data.gallery.total} fotos de ${data.personName}, fornecidas pelo TMDB.`,
    // D1: galeria nunca indexa como página própria (ver a nota do cabeçalho).
    robots: gatePublicRobots(QUALITY_GATE_ROBOTS),
    alternates: { canonical: data.canonicalUrl },
    openGraph: { title, url: data.canonicalUrl, type: 'website' },
  }
}

/**
 * A página de FOTOS de uma pessoa — `/pt/pessoas/{slug}/fotos/`.
 *
 * O JSON-LD segue a mesma decisão das galerias de título: NÃO se declara
 * `ImageGallery` (isso afirmaria uma coleção editorial própria, e o que existe
 * é retrato de terceiro exibido sob licença). O `mainEntity` aponta para a
 * `Person`, que é a entidade de verdade e a que o buscador deve associar às
 * fotos.
 */
export async function PersonPhotosGalleryPage({ slug }: { slug: string }) {
  const data = await getPersonPhotosPageData(slug)
  if (data === null) notFound()

  // Slug não-canônico redireciona 301, igual à ficha e às galerias de título.
  if (data.canonicalSlug !== slug) {
    const destino = personPhotosPath(data.canonicalSlug)
    if (destino !== null) permanentRedirect(destino)
  }

  const heading = 'Fotos'
  const jsonLd = serializeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Pessoas', item: `${SITE_URL}${PEOPLE_INDEX_PATH}` },
      {
        '@type': 'ListItem',
        position: 2,
        name: data.personName,
        item: `${SITE_URL}${data.personPath}`,
      },
      { '@type': 'ListItem', position: 3, name: heading, item: data.canonicalUrl },
    ],
    mainEntity: {
      '@type': 'Person',
      name: data.personName,
      url: `${SITE_URL}${data.personPath}`,
    },
  })

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: jsonLd }} type="application/ld+json" />
      <GalleryShell
        belowFloor={!data.gallery.indexable}
        entityPath={data.personPath}
        entityTitle={data.personName}
        facets={data.gallery.languageFacets}
        facetsLabel="Idioma das fotos"
        heading={heading}
        total={data.gallery.total}
        unit={['foto', 'fotos']}
        vertical="pessoas"
        verticalLabel="Pessoa"
      >
        {data.gallery.total === 0 ? (
          // A ausência FALA. Aqui ela não pode nomear a causa como a tira faz
          // (o leitor não é o operador), mas também não finge que a pessoa é
          // que não tem foto: diz que não há foto LIBERADA — que é o fato.
          <p className="gallery-empty">
            Ainda não há fotos liberadas para {data.personName}.
          </p>
        ) : (
          <PersonPhotoGrid photos={data.gallery.photos} />
        )}
      </GalleryShell>
    </>
  )
}
