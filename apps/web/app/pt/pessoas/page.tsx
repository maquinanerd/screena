import type { Metadata } from "next";

import { EntityIndex } from "../../_components/entity-index";
import { getPersonIndexData } from "../../../src/server/entity-indexes";
import { publicRobots } from "../../../src/lib/site";

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
/**
 * `force-dynamic` — E DELIBERADO, e o motivo NAO e mais "ninguem pensou nisso".
 *
 * ============================================================================
 * POR QUE ESTA ROTA NAO PODE TER CACHE DE ROTA (ISR), MEDIDO
 * ============================================================================
 * Trocar isto por `export const revalidate = N` torna a rota elegivel a
 * prerender — e o Next prerenderiza caminho FIXO no `next build`. O release
 * (`Dockerfile`, linha do `pnpm --filter @screena/web build`) roda o build SEM
 * `DATABASE_URL` e sem env publica, de proposito (ver o bloco de comentario la:
 * env assada no build ja causou dois furos de fail-open). Tentado nesta leva:
 *
 *   Error occurred prerendering page "/pt/filmes"
 *   PrismaClientInitializationError: Environment variable not found: DATABASE_URL
 *   Export encountered an error on /pt/filmes/page, exiting the build.
 *
 * As rotas de FICHA (`/pt/filmes/[slug]` e irmas) nao tem esse problema: elas
 * declaram `generateStaticParams` devolvendo `[]`, entao nada e prerenderizado
 * no build e cada URL e gerada na primeira visita — la o ISR esta ligado de
 * verdade nesta leva.
 *
 * O QUE SUBSTITUI O CACHE DE ROTA AQUI: (1) as consultas deixaram de varrer o
 * catalogo inteiro (ver `src/server/entity-indexes.ts` e `src/server/home-hero.ts`)
 * e (2) o snapshot desta superficie e memoizado entre requisicoes por
 * `src/server/surface-cache.ts`. O cabecalho continua `no-store` — e ele e
 * CONSEQUENCIA da rota ser dinamica, nao uma linha nossa.
 *
 * PARA O DONO: dar cache de rota a esta pagina exige um build com banco
 * alcancavel (ou um passo de prerender pos-deploy). E decisao de deploy, nao de
 * codigo — esta registrada em `src/lib/route-cache-policy.ts`.
 */
export const dynamic = 'force-dynamic'

const TITLE = "Pessoas";
const DESCRIPTION =
  "Explore as pessoas catalogadas na Cinerie - atores, diretores e equipe, com paginas editoriais em portugues.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getPersonIndexData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
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
