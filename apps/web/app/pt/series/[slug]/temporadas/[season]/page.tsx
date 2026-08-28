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

export const revalidate = 3600

/**
 * `generateStaticParams` VAZIO — e ele que liga o `revalidate` acima.
 *
 * MEDIDO (2026-08-28): esta rota declarava `revalidate = 3600` desde 2026-07 e
 * mesmo assim respondia em producao com
 * `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.
 * A causa nao era leitura de sessao nem `force-dynamic`: era a AUSENCIA desta
 * funcao. Sem `generateStaticParams`, o Next nao considera a rota dinamica
 * elegivel a prerender, ela nao entra em `dynamicRoutes` do
 * `prerender-manifest.json`, `isSSG` fica falso e o render sai com
 * `revalidate = 0` — que e exatamente o `no-store` observado.
 *
 * PROVA POR EXPERIMENTO CONTROLADO (`next build` na mesma arvore): sem esta
 * funcao a tabela do build mostra `f (Dynamic)` e `dynamicRoutes` vem `[]`;
 * com ela (devolvendo `[]`) a mesma rota vira `. (SSG)` e aparece em
 * `dynamicRoutes`. Nenhuma outra linha mudou.
 *
 * Devolve `[]` DE PROPOSITO: nao ha nada para prerenderizar no build (sao ~67
 * mil URLs e o banco nao esta disponivel la). Cada URL e gerada na primeira
 * visita e entao guardada pela janela do `revalidate` — que e o comportamento
 * que a rota sempre quis ter.
 */
export async function generateStaticParams(): Promise<Record<string, string>[]> {
  return []
}

interface SeasonRouteParams {
  slug: string
  season: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SeasonRouteParams>
}): Promise<Metadata> {
  const { slug, season } = await params
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }
  const data = await getSeasonPageData(slug, seasonNumber)
  if (data === null) {
    return { title: 'Temporada não encontrada', robots: { index: false, follow: false } }
  }

  const { view, seo, canonicalUrl } = data
  const title = `${view.seriesTitle} — ${view.seasonTitle}`
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

export default async function SeasonPage({ params }: { params: Promise<SeasonRouteParams> }) {
  const { slug, season } = await params
  const seasonNumber = parseRouteNumber(season)
  if (seasonNumber === null) notFound()

  const data = await getSeasonPageData(slug, seasonNumber)
  if (data === null) notFound()

  if (slug !== data.canonicalSlug) {
    const target = seasonPath(data.canonicalSlug, seasonNumber)
    if (target !== null) permanentRedirect(target)
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
