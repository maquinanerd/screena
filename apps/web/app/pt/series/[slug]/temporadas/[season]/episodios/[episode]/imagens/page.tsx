import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd } from '@screena/seo'

import { GalleryImageGrid } from '../../../../../../../../_components/gallery-grids'
import { GalleryShell } from '../../../../../../../../_components/gallery-shell'
import { episodeImagesGalleryPath, parseRouteNumber } from '../../../../../../../../../src/lib/routes'
import {
  SERIES_INDEX_PATH,
  SITE_URL,
  gatePublicRobots,
} from '../../../../../../../../../src/lib/site'
import { getEpisodePageData } from '../../../../../../../../../src/server/episode-page'

/**
 * Galeria de imagens de UM episodio
 * (/pt/series/{slug}/temporadas/{n}/episodios/{e}/imagens/).
 *
 * ============================================================================
 * A MESMA PAGINA QUE FILME E SERIE JA TINHAM, PARA A ENTIDADE QUE NAO TINHA
 * ============================================================================
 * `/pt/filmes/{slug}/imagens/` e `/pt/series/{slug}/imagens/` existem desde a
 * leva de galerias. O episodio ficou de fora porque `tmdb_images` nunca teve
 * uma linha com `entity_type='episode'`: `sync_media` recusava o kind e
 * `extractEpisodeStills` lia `images.stills` de um payload que nao tinha o
 * bloco. Sem dado, uma rota so devolveria 404 — entao ela nao foi escrita.
 *
 * O casco (`GalleryShell`), a grade (`GalleryImageGrid`), o piso de pagina fina
 * e o gate de licenca sao os MESMOS das outras. O unico acrescimo e a trilha de
 * cinco degraus, que o casco passou a aceitar por parametro: um segundo casco
 * divergiria do primeiro no primeiro conserto.
 *
 * Invariantes 3 e 4: so PostgreSQL. Zero API externa, zero IA no render.
 */

export const revalidate = 3600

/**
 * `generateStaticParams` VAZIO — e ele que liga o `revalidate` acima.
 *
 * MEDIDO (2026-08-28): esta rota declarava `revalidate = 3600` desde 2026-07 e
 * mesmo assim respondia em producao com
 * `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.
 * A causa nao era leitura de sessao nem `force-dynamic`: era a AUSENCIA desta
 * funcao. Sem `generateStaticParams`, o Next nao considera a rota dinamica
 * elegivel a prerender, ela nao entra em `dynamicRoutes` do
 * `prerender-manifest.json`, `isSSG` fica falso e o render sai com
 * `revalidate = 0` — que e exatamente o `no-store` observado.
 *
 * PROVA POR EXPERIMENTO CONTROLADO (`next build` na mesma arvore): sem esta
 * funcao a tabela do build mostra `f (Dynamic)` e `dynamicRoutes` vem `[]`;
 * com ela (devolvendo `[]`) a mesma rota vira `. (SSG)` e aparece em
 * `dynamicRoutes`. Nenhuma outra linha mudou.
 *
 * Devolve `[]` DE PROPOSITO: nao ha nada para prerenderizar no build (sao ~67
 * mil URLs e o banco nao esta disponivel la). Cada URL e gerada na primeira
 * visita e entao guardada pela janela do `revalidate` — que e o comportamento
 * que a rota sempre quis ter.
 */
export async function generateStaticParams(): Promise<Record<string, string>[]> {
  return []
}

interface RouteParams {
  slug: string
  season: string
  episode: string
}

const HEADING = 'Imagens do episódio'

