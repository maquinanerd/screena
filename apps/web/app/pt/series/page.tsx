import type { Metadata } from "next";

import { CategoryHome } from "../../_components/category-home";
import { getSeriesIndexData } from "../../../src/server/entity-indexes";
import { getNewsIndexData } from "../../../src/server/news-pages";

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

const TITLE = "Séries";
const DESCRIPTION =
  "Explore as séries catalogadas na Screen — páginas editoriais em português, com guias de temporada quando disponíveis.";

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
  const [{ view, canonicalUrl }, news] = await Promise.all([
    getSeriesIndexData(),
    getNewsIndexData(),
  ]);

  return (
    <CategoryHome
      canonicalUrl={canonicalUrl}
      description={DESCRIPTION}
      newsView={news.view}
      pageTitle={TITLE}
      vertical="series"
      view={view}
    />
  );
}
