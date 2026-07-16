import type { Metadata } from 'next'

import { EntityIndex } from '../../_components/entity-index'
import { getSeriesIndexData } from '../../../src/server/entity-indexes'

/**
 * Listagem publica de series - /pt/series/ (porta de entrada; acento verde).
 *
 * Server component puro: le somente PostgreSQL via `getSeriesIndexData`. Zero
 * API externa, zero Gemini e zero TMDB no render. A rota lista somente series
 * com titulo e slug canonico reais, sem ranking ou streaming inventado.
 */

/**
 * Render dinamico (server-rendered on demand): a rota reflete o estado atual do
 * PostgreSQL a cada request e NAO e pre-renderizada no build (que roda sem
 * DATABASE_URL). Continua PURA - le so PostgreSQL, sem API externa (invariantes
 * 3/4). Mesma natureza dinamica das rotas [slug].
 */
export const dynamic = 'force-dynamic'

const TITLE = 'Séries'
const DESCRIPTION = 'Explore as séries catalogadas na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getSeriesIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  }
}

export default async function SeriesIndexPage() {
  const { view, canonicalUrl } = await getSeriesIndexData()

  return (
    <EntityIndex
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbLabel="Séries"
      canonicalUrl={canonicalUrl}
      vertical="series"
      view={view}
    />
  )
}