/** Resolve os tres numeros da rota, ou `null` quando algum nao e canonico. */
function parseRoute(params: RouteParams): { season: number; episode: number } | null {
  const season = parseRouteNumber(params.season)
  const episode = parseRouteNumber(params.episode)
  if (season === null || episode === null) return null
  return { season, episode }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>
}): Promise<Metadata> {
  const resolved = await params
  const numeros = parseRoute(resolved)
  if (numeros === null) {
    return { title: 'Galeria não encontrada', robots: { index: false, follow: false } }
  }
  const data = await getEpisodePageData(resolved.slug, numeros.season, numeros.episode)
  if (data === null) {
    return { title: 'Galeria não encontrada', robots: { index: false, follow: false } }
  }

  const { view, images } = data
  const canonical = episodeImagesGalleryPath(view.seriesSlug, view.seasonNumber, view.episodeNumber)
  const title = `Imagens de ${view.episodeTitle} — ${view.seriesTitle}, T${view.seasonNumber} E${view.episodeNumber}`
  return {
    title,
    description: `${String(images.total)} imagens do episódio "${view.episodeTitle}", fornecidas pelo TMDB.`,
    // O MESMO piso de pagina fina das outras galerias: abaixo dele a pagina
    // RESPONDE (o conteudo existe) mas nao indexa. E o caso tecnico da
    // invariante 5 — o episodio dono continua indexando normalmente.
    robots: gatePublicRobots({ index: images.indexable, follow: true }),
    alternates: canonical === null ? undefined : { canonical: `${SITE_URL}${canonical}` },
    openGraph: {
      title,
      url: canonical === null ? undefined : `${SITE_URL}${canonical}`,
      type: 'website',
    },
  }
}

export default async function EpisodeImagesPage({ params }: { params: Promise<RouteParams> }) {
  const resolved = await params
  const numeros = parseRoute(resolved)
  if (numeros === null) notFound()

  const data = await getEpisodePageData(resolved.slug, numeros.season, numeros.episode)
  if (data === null) notFound()

  // Slug nao-canonico redireciona 301, igual a ficha e as outras galerias. Sem
  // isto, cada slug antigo viraria uma galeria duplicada com canonical
  // apontando para outra URL.
  if (resolved.slug !== data.canonicalSlug) {
    const destino = episodeImagesGalleryPath(data.canonicalSlug, numeros.season, numeros.episode)
    if (destino !== null) permanentRedirect(destino)
  }

  const { view, images, canonicalUrl, seasonUrl, seriesUrl } = data
  const seriesHref = `${SERIES_INDEX_PATH}${view.seriesSlug}/`

  /**
   * A galeria NAO se declara `ImageGallery`.
   *
   * Esse tipo afirma uma colecao editorial propria, e o que existe aqui e arte
   * de terceiro exibida sob licenca. O `mainEntity` aponta para o EPISODIO, que
   * e a entidade de verdade — e e a ele que o buscador deve associar as
   * imagens. Mesma decisao das galerias de titulo.
   */
  const jsonLd = serializeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Séries', item: `${SITE_URL}${SERIES_INDEX_PATH}` },
      { '@type': 'ListItem', position: 2, name: view.seriesTitle, item: seriesUrl },
      { '@type': 'ListItem', position: 3, name: view.seasonTitle, item: seasonUrl },
      { '@type': 'ListItem', position: 4, name: view.episodeTitle, item: canonicalUrl },
      {
        '@type': 'ListItem',
        position: 5,
        name: HEADING,
        item: `${canonicalUrl}imagens/`,
      },
    ],
    mainEntity: {
      '@type': 'TVEpisode',
      name: view.episodeTitle,
      episodeNumber: view.episodeNumber,
      url: canonicalUrl,
    },
  })

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: jsonLd }} type="application/ld+json" />
      <GalleryShell
        belowFloor={!images.indexable}
        // A trilha de CINCO degraus: sem a temporada, o leitor perde a pagina de
        // onde veio.
        crumbs={[
          { label: 'Séries', href: SERIES_INDEX_PATH },
          { label: view.seriesTitle, href: seriesHref },
          { label: view.seasonTitle, href: view.seasonHref },
          { label: view.episodeTitle, href: canonicalUrl },
          { label: HEADING, href: null },
        ]}
        entityPath={canonicalUrl}
        entityTitle={view.episodeTitle}
        facets={[...images.kindFacets, ...images.languageFacets]}
        facetsLabel="Composição da galeria"
        heading={HEADING}
        total={images.total}
        unit={['imagem', 'imagens']}
        vertical="series"
        verticalLabel="Episódio"
      >
        {images.total === 0 ? (
          // A ausencia FALA e diz a causa provavel, sem prometer prazo.
          <p className="gallery-empty">
            Ainda não há imagens sincronizadas para {view.episodeTitle}.
          </p>
        ) : (
          <GalleryImageGrid images={images.images} />
        )}
      </GalleryShell>
    </>
  )
}
