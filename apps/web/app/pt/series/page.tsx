import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { HomeLike } from '../../_components/home-like'
import {
  HOME_NEWS_CARD_LIMIT,
  takeSectionCards,
} from '../../../src/lib/portal-presenter'
import { restrictEditorialHighlights } from '../../../src/lib/home-editorial-presenter'
import { filterNewsCardsByVertical } from '../../../src/lib/news-presenter'
import { RANKING_TABS } from '../../../src/lib/popular-rankings'
import { SERIES_INDEX_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getHomeCatalogData } from '../../../src/server/home-catalog'
import { getHomeEditorialHighlights } from '../../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../../src/server/home-hero'
import { getHomeTickerItems } from '../../../src/server/home-ticker'
import { getHomeUpcomingSeries } from '../../../src/server/home-upcoming'
import { getPopularRankings } from '../../../src/server/popular-rankings'
import { getNewsIndexData } from '../../../src/server/news-pages'
import { getSeriesIndexData } from '../../../src/server/entity-indexes'

/**
 * Categoria Séries — tela 04 do canônico (EX-04-dual): home-like com a banda
 * de SÉRIES ligada (showSeriesBand), acento/logo verdes por contexto e o
 * ticker de episódios novos (dataset de séries). Contratos de SEO do índice
 * real preservados (canonical, robots, CollectionPage, BreadcrumbList).
 *
 * "Em breve" aqui é SÓ SÉRIE (`getHomeUpcomingSeries` — `TvShow.firstAirDate`
 * futura). A rota passava uma lista vazia fixa, então a seção não existia nesta
 * página: era a única das três superfícies home-like sem o trilho.
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

const TITLE = 'Séries'
const DESCRIPTION = 'Explore as séries catalogadas na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getSeriesIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

export default async function SeriesCategoryPage() {
  const [index, catalog, news, seriesHero, tickerItems, upcoming, editorialHighlights, rankings] =
    await Promise.all([
      getSeriesIndexData(),
      // "Séries da semana" lê o TRENDING (mesma fonte da home), não `index`.
      getHomeCatalogData(),
      getNewsIndexData(),
      // O hero desta rota vem do escopo `series`. Antes ele vinha da lista da home
      // já cortada em 5 — e como filmes entram primeiro nessa lista, com 129
      // filmes em produção a página de séries nunca recebia um slide sequer.
      getHomeHeroSlides('series'),
      getHomeTickerItems('series'),
      getHomeUpcomingSeries(),
      getHomeEditorialHighlights(),
      getPopularRankings('series'),
    ])

  // Só matérias com vínculo `tv` persistido: a página de séries não lista a
  // matéria que só fala de filme.
  const newsCards = takeSectionCards(
    filterNewsCardsByVertical(
      [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
      'series',
    ),
    HOME_NEWS_CARD_LIMIT,
  )
  const rankingPanels = RANKING_TABS.series.map((tab, position) => ({
    tab,
    items: rankings[position]?.items ?? [],
  }))

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: index.canonicalUrl },
    ],
  }
  const collectionJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: index.canonicalUrl,
    description: DESCRIPTION,
  }
  if (index.view.cards.length > 0) {
    collectionJsonLd.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: index.view.cards.length,
      itemListElement: index.view.cards.map((card, position) => ({
        '@type': 'ListItem',
        position: position + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    }
  }

  return (
    <main data-vertical="series">
      <h1 className="visually-hidden">{TITLE}</h1>

      <HomeLike
        adPrefix="series"
        editorialHighlights={restrictEditorialHighlights(editorialHighlights, 'series')}
        editorialInitialVertical="series"
        emptyMessage="Ainda não há séries publicadas nesta seção."
        heroSlides={seriesHero}
        movieCards={[]}
        newsCards={newsCards}
        rankingPanels={rankingPanels}
        seriesCards={catalog.series}
        showMoviesBand={false}
        showSeriesBand
        tickerItems={tickerItems}
        upcoming={{ items: upcoming, vertical: 'series', route: SERIES_INDEX_PATH }}
        vertical="series"
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
