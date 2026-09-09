import type { Metadata } from 'next'

import { SUSPENSION_REASON } from '../../../../../../src/server/seo/suspended-pages'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd, buildMetaDescription } from '@screena/seo'

import { PrevNextNav } from '../../../../../_components/prev-next-nav'
import { SectionBoundary } from '../../../../../_components/section-boundary'
import { SectionHead } from '../../../../../_components/section-head'
import { TrailerModal } from '../../../../../_components/trailer-modal'
import { decideSection } from '../../../../../../src/lib/section-absence'
import { parseRouteNumber, seasonPath } from '../../../../../../src/lib/routes'
import { SERIES_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../../../src/lib/site'
import { getSeasonPageData } from '../../../../../../src/server/season-page'

/**
 * Pagina publica de temporada (/pt/series/[slug]/temporadas/[season]/).
 *
 * ATE 21/08/2026 esta pagina foi ao ar SEM DESENHO. Nao era folha de estilo
 * faltando: `globals.css` e importado pelo layout raiz (o UNICO layout do app)
 * e chega aqui normalmente — o `.container` do arquivo antigo era prova disso,
 * porque a coluna JA vinha centrada. O que faltava era a pagina usar as classes:
 * ela tinha UMA (`container`) contra 95 da pagina de serie. Sem
 * `.detail-hero__crumbs` a trilha caia no `<ol>` padrao do navegador e saia
 * numerada ("1. Series 2. The Last of Us 3. Temporada 2"), e os episodios
 * saiam com marcador.
 *
 * O vocabulario visual de temporada/episodio JA EXISTIA em `globals.css`
 * (`.episode-row`, `.episode-list`, `.season-info`, `.season-tabs`,
 * `.detail-hero`) — e o mesmo que a pagina de serie usa no guia de temporadas.
 * Esta pagina passa a usa-lo, entao filme, serie e temporada falam a mesma
 * lingua e nao existe um segundo componente de episodio.
 *
 * A ROTA CANONICA e `/pt/series/{slug}/temporadas/{n}/` — e e a unica que
 * existe. `SEASONS_SEGMENT` em `src/lib/routes.ts` alimenta o diretorio, a URL
 * canonica e o sitemap pelo mesmo valor. A linha `temporada-{number}` em
 * `docs/SPEC.md` e documentacao desatualizada, nao uma segunda rota.
 *
 * Invariantes 3/4: zero API externa e zero IA no render — tudo vem do
 * PostgreSQL via `getSeasonPageData`.
 */

/**
 * ESTA ROTA E DINAMICA DE PROPOSITO — nao ponha `generateStaticParams` aqui.
 *
 * Ate esta leva ela declarava `revalidate = 3600` + `generateStaticParams`
 * devolvendo `[]`, e isso ligava o cache de ROTA. Duas coisas o desfizeram:
 *
 * 1. A LISTA DE EPISODIOS PASSOU A SER PAGINADA POR `?pagina=`. Cache de rota
 *    e por PATHNAME: `?pagina=2` e `?pagina=7` compartilhariam o mesmo HTML
 *    guardado. E `generateStaticParams` + `await searchParams` e exatamente o
 *    par que derrubou `/pt/series/{slug}/` com 500 em toda serie em
 *    2026-08-28 (`DYNAMIC_SERVER_USAGE` / "Page changed from static to dynamic
 *    at runtime") — no build o Next rebaixaria a rota, em runtime ele nao pode
 *    mais e lanca. Ver o cabecalho de `app/pt/series/[slug]/page.tsx`.
 *
 * 2. O CACHE NAO ESTAVA COMPRANDO NADA AQUI. Sao 127.870 URLs de temporada e
 *    o rastreador visita cada uma praticamente uma vez: a taxa de acerto e
 *    proxima de zero, o render acontece nos dois cenarios, e o cache so
 *    acrescentava a escrita. A arvore de temporadas sob `.next/server/app`
 *    acumulou 72 GB em 11 dias por isso.
 *
 * O que substituiu o cache foi CONSULTA MENOR: a pagina lia a temporada
 * inteira (milhares de linhas com `overview`) para desenhar uma tela; agora le
 * uma fatia de `EPISODES_PER_PAGE` mais um `COUNT`. E a mesma troca que
 * `/pt/filmes/` ja fez.
 *
 * `force-dynamic` (a mesma declaracao de `/pt/explorar/` e da ficha de serie,
 * pelo mesmo motivo) torna a leitura da query legal e impede qualquer
 * reclassificacao futura.
 */
export const dynamic = 'force-dynamic'

interface SeasonRouteParams {
  slug: string
  season: string
}

interface SeasonRouteSearchParams {
  pagina?: string | string[]
}

/**
 * `?pagina=` -> numero da fatia de episodios.
 *
 * Mesmo formato do `?temporada=` da ficha de serie: SO digitos. Qualquer outra
 * coisa cai para a primeira pagina em vez de 404 — query malformada e ruido de
 * rastreador, nao pedido de erro. Pagina fora da faixa e outra historia e vira
 * 404 em `getSeasonPageData`, para `?pagina=99999` nao responder 200 eterno.
 */
function pageFromQuery(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === undefined || !/^\d+$/.test(candidate)) return 1
  const page = Number(candidate)
  return Number.isSafeInteger(page) && page >= 1 ? page : 1
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<SeasonRouteParams>
  searchParams: Promise<SeasonRouteSearchParams>
}): Promise<Metadata> {
  const [{ slug, season }, query] = await Promise.all([params, searchParams])
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }
  // A MESMA PAGINA que o componente pede, de proposito: `getSeasonPageData` e
  // memoizado por `cache()` do React, que compara os ARGUMENTOS. Pedir a
  // pagina 1 aqui e a pagina N ali faria a mesma requisicao carregar a
  // temporada DUAS vezes, com dois lotes de consultas ao Postgres.
  const page = pageFromQuery(query.pagina)
  const data = await getSeasonPageData(slug, seasonNumber, page)
  if (data === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }

  const { view, seo, canonicalUrl } = data
  const baseTitle = `${view.seriesTitle} — ${view.seasonTitle}`
  // Sem isto, as paginas 1..N teriam titulo identico e o historico do
  // navegador viraria uma pilha de entradas indistinguiveis na volta.
  const title =
    view.pagination.hasPages && view.pagination.page > 1
      ? `${baseTitle} (página ${view.pagination.page} de ${view.pagination.pageCount})`
      : baseTitle
  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
    openGraph: { title, url: canonicalUrl, type: 'website' },
  }
  if (view.overview !== null) {
    metadata.description = buildMetaDescription(view.overview) ?? view.overview
    metadata.openGraph = { ...metadata.openGraph, description: view.overview }
  }
  return metadata
}

