import type { Metadata } from 'next'

import { EntityIndex } from '../../_components/entity-index'
import { getMovieIndexData } from '../../../src/server/entity-indexes'

/**
 * Listagem publica de filmes - /pt/filmes/ (porta de entrada; acento vermelho).
 *
 * Server component puro: le somente PostgreSQL via `getMovieIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. A rota lista somente filmes com
 * titulo e slug canonico reais, sem nota/streaming/ranking inventado.
 */

/**
 * Render dinamico (server-rendered on demand): a rota reflete o estado atual do
 * PostgreSQL a cada request e NAO e pre-renderizada no build (que roda sem
 * DATABASE_URL). Continua PURA - le so PostgreSQL, sem API externa (invariantes
 * 3/4). Mesma natureza dinamica das rotas [slug].
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Filmes'
const DESCRIPTION = 'Explore os filmes catalogados na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getMovieIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  }
}

export default async function MovieIndexPage() {
  const { view, canonicalUrl } = await getMovieIndexData()

  return (
    <EntityIndex
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbLabel="Filmes"
      canonicalUrl={canonicalUrl}
      vertical="movie"
      view={view}
    />
  )
}
