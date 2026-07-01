import type { Metadata } from "next";

import { EntityIndex } from "../../_components/entity-index";
import { getPersonIndexData } from "../../../src/server/entity-indexes";

/**
 * Listagem publica de pessoas - /pt/pessoas/ (porta de entrada; tom NEUTRO).
 *
 * Server component puro: le somente PostgreSQL via `getPersonIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Lista so pessoas com slug canonico
 * pt-BR; cada card linka para /pt/pessoas/[slug]/. Sem idade calculada, sem
 * profissao/bio inventada. Listagem vazia/fina -> noindex.
 */

/**
 * Render dinamico (server-rendered on demand): a listagem reflete o estado atual
 * do PostgreSQL a cada request e NAO e pre-renderizada no build (que roda sem
 * DATABASE_URL). Continua PURA - le so PostgreSQL, sem API externa (invariantes
 * 3/4). Mesma natureza dinamica das rotas [slug].
 */
export const dynamic = "force-dynamic";

const TITLE = "Pessoas";
const DESCRIPTION =
  "Explore as pessoas catalogadas na Screen - atores, diretores e equipe, com paginas editoriais em portugues.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getPersonIndexData();
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

export default async function PersonIndexPage() {
  const { view, canonicalUrl } = await getPersonIndexData();
  return (
    <EntityIndex
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbLabel="Pessoas"
      canonicalUrl={canonicalUrl}
      vertical="person"
      view={view}
    />
  );
}
