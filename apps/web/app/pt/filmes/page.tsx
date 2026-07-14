import type { Metadata } from "next";

import { CategoryHome } from "../../_components/category-home";
import { getMovieIndexData } from "../../../src/server/entity-indexes";
import { getHomeUpcomingMovies } from "../../../src/server/home-upcoming";
import { getNewsIndexData } from "../../../src/server/news-pages";

/**
 * Listagem publica de filmes - /pt/filmes/ (porta de entrada; acento vermelho).
 *
 * Server component puro: le somente PostgreSQL via `getMovieIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Lista so filmes com slug canonico
 * pt-BR; cada card linka para /pt/filmes/[slug]/. Sem nota/streaming/ranking
 * inventado. Listagem vazia/fina -> noindex.
 */

/**
 * Render dinamico (server-rendered on demand): a listagem reflete o estado atual
 * do PostgreSQL a cada request e NAO e pre-renderizada no build (que roda sem
 * DATABASE_URL). Continua PURA - le so PostgreSQL, sem API externa (invariantes
 * 3/4). Mesma natureza dinamica das rotas [slug].
 */
export const dynamic = "force-dynamic";

const TITLE = "Filmes";
const DESCRIPTION =
  "Explore os filmes catalogados na Screen — páginas editoriais em português, atualizadas conforme novas fichas são publicadas.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getMovieIndexData();
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

export default async function MovieIndexPage() {
  const [{ view, canonicalUrl }, upcoming, news] = await Promise.all([
    getMovieIndexData(),
    getHomeUpcomingMovies({ limit: 4 }),
    getNewsIndexData(),
  ]);

  return (
    <CategoryHome
      canonicalUrl={canonicalUrl}
      description={DESCRIPTION}
      newsView={news.view}
      pageTitle={TITLE}
      upcoming={upcoming}
      vertical="movie"
      view={view}
    />
  );
}
