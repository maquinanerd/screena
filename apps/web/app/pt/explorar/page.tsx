import type { Metadata } from 'next'

import { serializeJsonLd } from '@screena/seo'

import { AdSlot } from '../../_components/ad-slot'
import { CardBookmark } from '../../_components/card-bookmark'
import { ContinueWatching } from '../../_components/continue-watching'
import { DiscoverFilterableRails } from '../../_components/discover-rails'
import { SearchResults } from '../../_components/search-results'
import { WatchPlatformLine } from '../../_components/watch-platform-line'
import { takeUpcomingWeek } from '../../../src/lib/home-upcoming-presenter'
import {
  countPopulatedSections,
  evaluatePortalIndexability,
} from '../../../src/lib/portal-presenter'
import { EXPLORE_PATH, HOME_PATH, SITE_URL, canonicalPublicUrl, publicRobots } from '../../../src/lib/site'
import { getDiscoverData } from '../../../src/server/discover'
import { getHomeUpcomingMixed } from '../../../src/server/home-upcoming'
import { getAnticipatedData } from '../../../src/server/anticipated'
import { foldSearchTerm, getSearchPageData } from '../../../src/server/search-page'

/**
 * Explorar — a superfície ÚNICA de navegação e busca.
 *
 * BROWSE (tela 10) E DISCOVER (tela 11) NÃO SÃO DUAS PÁGINAS. São dois ESTADOS
 * da mesma superfície, e é assim que o canônico se reconcilia com uma rota só:
 *
 *   sem `?q=` → NAVEGAÇÃO (o BROWSE): campo de busca no topo, destaque, Em
 *               Alta, Continuar assistindo, Lançamentos, Mais aguardados,
 *               Populares. Conteúdo real, indexável.
 *   com `?q=` → RESULTADO: o bloco de resultados entra acima das seções, e a
 *               página passa a `noindex` — resultado de busca é infinito e fino
 *               por natureza, e cada combinação de termo viraria uma URL.
 *
 * `/pt/busca/` era um formulário nu: campo, botão e uma frase instrutiva, zero
 * conteúdo — duas páginas finas na mesma intenção, ambas candidatas a
 * `noindex`. Ela agora responde 301 para cá, preservando `?q=`.
 *
 * O canonical aponta SEMPRE para a rota base, sem o termo: combinações de query
 * nunca viram URL canônica nem entram em sitemap.
 *
 * Estrutura do estado de navegação: barra de BUSCA (form real, GET nesta mesma
 * rota) → Ad → tabs reais Tudo/Filmes/Séries → DESTAQUE escuro cinematográfico
 * (nº 1 por popularidade local, com backdrop, poster, onde assistir LICENCIADO
 * como texto e watchlist real) → EM ALTA ranqueado → CONTINUAR ASSISTINDO
 * (fronteira autenticada /api/me/**) → LANÇAMENTOS (agenda da semana
 * persistida) → MAIS AGUARDADOS (estreias futuras) → POPULARES. Deltas
 * honestos: sem métrica de variação diária, sem contagem "mais salvos", sem
 * nota/votos (ratings inativos) — rótulos ajustados, nunca métrica inventada;
 * ordenação usa sinais técnicos locais (popularity/voteCountTmdb) já
 * persistidos pela ingestão (zero API externa no render).
 */

export const dynamic = 'force-dynamic'

const TITLE = 'Explorar'
const DESCRIPTION =
  'Explore estreias, títulos em alta e populares da Cinerie, e continue de onde você parou.'
/**
 * Rótulo pt-BR de cada tipo de "mais aguardado". Fica aqui, em singular, porque
 * o filtro de `/pt/em-breve/` usa o plural ("Filmes", "Séries") e um card não
 * pode dizer "Filmes".
 */
const ANTICIPATED_KIND_LABEL: Record<'movie' | 'tv' | 'season' | 'episode', string> = {
  movie: 'Filme',
  tv: 'Série',
  season: 'Temporada',
  episode: 'Episódio',
}
const UPCOMING_LIMIT = 5
const SOON_LIMIT = 7
const UPCOMING_SOURCE_LIMIT = 30

/**
 * DOIS TRILHOS, DUAS FONTES — e nenhuma delas é "só filme".
 *
 * O defeito era de FIAÇÃO, não de dado. Os dois trilhos liam
 * `getHomeUpcomingMovies`: filmes, com data, e com slug canônico pt-BR. Só
 * isso. Enquanto `/pt/em-breve/` — a página para onde "Ver todos" aponta — lê
 * `getAnticipatedData`, que cobre SEIS conjuntos: filmes com data, filmes
 * anunciados sem data, séries com data, séries anunciadas sem data, temporadas
 * futuras e o próximo episódio de séries no ar.
 *
 * O resultado era um trilho que dizia "Ver todos" para uma página capaz de
 * mostrar coisas que o trilho nunca mostraria — e um "Nenhuma estreia futura
 * publicada" que, na prática, queria dizer "nenhum FILME com data".
 *
 * Agora: a agenda da semana lê o trilho MISTO (filme + série), e "Mais
 * aguardados" lê exatamente a mesma fonte de `/pt/em-breve/`.
 */
