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
import { MOVIES_INDEX_PATH, SITE_URL, publicRobots } from '../../../src/lib/site'
import { getHomeCatalogData } from '../../../src/server/home-catalog'
import { getHomeEditorialHighlights } from '../../../src/server/home-editorial'
import { getHomeHeroSlides } from '../../../src/server/home-hero'
import { getHomeTickerItems } from '../../../src/server/home-ticker'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'
import { getPopularRankings } from '../../../src/server/popular-rankings'
import { getMovieIndexData } from '../../../src/server/entity-indexes'
import { getNewsIndexData } from '../../../src/server/news-pages'

/**
 * Categoria Filmes — tela 04 do canônico (EX-04-dual): "CATEGORY HOME sem
 * layout próprio → home-like + bandas". A rota reusa o template `HomeLike`
 * com dataset de FILMES, banda de filmes ligada (showMoviesBand) e acento/
 * logo vermelhos por contexto (data-vertical + header por rota). Hero mostra
 * só destaques de filme. Contratos de SEO (canonical, robots, CollectionPage,
 * BreadcrumbList, ItemList) permanecem os do índice real.
 *
 * "Em breve" aqui é SÓ FILME (`getHomeUpcomingMovies`): a rota de filmes não
 * mistura vertical. A home mistura; `/pt/series/` mostra só série.
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

const TITLE = 'Filmes'
const DESCRIPTION = 'Explore os filmes catalogados na Cinerie, com páginas editoriais em português.'

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getMovieIndexData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalUrl },
  }
}

export default async function MovieCategoryPage() {

  const [index, catalog, news, movieHero, tickerItems, upcoming, editorialHighlights, rankings] =
    await Promise.all([
      getMovieIndexData(),
      getHomeCatalogData(),
      getNewsIndexData(),
      // O hero pede o escopo: filtrar a lista da home DEPOIS do corte de 5 era
      // o que deixava a outra vertical sem hero nenhum.
      getHomeHeroSlides('movies'),
      getHomeTickerItems('movies'),
      getHomeUpcomingMovies(),
      getHomeEditorialHighlights(),
      getPopularRankings('movies'),
    ])

  // SEM FALLBACK para a listagem. `home-catalog.ts` e `trending-snapshot.ts`
  // recusam completar "Filmes em alta" com `popularity`/ano desc, e este
  // ternário reintroduzia exatamente isso um andar acima — o guard do loader
  // ficava intacto e a PÁGINA o contornava. Era por aqui que "Der Liebesbrief"
  // (curta de 1938 com `release_date` em 2057) chegava ao trilho "em alta".
  //
  // O snapshot de trending vale 6 h. Com o ternário, toda vez que a captura
  // atrasasse a página trocaria de fonte em SILÊNCIO, sob o mesmo rótulo.
  // Vazio => o trilho some, e `catalog.trendingAbsence` diz por quê.
  const movieCards = catalog.movies
  // Só matérias com vínculo `movie` persistido (`entity_news_links`): a página
  // de filmes não lista a matéria que só fala de série.
  const newsCards = takeSectionCards(
    filterNewsCardsByVertical(
      [...(news.view.featured !== null ? [news.view.featured] : []), ...news.view.cards],
      'movies',
    ),
    HOME_NEWS_CARD_LIMIT,
  )
  const rankingPanels = RANKING_TABS.movies.map((tab, position) => ({
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
    <main data-vertical="movie">
      <h1 className="visually-hidden">{TITLE}</h1>

      <HomeLike
        adPrefix="filmes"
        editorialHighlights={restrictEditorialHighlights(editorialHighlights, 'movies')}
        editorialInitialVertical="movies"
        emptyMessage="Ainda não há filmes publicados nesta seção."
        heroSlides={movieHero}
        movieCards={movieCards}
        newsCards={newsCards}
        rankingPanels={rankingPanels}
        seriesCards={[]}
        showMoviesBand
        showSeriesBand={false}
        tickerItems={tickerItems}
        upcoming={{ items: upcoming, vertical: 'movie', route: MOVIES_INDEX_PATH }}
        vertical="movies"
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