export default async function SeasonPage({
  params,
  searchParams,
}: {
  params: Promise<SeasonRouteParams>
  searchParams: Promise<SeasonRouteSearchParams>
}) {
  const [{ slug, season }, query] = await Promise.all([params, searchParams])
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) notFound()

  const page = pageFromQuery(query.pagina)
  const data = await getSeasonPageData(slug, seasonNumber, page)
  if (data === null) notFound()

  if (slug !== data.canonicalSlug) {
    // O redirect preserva a fatia: quem chegou por um slug antigo na pagina 3
    // continua na pagina 3.
    const target = seasonPath(data.canonicalSlug, seasonNumber)
    if (target !== null) permanentRedirect(page > 1 ? `${target}?pagina=${page}` : target)
  }

  const { view, trailer, seo, canonicalUrl, seriesUrl } = data
  // A valvula de 2026-08-27 poe estas paginas em `noindex`, e isso NAO e
  // revisao editorial pendente: a pagina esta pronta, so nao se sustenta no
  // indice. Sem esta distincao o aviso apareceria em 3,9 milhoes de telas.
  const isUnderReview = seo.decision !== 'index' && seo.reason !== SUSPENSION_REASON
  const seriesHref = `${SERIES_INDEX_PATH}${view.seriesSlug}/`
  const headerMeta = [view.dateLabel, view.episodeCountLabel].filter(
    (item): item is string => item !== null,
  )

  /**
   * O TRAILER DA TEMPORADA.
   *
   * `SectionBoundary` e nao um ternario: a regra tem duas metades ("o bloco sai
   * do DOM" e "o motivo vai para o log"), e escritas em lugares diferentes elas
   * divergem no primeiro refactor. `entityType: 'season'` porque o buraco e
   * desta temporada — registrar `tv` mandaria o operador olhar a serie inteira.
   */
  const trailerSection = decideSection(trailer, {
    entityType: 'season',
    entityId: String(view.seasonNumber),
    section: 'trailer-da-temporada',
    reason: 'no_season_trailer',
  })

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: 'Séries', item: `${SITE_URL}${SERIES_INDEX_PATH}` },
      { '@type': 'ListItem', position: 3, name: view.seriesTitle, item: seriesUrl },
      { '@type': 'ListItem', position: 4, name: view.seasonTitle, item: canonicalUrl },
    ],
  }

  const seasonJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVSeason',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: view.seasonTitle,
    seasonNumber: view.seasonNumber,
    mainEntityOfPage: canonicalUrl,
    partOfSeries: { '@type': 'TVSeries', name: view.seriesTitle, url: seriesUrl },
  }
  if (view.overview !== null) seasonJsonLd.description = view.overview
  if (view.episodeCount !== null) seasonJsonLd.numberOfEpisodes = view.episodeCount
  if (view.airYear !== null) seasonJsonLd.datePublished = String(view.airYear)

  return (
    <main data-vertical="series">
      {/* ===== Topo: mesmo vocabulario do hero de filme/serie ===== */}
      <div className="detail-hero">
        <div className="detail-container">
          <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
            <ol>
              <li>
                <a href={SERIES_INDEX_PATH}>Séries</a>
              </li>
              <li>
                <a href={seriesHref}>{view.seriesTitle}</a>
              </li>
              <li aria-current="page">{view.seasonTitle}</li>
            </ol>
          </nav>

          <div className="detail-hero__grid">
            <div className="detail-hero__main">
              <div className="detail-badge-row">
                {/* A vertical se diz por rotulo + badge + breadcrumb + URL +
                    schema (TVSeason), nunca so pela cor (invariante 11). */}
                <span className="detail-badge" data-entity-badge="series">
                  Temporada
                </span>
              </div>
              <h1 className="detail-hero__title">
                {view.seriesTitle} — {view.seasonTitle}
              </h1>
              {headerMeta.length > 0 ? (
                <ul className="detail-hero__chips">
                  <li className="detail-hero__meta-text">{headerMeta.join(' · ')}</li>
                </ul>
              ) : null}
              {view.overview !== null ? (
                <p className="detail-hero__synopsis">{view.overview}</p>
              ) : null}
              {/* Fica DENTRO do hero, que e uma superficie clara fixa: usa a
                  classe do hero (cor presa ao claro), nao `.detail-see-all`,
                  cujo token vira com o tema e sairia claro sobre claro. */}
              <p className="season-page__back">
                <a className="detail-hero__back" href={seriesHref}>
                  ← Voltar para {view.seriesTitle}
                </a>
              </p>
            </div>

            {view.poster !== null ? (
              <aside aria-label="Pôster da temporada" className="detail-hero__aside">
                <img
                  alt=""
                  className="season-poster"
                  height={view.poster.height}
                  src={view.poster.src}
                  width={view.poster.width}
                />
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      <div className="detail-container season-page__body">
        {/* Navegacao entre temporadas. `PrevNextNav` e compartilhado APENAS com
            a pagina de episodio (as duas nesta rodada); o estilo entra por
            `[data-nav='prev-next']`, sem tocar uma linha do componente. */}
        <PrevNextNav
          ariaLabel="Navegação entre temporadas"
          previousItemLabel="Temporada anterior"
          nextItemLabel="Próxima temporada"
          previous={view.prevSeason}
          next={view.nextSeason}
        />

        {/* ===== Trailer da temporada =====
            NADA carrega antes do clique: enquanto o diálogo está fechado não
            existe `<iframe>`, nem `<script>`, nem requisição a domínio do
            YouTube. É o mesmo `TrailerModal` da ficha de filme e de série — não
            há um segundo player, e não pode haver: dois divergiriam no primeiro
            conserto, e o §6 da política de privacidade depende deste. */}
        <SectionBoundary decision={trailerSection}>
          {(video) => (
            <section aria-labelledby="temporada-trailer-titulo" style={{ paddingTop: 40 }}>
              <SectionHead
                headingId="temporada-trailer-titulo"
                kicker="Mídia"
                thin="da temporada"
                title="Trailer"
              />
              {/* Geometria PROPRIA. `.media-strip__cell` tira altura do
                  `.media-strip__grid` da banda de midia do detalhe; fora dele a
                  celula fica com ALTURA ZERO e o play de 64px cai por cima da
                  lista de episodios — foi o que aconteceu na primeira escrita,
                  e so apareceu ao ABRIR a pagina. */}
              <div className="season-trailer" data-trailer="ready">
                {view.backdrop !== null ? (
                  <img
                    alt=""
                    height={view.backdrop.height}
                    loading="lazy"
                    src={view.backdrop.src}
                    width={view.backdrop.width}
                  />
                ) : null}
                <span className="media-strip__playwrap">
                  <TrailerModal
                    title={`${view.seriesTitle} — ${view.seasonTitle}`}
                    trailer={video}
                    triggerClassName="media-strip__play"
                  />
                </span>
                {video.name !== null ? (
                  <span className="media-strip__caption">{video.name}</span>
                ) : null}
              </div>
            </section>
          )}
        </SectionBoundary>

        <section aria-labelledby="temporada-episodios-titulo" className="season-page__episodes">
          <div className="eyebrow-bar">
            <span>Temporada {view.seasonNumber}</span>
          </div>
          <h2 className="detail-section-title" id="temporada-episodios-titulo">
            Episódios
          </h2>
          {view.episodes.length > 0 ? (
            <ol className="episode-list">
              {view.episodes.map((episode) => {
                const meta = [episode.dateLabel, episode.runtimeLabel].filter(
                  (item): item is string => item !== null,
                )
                return (
                  <li key={episode.episodeNumber}>
                    <article className="episode-row">
                      <div className="episode-row__media">
                        <span className="episode-row__num">
                          T{view.seasonNumber} · E{episode.episodeNumber}
                        </span>
                        {episode.still !== null ? (
                          <img
                            alt=""
                            height={episode.still.height}
                            loading="lazy"
                            src={episode.still.src}
                            width={episode.still.width}
                          />
                        ) : null}
                      </div>
                      <div>
                        <h3
                          className="episode-row__title episode-row__title--name"
                        >
                          <a href={episode.href}>
                            {episode.title !== null
                              ? episode.title
                              : `Episódio ${episode.episodeNumber}`}
                          </a>
                        </h3>
                        {episode.summary !== null ? (
                          <p className="episode-row__synopsis">{episode.summary}</p>
                        ) : null}
                        {meta.length > 0 ? (
                          <p className="episode-row__meta">{meta.join(' · ')}</p>
                        ) : null}
                      </div>
                      <span aria-hidden="true" className="episode-row__chevron">
                        <svg fill="none" height="22" viewBox="0 0 24 24" width="22">
                          <path
                            d="m10 6 6 6-6 6"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeWidth="2"
                          />
                        </svg>
                      </span>
                    </article>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="muted">Nenhum episódio publicado nesta temporada.</p>
          )}

          {/* PAGINACAO DE EPISODIOS.
              So aparece quando a temporada nao cabe numa pagina — temporada de
              ficcao (8-24 episodios) continua exatamente como estava, sem
              navegacao nenhuma na tela.
              Sao LINKS de verdade (`?pagina=N`), nao estado de cliente: o botao
              Voltar funciona, a URL e compartilhavel, e quem esta sem
              JavaScript navega igual. Reusa o mesmo `PrevNextNav` das
              temporadas — que ja emite `rel="prev"`/`rel="next"`. */}
          {view.pagination.hasPages ? (
            <>
              <p className="muted" data-episodes-range>
                Episódios {view.pagination.rangeLabel}
              </p>
              <PrevNextNav
                ariaLabel="Navegação entre páginas de episódios"
                previousItemLabel="Página anterior de episódios"
                nextItemLabel="Próxima página de episódios"
                previous={
                  view.pagination.prevHref === null
                    ? null
                    : {
                        href: view.pagination.prevHref,
                        label: `Página ${view.pagination.page - 1}`,
                      }
                }
                next={
                  view.pagination.nextHref === null
                    ? null
                    : {
                        href: view.pagination.nextHref,
                        label: `Página ${view.pagination.page + 1}`,
                      }
                }
              />
            </>
          ) : null}
        </section>

        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
          </p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(seasonJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
