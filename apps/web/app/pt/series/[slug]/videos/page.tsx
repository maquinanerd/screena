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
