import type { Metadata } from 'next'

import {
  PersonPhotosGalleryPage,
  personPhotosGalleryMetadata,
} from '../../../../_components/gallery-pages'

/**
 * Fotos de pessoa — /pt/pessoas/[slug]/fotos/.
 *
 * ARQUIVO FINO DE PROPOSITO, igual as quatro rotas de galeria de titulo: o App
 * Router exige um `page.tsx` por rota, e a implementacao vive em
 * `app/_components/gallery-pages.tsx`.
 *
 * A ENTIDADE dona (a pessoa) continua indexando normalmente. Esta sub-pagina
 * so indexa acima do piso (`PERSON_PHOTOS_INDEX_FLOOR`): abaixo dele ela nao
 * entrega nada que a tira da ficha ja nao mostre, e uma URL que duplica um
 * bloco existente e o CASO TECNICO da invariante 5 — nao um gate anti-thin
 * ressuscitado.
 */

export const revalidate = 3600

interface PersonPhotosRouteParams {
  slug: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PersonPhotosRouteParams>
}): Promise<Metadata> {
  const { slug } = await params
  return await personPhotosGalleryMetadata(slug)
}

export default async function Page({
  params,
}: {
  params: Promise<PersonPhotosRouteParams>
}) {
  const { slug } = await params
  return <PersonPhotosGalleryPage slug={slug} />
}
