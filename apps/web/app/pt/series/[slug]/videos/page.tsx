import type { Metadata } from 'next'

import {
  VideosGalleryPage,
  videosGalleryMetadata,
  type GalleryRouteParams,
} from '../../../../_components/gallery-pages'

/**
 * Trailers e vídeos de serie — /pt/series/[slug]/videos/.
 *
 * ARQUIVO FINO DE PROPOSITO. O App Router exige um `page.tsx` por rota, o que
 * obriga a quatro arquivos; a implementacao das duas paginas (imagens e videos)
 * vive em `app/_components/gallery-pages.tsx`, parametrizada por vertical.
 * Quatro implementacoes gemeas divergiriam no primeiro conserto aplicado a uma
 * e esquecido nas outras — e o repositorio ja pagou esse defeito antes.
 *
 * A vertical NAO e so um rotulo: ela decide `entity_type`, breadcrumb, badge,
 * schema e URL — os cinco sinais da invariante 11.
 */

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<GalleryRouteParams>
}): Promise<Metadata> {
  const { slug } = await params
  return await videosGalleryMetadata('series', slug)
}

export default async function Page({
  params,
}: {
  params: Promise<GalleryRouteParams>
}) {
  const { slug } = await params
  return <VideosGalleryPage slug={slug} vertical="series" />
}
