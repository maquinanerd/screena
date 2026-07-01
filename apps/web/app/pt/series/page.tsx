import type { Metadata } from "next";

import { EntityIndex } from "../../_components/entity-index";
import { getSeriesIndexData } from "../../../src/server/entity-indexes";

/**
 * Listagem publica de series - /pt/series/ (porta de entrada; acento verde).
 *
 * Server component puro: le somente PostgreSQL via `getSeriesIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Lista so series com slug canonico
 * pt-BR; cada card linka para /pt/series/[slug]/. Sem nota/streaming/temporada
 * inventada. Listagem vazia/fina -> noindex.
 */

/**
 * Render dinamico (server-rendered on demand): a listagem reflete o estado atual
 * do PostgreSQL a cada request e NAO e pre-renderizada no build (que roda sem
 * DATABASE_URL). Continua PURA - le so PostgreSQL, sem API externa (invariantes
 * 3/4). Mesma natureza dinamica das rotas [slug].
 */
export const dynamic = "force-dynamic";

const TITLE = "Series";
const DESCRIPTION =
  "Explore as series catalogadas na Screen - paginas editoriais em portugues, com guias de temporada quando disponiveis.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getSeriesIndexData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
}

export default async function SeriesIndexPage() {
  const { view, canonicalUrl } = await getSeriesIndexData();
  return (
    <EntityIndex
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbLabel="Series"
      canonicalUrl={canonicalUrl}
      vertical="series"
      view={view}
    />
  );
}
