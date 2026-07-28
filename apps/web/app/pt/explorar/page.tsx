import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { CardBookmark } from '../../_components/card-bookmark'
import { ContinueWatching } from '../../_components/continue-watching'
import { DiscoverFilterableRails } from '../../_components/discover-rails'
import { takeUpcomingWeek } from '../../../src/lib/home-upcoming-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from '../../../src/lib/portal-presenter'
import { EXPLORE_PATH, HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getDiscoverData } from '../../../src/server/discover'
import { getHomeUpcomingMovies } from '../../../src/server/home-upcoming'

/**
 * Explorar — tela 11 do canônico, estrutura EXATA: barra de BUSCA (form real
 * → /pt/busca/) → Ad → cabeçalho com tabs reais Tudo/Filmes/Séries → DESTAQUE
 * escuro cinematográfico (nº 1 por popularidade local, com backdrop, poster,
 * onde assistir LICENCIADO como texto e watchlist real) → EM ALTA ranqueado →
 * CONTINUAR ASSISTINDO (fronteira autenticada /api/me/**) → LANÇAMENTOS
 * (agenda da semana persistida) → MAIS AGUARDADOS (estreias futuras) →
 * POPULARES. Deltas honestos: sem metrica de variacao diaria, sem contagem "mais salvos",
 * sem nota/votos (ratings inativos) — rótulos ajustados, nunca métrica
 * inventada; ordenação usa sinais técnicos locais (popularity/voteCountTmdb)
 * já persistidos pela ingestão (zero API externa no render).
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Explorar'
const DESCRIPTION =
  'Explore estreias, títulos em alta e populares da Cinerie, e continue de onde você parou.'
const UPCOMING_LIMIT = 5
const SOON_LIMIT = 7
const UPCOMING_SOURCE_LIMIT = 30

async function getExploreData() {
  const [discover, upcomingAll] = await Promise.all([
    getDiscoverData(),
    getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT }),
  ])
  const upcomingWeek = takeUpcomingWeek(upcomingAll, new Date(), UPCOMING_LIMIT)
  const anticipated = upcomingAll.slice(0, SOON_LIMIT)
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      discover.emAlta.length,
      discover.populares.length,
      upcomingWeek.length,
    ]),
  })
  return { discover, upcomingWeek, anticipated, indexability }
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
  const { discover, upcomingWeek, anticipated } = await getExploreData()
  const canonicalUrl = canonicalPublicUrl(EXPLORE_PATH)
  const featured = discover.featured

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}${HOME_PATH}` },
      { '@type': 'ListItem', position: 2, name: TITLE, item: canonicalUrl },
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
      <div className="disc-wrap">
        {/* Busca real (GET /pt/busca/?q=…) */}
        <form action="/pt/busca/" className="disc-search" method="get" role="search">
          <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.6" x2="21" y1="16.6" y2="21" />
          </svg>
          <input
            aria-label="Buscar filmes, séries, pessoas"
            name="q"
            placeholder="Buscar filmes, séries, pessoas…"
            type="search"
          />
          <span aria-hidden="true" className="disc-search__kbd">
            ENTER
          </span>
        </form>

        <AdSlot format="leaderboard" slotId="explore-top" />

        <DiscoverFilterableRails
          emAlta={discover.emAlta}
          populares={discover.populares}
          lead={
            /* DESTAQUE escuro cinematográfico — ANTES do Em Alta (canônico) */
            <>
          {featured !== null ? (
            <section aria-label={`Destaque: ${featured.title}`} className="disc-feature disc-section">
              {featured.backdropUrl !== null ? (
                <div className="disc-feature__bg">
                  <img alt="" fetchPriority="high" src={featured.backdropUrl} />
                </div>
              ) : null}
              <div className="disc-feature__scrim" />
              <div className="disc-feature__inner">
                <div className="disc-feature__text">
                  <div className="disc-feature__badges">
                    <span
                      className={
                        featured.entityType === 'movie'
                          ? 'disc-feature__type'
                          : 'disc-feature__type disc-feature__type--series'
                      }
                    >
                      {featured.entityType === 'movie' ? 'Filme' : 'Série'}
                    </span>
                    <span className="disc-feature__kicker">Em alta</span>
                  </div>
                  <h2 className="disc-feature__title">
                    <a href={featured.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {featured.title}
                    </a>
                  </h2>
                  {featured.originalTitle !== null || featured.year !== null ? (
                    <div className="disc-feature__original">
                      {[featured.originalTitle, featured.year !== null ? String(featured.year) : null]
                        .filter((item): item is string => item !== null)
                        .join(' · ')}
                    </div>
                  ) : null}
                  {featured.summary !== null ? (
                    <p className="disc-feature__synopsis">{featured.summary}</p>
                  ) : null}
                  {featured.watchProviders.length > 0 ? (
                    <div className="disc-feature__where">
                      <span className="disc-feature__where-label">Onde assistir</span>
                      {/* Provedores como TEXTO (logo_allowed=false) */}
                      {featured.watchProviders.map((provider) => (
                        <span className="disc-feature__provider" key={provider}>
                          {provider}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="disc-feature__actions">
                    <CardBookmark
                      entityId={featured.entityId}
                      entityType={featured.entityType}
                      label="Adicionar à watchlist"
                      title={featured.title}
                    />
                  </div>
                </div>
                {featured.posterUrl !== null ? (
                  <a aria-hidden="true" className="disc-feature__poster" href={featured.href} tabIndex={-1}>
                    <img alt="" loading="lazy" src={featured.posterUrl} />
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}
            </>
          }
        >
          {/* CONTINUAR ASSISTINDO — fronteira autenticada real */}
          <section aria-labelledby="disc-cw-title" className="disc-section" data-vertical="series">
            <div className="disc-section-head">
              <div className="eyebrow-bar">
                <span aria-hidden="true" className="eyebrow-bar__mark" />
                <h2 className="section-title section-title--sm" id="disc-cw-title">
                  <strong>Continuar</strong> <span>assistindo</span>
                </h2>
              </div>
              <span className="disc-note">De onde você parou</span>
            </div>
            <ContinueWatching />
          </section>

          {/* LANÇAMENTOS — agenda da semana persistida */}
          <section aria-labelledby="disc-releases-title" className="disc-section">
            <div className="disc-section-head">
              <div className="eyebrow-bar">
                <span aria-hidden="true" className="eyebrow-bar__mark" />
                <h2 className="section-title section-title--sm" id="disc-releases-title">
                  <strong>Lançamentos</strong>
                </h2>
              </div>
              <span className="disc-note">Agenda da semana</span>
            </div>
            {upcomingWeek.length > 0 ? (
              <div className="disc-agenda">
                {upcomingWeek.map((movie) => {
                  const day = movie.dateIso.slice(8, 10)
                  return (
                    <div className="disc-agenda__row" key={movie.href}>
                      <div className="disc-agenda__date">
                        <div className="disc-agenda__weekday">{movie.weekday}</div>
                        <div className="disc-agenda__day">{day}</div>
                      </div>
                      <a aria-hidden="true" className="disc-agenda__thumb" href={movie.href} tabIndex={-1}>
                        {movie.imageUrl !== null ? (
                          <img alt="" loading="lazy" src={movie.imageUrl} />
                        ) : null}
                      </a>
                      <div className="disc-agenda__body">
                        <div className="disc-agenda__kicker">Filme</div>
                        <div className="disc-agenda__title">
                          <a href={movie.href} style={{ color: 'inherit', textDecoration: 'none' }}>
                            {movie.title}
                          </a>
                        </div>
                        <div className="disc-agenda__sub">Estreia em {movie.date}</div>
                      </div>
                      <div className="disc-agenda__side">
                        <span className="disc-agenda__badge">Estreia</span>
                        {movie.entityId !== null ? (
                          <CardBookmark
                            entityId={movie.entityId}
                            entityType="movie"
                            title={movie.title}
                            variant="circle"
                          />
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="muted">Nenhum lançamento publicado para a semana.</p>
            )}
          </section>

          {/* MAIS AGUARDADOS — estreias futuras persistidas (sem contagem de
              "mais salvos": não há agregado público — delta honesto) */}
          <section aria-labelledby="disc-soon-title" className="disc-section">
            <div className="disc-section-head" style={{ justifyContent: 'space-between' }}>
              <div className="eyebrow-bar">
                <span aria-hidden="true" className="eyebrow-bar__mark" />
                <h2 className="section-title section-title--sm" id="disc-soon-title">
                  <strong>Mais</strong> <span>aguardados</span>
                </h2>
              </div>
              <a className="see-all" href="/pt/em-breve/">
                Ver todos
              </a>
            </div>
            {anticipated.length > 0 ? (
              <div className="disc-rank">
                {anticipated.map((movie) => (
                  <a className="disc-rank__card" data-entity-type="movie" href={movie.href} key={movie.href}>
                    <span className="disc-rank__poster">
                      {movie.imageUrl !== null ? (
                        <img alt="" loading="lazy" src={movie.imageUrl} />
                      ) : null}
                      <span className="disc-rank__type">Filme</span>
                    </span>
                    <span className="disc-rank__title">{movie.title}</span>
                    <span className="disc-soon__date">Estreia · {movie.date}</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">Nenhuma estreia futura publicada.</p>
            )}
          </section>
        </DiscoverFilterableRails>

        <AdSlot format="leaderboard" slotId="explore-bottom" />
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
