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