async function getExploreData() {
  const [discover, upcomingAll, anticipatedData] = await Promise.all([
    getDiscoverData(),
    getHomeUpcomingMixed({ limit: UPCOMING_SOURCE_LIMIT }),
    getAnticipatedData(),
  ])
  const upcomingWeek = takeUpcomingWeek(upcomingAll, new Date(), UPCOMING_LIMIT)
  const anticipated = anticipatedData.cards.slice(0, SOON_LIMIT)
  const indexability = evaluatePortalIndexability({
    populatedSectionCount: countPopulatedSections([
      discover.emAlta.length,
      discover.populares.length,
      upcomingWeek.length,
    ]),
  })
  return { discover, upcomingWeek, anticipated, indexability }
}

/** O termo cru da query, já normalizado para string (nunca `undefined`). */
function readQuery(searchParams: ExploreSearchParams): string {
  const raw = searchParams.q
  if (typeof raw === 'string') return raw
  // `?q=a&q=b` chega como array. Buscar pelo primeiro é determinístico;
  // concatenar inventaria um termo que ninguém digitou.
  if (Array.isArray(raw)) return raw[0] ?? ''
  return ''
}

interface ExploreSearchParams {
  q?: string | string[]
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ExploreSearchParams>
}): Promise<Metadata> {
  const query = readQuery(await searchParams)
  const hasTerm = foldSearchTerm(query) !== ''

  // COM TERMO, `noindex` SEMPRE — e antes de qualquer outra checagem. Página de
  // resultado é infinita (uma URL por termo) e fina por natureza; deixá-la
  // depender do gate de conteúdo abriria o índice para combinações sem fim.
  if (hasTerm) {
    return {
      title: `${query} — ${TITLE}`,
      description: DESCRIPTION,
      robots: { index: false, follow: true },
      // Canonical na rota BASE, sem o termo.
      alternates: { canonical: canonicalPublicUrl(EXPLORE_PATH) },
    }
  }

  const { indexability } = await getExploreData()
  const shouldIndex = indexability.decision === 'index'
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: publicRobots(shouldIndex),
    alternates: { canonical: canonicalPublicUrl(EXPLORE_PATH) },
  }
}

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<ExploreSearchParams>
}) {
  const query = readQuery(await searchParams)
  const hasTerm = foldSearchTerm(query) !== ''
  const search = hasTerm ? await getSearchPageData(query) : null
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
        {/* Busca real, GET nesta MESMA rota — sem termo ela é navegação. */}
        <form action={EXPLORE_PATH} className="disc-search" method="get" role="search">
          <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.6" x2="21" y1="16.6" y2="21" />
          </svg>
          <input
            aria-label="Buscar filmes, séries, pessoas"
            defaultValue={query}
            name="q"
            placeholder="Buscar filmes, séries, pessoas…"
            type="search"
          />
          <span aria-hidden="true" className="disc-search__kbd">
            ENTER
          </span>
        </form>

        {search !== null ? <SearchResults view={search} /> : null}

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
                      {/*
                        Provedores como TEXTO (logo_allowed=false), com a
                        MODALIDADE ao lado do nome. Nomear so a marca num titulo
                        que so tem compra/aluguel afirma ao leitor que ja esta
                        incluso na assinatura dele — e compra+aluguel sao a
                        maioria do corpus. Texto visivel, nunca atributo.
                      */}
                      {featured.watchProviders.map((provider) => (
                        <WatchPlatformLine
                          key={provider.name}
                          modalityLabels={provider.modalityLabels}
                          name={provider.name}
                        />
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
          {/* CONTINUAR ASSISTINDO — fronteira autenticada real. O componente
              carrega a SEÇÃO INTEIRA (título incluído) porque para visitante
              deslogado ela não aparece: seção pessoal que não pode ter sucesso
              não vira caixa vazia. A ausência sai no log do cliente. */}
          <ContinueWatching route={EXPLORE_PATH} />

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
                        {/* Rótulo da vertical do PRÓPRIO item: o trilho é misto
                            e a cor sozinha nunca é sinal (invariante 11). */}
                        <div className="disc-agenda__kicker">{movie.verticalLabel}</div>
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
                            entityType={movie.bookmarkType}
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
                {anticipated.map((card) => (
                  <a
                    className="disc-rank__card"
                    data-entity-type={card.bookmarkType}
                    href={card.href}
                    key={card.href}
                  >
                    <span className="disc-rank__poster">
                      {card.posterUrl !== null ? (
                        <img alt="" loading="lazy" src={card.posterUrl} />
                      ) : null}
                      {/* Quatro tipos entram aqui (filme, série, temporada,
                          episódio) e o rótulo diz QUAL — o mesmo vocabulário da
                          página para onde "Ver todos" aponta. */}
                      <span className="disc-rank__type">{ANTICIPATED_KIND_LABEL[card.kind]}</span>
                    </span>
                    <span className="disc-rank__title">{card.title}</span>
                    <span className="disc-soon__date">
                      {card.unconfirmed ? card.dateLabel : `Estreia · ${card.dateLabel}`}
                    </span>
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
