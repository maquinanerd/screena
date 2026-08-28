import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AnticipatedGrid } from '../../_components/anticipated-grid'
import { EmptyState } from '../../_components/ds'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getAnticipatedData } from '../../../src/server/anticipated'

/**
 * Em breve / Mais Aguardados — tela 12 do canônico, estrutura EXATA:
 * head (h1 + total real + tabs de período) → barra filtro/ordenar → grade de
 * Media Anticipation Cards. Dados 100% do PostgreSQL local (pipeline offline
 * de upcoming); estreia sem data NUNCA ganha data inventada (EX-12-nodate) —
 * ela vira o estado âmbar canônico "Data não confirmada".
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

const TITLE = 'Mais Aguardados'
const DESCRIPTION =
  'Próximas estreias de filmes, séries, temporadas e episódios já confirmadas no catálogo da Cinerie.'
const ANTICIPATED_PATH = '/pt/em-breve/'

export async function generateMetadata(): Promise<Metadata> {
  const { total } = await getAnticipatedData()
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(total > 0),
    alternates: { canonical: canonicalPublicUrl(ANTICIPATED_PATH) },
  }
}

export default async function AnticipatedPage() {
  const { cards, total } = await getAnticipatedData()
  const canonicalUrl = canonicalPublicUrl(ANTICIPATED_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
    ],
  }

  return (
    <main data-vertical="anticipated">
      <div className="container" style={{ paddingTop: 36 }}>
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        {total > 0 ? (
          <AnticipatedGrid cards={cards} total={total} />
        ) : (
          <>
            <h1 className="ant-title">{TITLE}</h1>
            <EmptyState title="Nenhuma estreia futura confirmada no catálogo.">
              <p>Quando houver datas de lançamento confirmadas, elas aparecem aqui.</p>
            </EmptyState>
          </>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
