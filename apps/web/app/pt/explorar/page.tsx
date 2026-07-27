import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { takeUpcomingWeek } from '../../../src/lib/home-upcoming-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from '../../../src/lib/portal-presenter'
import { EXPLORE_PATH, HOME_PATH, MOVIES_INDEX_PATH, NEWS_INDEX_PATH, PEOPLE_INDEX_PATH, SERIES_INDEX_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'

/**
 * Explorar reúne apenas destinos públicos reais e a agenda persistida da
 * semana. Não oferece busca, filtros ou estados sociais ainda inexistentes.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Explorar'
const DESCRIPTION =
  'Consulte as áreas públicas da Cinerie e a agenda semanal de próximos lançamentos já publicados.'
const UPCOMING_LIMIT = 5
const UPCOMING_SOURCE_LIMIT = 30

async function getExploreData() {
  const upcomingMovies = takeUpcomingWeek(
    await getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT }),
    new Date(),
    UPCOMING_LIMIT,
  )
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([upcomingMovies.length]),
  })

  return { upcomingMovies, indexability }
}

export async function generateMetadata(): Promise<Metadata> {
  const { indexability } = await getExploreData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
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
        <nav aria-label="Trilha de navegação" className="breadcrumb">
          <ol>
            <li>
              <a href={HOME_PATH}>Início</a>
            </li>
            <li aria-current="page">{TITLE}</li>
          </ol>
        </nav>

        <header className="compact-hero page-header">
          <h1>{TITLE}</h1>
          <p>{DESCRIPTION}</p>
        </header>

        <section aria-labelledby="explore-areas-title" className="section">
          <div className="section-head">
            <h2 className="section-title" id="explore-areas-title">
              <strong>Áreas</strong> da Cinerie
            </h2>
          </div>
          <ul className="chip-row">
            <li>
              <a className="chip" href={MOVIES_INDEX_PATH}>
                Filmes
              </a>
            </li>
            <li>
              <a className="chip" href={SERIES_INDEX_PATH}>
                Séries
              </a>
            </li>
            <li>
              <a className="chip" href={PEOPLE_INDEX_PATH}>
                Pessoas
              </a>
            </li>
            <li>
              <a className="chip" href={NEWS_INDEX_PATH}>
                Notícias
              </a>
            </li>
            <li>
              <a className="chip" href="/pt/onde-assistir/">
                Onde assistir
              </a>
            </li>
            <li>
              <a className="chip" href="/pt/em-breve/">
                Mais aguardados
              </a>
            </li>
            <li>
              <a className="chip" href="/pt/busca/">
                Buscar
              </a>
            </li>
          </ul>
        </section>

        <section aria-labelledby="discover-releases-title" className="section">
          <div className="section-head">
            <h2 className="section-title" id="discover-releases-title">
              <strong>Lançamentos</strong> da semana
            </h2>
            <a className="see-all" href="/pt/em-breve/">
              Ver tudo
            </a>
          </div>
          {upcomingMovies.length > 0 ? (
            <ul className="news-grid">
              {upcomingMovies.map((movie) => (
                <li key={movie.href}>
                  <article className="news-list-card" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <span className="badge badge--movie">Filme</span>
                      <h3 className="news-list-card__title">
                        <a href={movie.href}>{movie.title}</a>
                      </h3>
                      <p className="news-list-card__meta">
                        {movie.weekday}, {movie.date}
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <p className="empty-state__title">
                Nenhum lançamento publicado para explorar no momento.
              </p>
            </div>
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
