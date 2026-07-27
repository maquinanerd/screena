import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { EmptyState, SectionHead } from '../../_components/ds'
import { HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'

/**
 * Em breve / Mais aguardados — tela 12 do handoff (ExploreTemplate):
 * faixa escura de trailer-cards + grade por data de estreia. Usa o pipeline
 * offline de upcoming ja existente (PostgreSQL local); estreia sem data NUNCA
 * ganha data inventada (EX-12-nodate) — o getter so retorna datadas futuras.
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Mais aguardados'
const DESCRIPTION =
  'Próximas estreias de cinema já confirmadas no catálogo da Cinerie, com data de lançamento no Brasil.'
const ANTICIPATED_PATH = '/pt/em-breve/'
const SOURCE_LIMIT = 30

export async function generateMetadata(): Promise<Metadata> {
  const upcoming = await getHomeUpcomingMovies({ limit: SOURCE_LIMIT })
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(upcoming.length > 0),
    alternates: { canonical: canonicalPublicUrl(ANTICIPATED_PATH) },
  }
}

export default async function AnticipatedPage() {
  const upcoming = await getHomeUpcomingMovies({ limit: SOURCE_LIMIT })
  const rail = upcoming.slice(0, 6)
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
      </div>

      {rail.length > 0 ? (
        <div className="dark-band">
          <section aria-labelledby="anticipated-rail-title" className="section">
            <div className="container">
              <SectionHead id="anticipated-rail-title" title="Em breve" />
              <ul className="rail rail--wide">
                {rail.map((movie) => (
                  <li key={movie.href}>
                    <article className="trailer-card">
                      <div className="trailer-card__media">
                        {movie.imageUrl !== null ? (
                          <img alt="" loading="lazy" src={movie.imageUrl} />
                        ) : null}
                      </div>
                      <div className="trailer-card__body">
                        <h3 className="trailer-card__title">
                          <a href={movie.href}>{movie.title}</a>
                        </h3>
                        <p className="trailer-card__meta">
                          {movie.weekday !== '' ? `${movie.weekday} · ` : ''}
                          {movie.date}
                        </p>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      ) : null}

      <div className="container">
        {upcoming.length > 0 ? (
          <section aria-labelledby="anticipated-grid-title" className="section">
            <SectionHead id="anticipated-grid-title" title="Por estreia" />
            <ul className="news-grid">
              {upcoming.map((movie) => (
                <li key={`grid-${movie.href}`}>
                  <article className="news-list-card" style={{ gridTemplateColumns: '1fr' }}>
                    <div>
                      <span className="badge badge--movie">Filme</span>
                      <h3 className="news-list-card__title">
                        <a href={movie.href}>{movie.title}</a>
                      </h3>
                      <p className="news-list-card__meta">Estreia em {movie.date}</p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <EmptyState title="Nenhuma estreia futura confirmada no catálogo.">
            <p>Quando houver datas de lançamento confirmadas, elas aparecem aqui.</p>
          </EmptyState>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
