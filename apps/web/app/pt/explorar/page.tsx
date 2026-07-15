import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { takeUpcomingWeek } from '../../../src/lib/home-upcoming-presenter'
import { evaluateExploreIndexability } from '../../../src/lib/explore-presenter'
import {
  canonicalPublicUrl,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from '../../../src/lib/site'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'
import { getExploreSectionFacts } from '../../../src/server/seo/sitemap-entries'

/**
 * Explorar reúne apenas destinos públicos reais e a agenda persistida da
 * semana. Não oferece busca, filtros ou estados sociais ainda inexistentes.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Explorar'
const DESCRIPTION =
  'Consulte as áreas públicas do Screen e a agenda semanal de próximos lançamentos já publicados.'
const UPCOMING_LIMIT = 5
const UPCOMING_SOURCE_LIMIT = 30

async function getExploreData() {
  // A decisao de indexabilidade do explorar vem do MESMO snapshot/funcao do
  // sitemap (`getExploreSectionFacts` + `evaluateExploreIndexability`), nunca
  // mais so dos lancamentos da semana (Prompt 3 §3). A agenda semanal segue
  // sendo conteudo renderizado, mas nao governa mais o robots.
  const [upcomingSource, exploreFacts] = await Promise.all([
    getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT }),
    getExploreSectionFacts(),
  ])
  const upcomingMovies = takeUpcomingWeek(upcomingSource, new Date(), UPCOMING_LIMIT)
  const indexability = evaluateExploreIndexability(exploreFacts)

  return { upcomingMovies, indexability }
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getExploreData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: true },
    alternates: { canonical: canonicalPublicUrl(EXPLORE_PATH) },
  }
}

export default async function ExplorePage() {
  const { upcomingMovies } = await getExploreData()
  const canonicalUrl = canonicalPublicUrl(EXPLORE_PATH)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Início',
        item: `${SITE_URL}${HOME_PATH}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: TITLE,
        item: canonicalUrl,
      },
    ],
  }

  const collectionJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  }

  return (
    <main data-vertical="explore">
      <div className="container">
        <nav aria-label="Trilha de navegação">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header>
          <h1>{TITLE}</h1>
          <p>{DESCRIPTION}</p>
        </header>

        <section aria-labelledby="explore-areas-title">
          <h2 id="explore-areas-title">Áreas do Screen</h2>
          <ul>
            <li>
              <a href={MOVIES_INDEX_PATH}>Filmes</a>
            </li>
            <li>
              <a href={SERIES_INDEX_PATH}>Séries</a>
            </li>
            <li>
              <a href={PEOPLE_INDEX_PATH}>Pessoas</a>
            </li>
            <li>
              <a href={NEWS_INDEX_PATH}>Notícias</a>
            </li>
          </ul>
        </section>

        <section aria-labelledby="discover-releases-title">
          <h2 id="discover-releases-title">Lançamentos da semana</h2>
          {upcomingMovies.length > 0 ? (
            <ul>
              {upcomingMovies.map((movie) => (
                <li key={movie.href}>
                  <a href={movie.href}>{movie.title}</a>
                  <span>
                    {' '}
                    — Filme · {movie.weekday}, {movie.date}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Nenhum lançamento publicado para explorar no momento.</p>
          )}
        </section>
      </div>

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
