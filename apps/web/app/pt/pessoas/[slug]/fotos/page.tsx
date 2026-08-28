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

/**
 * `generateStaticParams` VAZIO — e ele que liga o `revalidate` acima.
 *
 * ACRESCENTADO NA RESOLUCAO DO CONFLITO com a `main` (28/08/2026). Esta rota
 * nasceu (#233, 27/08) declarando `revalidate = 3600` e SEM esta funcao, que e
 * exatamente o defeito que a #245/#250 mediram nas galerias irmas: sem
 * `generateStaticParams` o Next nao considera a rota elegivel a prerender, ela
 * nao entra em `dynamicRoutes` do `prerender-manifest.json`, `isSSG` fica falso
 * e o render sai com `revalidate = 0` — o `no-store` observado em producao. O
 * `revalidate` declarado era INERTE.
 *
 * Devolve `[]` DE PROPOSITO: nao ha o que prerenderizar no build (o banco nao
 * esta disponivel la). Cada URL e gerada na primeira visita e guardada pela
 * janela do `revalidate`.
 *
 * SEGURO AQUI, e a checagem nao e formalidade: `generateStaticParams` numa rota
 * que le `searchParams` derruba a rota inteira com 500 em runtime (#250, toda
 * ficha de serie). Esta pagina le `params`, nunca `searchParams` — os filtros
 * da galeria de fotos sao client-side.
 */
export async function generateStaticParams(): Promise<Record<string, string>[]> {
  return []
}

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
