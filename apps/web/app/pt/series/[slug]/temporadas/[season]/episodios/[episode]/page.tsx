import type { Metadata } from 'next'

import { SUSPENSION_REASON } from '../../../../../../../../src/server/seo/suspended-pages'
import { notFound, permanentRedirect } from 'next/navigation'

import { serializeJsonLd, buildMetaDescription } from '@screena/seo'

import { CastStrip } from '../../../../../../../_components/cast-strip'
import { GalleryImageGrid } from '../../../../../../../_components/gallery-grids'
import { PrevNextNav } from '../../../../../../../_components/prev-next-nav'
import { SectionBoundary } from '../../../../../../../_components/section-boundary'
import { SectionHead } from '../../../../../../../_components/section-head'
import { decideSection } from '../../../../../../../../src/lib/section-absence'
import {
  episodeImagesGalleryPath,
  episodePath,
  parseRouteNumber,
} from '../../../../../../../../src/lib/routes'
import { SERIES_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../../../../../src/lib/site'
import { getEpisodePageData } from '../../../../../../../../src/server/episode-page'

/**
 * Pagina publica de episodio
 * (/pt/series/[slug]/temporadas/[season]/episodios/[episode]/).
 *
 * ============================================================================
 * O QUE ESTA PAGINA MOSTRAVA ATE 2026-08-27, E POR QUE
 * ============================================================================
 * Titulo, data, duracao e um paragrafo. Mais nada. A mesma pagina no TMDB
 * mostrava 31 artistas convidados, 13 pessoas na equipe (com Direcao e Roteiro
 * nomeados) e 15 imagens com galeria propria.
 *
 * A causa NAO era licenca nem desenho: era coleta. `syncEpisodes` passava aos
 * normalizadores o item de `episodes[]` da temporada, que nao tem bloco
 * `credits`, nem `external_ids`, nem `images` — e os extratores devolviam listas
 * vazias em toda execucao, contadas como sucesso. `cast_members` e
 * `crew_members` aceitam `entity_type='episode'` desde a Fase 1 e nunca
 * receberam uma linha.
 *
 * Agora o `sync_episodes` busca o DETALHE de cada episodio (`getTvEpisode`) e
 * esta pagina le o que ele grava.
 *
 * Invariantes 3 e 4: le SOMENTE PostgreSQL local; zero API externa, zero IA no
 * render. Nada de terceiro carrega antes de um clique.
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

/**
 * Quantas imagens aparecem na FICHA antes do "ver todas".
 *
 * Seis: duas linhas de tres na grade de episodio. O suficiente para a faixa
 * ter forma propria sem empurrar a navegacao entre episodios para fora da
 * tela — a galeria completa e uma pagina, esta faixa e um bloco.
 */
const IMAGENS_NA_FICHA = 6

interface EpisodeRouteParams {
  slug: string
  season: string
  episode: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<EpisodeRouteParams>
}): Promise<Metadata> {
  const { slug, season, episode } = await params
  const seasonNumber = parseRouteNumber(season)
  const episodeNumber = parseRouteNumber(episode)
  if (seasonNumber === null || episodeNumber === null) {
    return { title: 'Episódio não encontrado', robots: { index: false, follow: false } }
  }
  const data = await getEpisodePageData(slug, seasonNumber, episodeNumber)
  if (data === null) {
    return { title: 'Episódio não encontrado', robots: { index: false, follow: false } }
  }

  const { view, seo, canonicalUrl } = data
  const title = `${view.episodeTitle} — ${view.seriesTitle}, T${view.seasonNumber} E${view.episodeNumber}`
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

export default async function EpisodePage({ params }: { params: Promise<EpisodeRouteParams> }) {
  const { slug, season, episode } = await params
  const seasonNumber = parseRouteNumber(season)
  const episodeNumber = parseRouteNumber(episode)
  if (seasonNumber === null || episodeNumber === null) notFound()

  const data = await getEpisodePageData(slug, seasonNumber, episodeNumber)
  if (data === null) notFound()

  if (slug !== data.canonicalSlug) {
    const target = episodePath(data.canonicalSlug, seasonNumber, episodeNumber)
    if (target !== null) permanentRedirect(target)
  }

  const { view, credits, images, seo, canonicalUrl, seasonUrl, seriesUrl } = data
  // A valvula de 2026-08-27 poe estas paginas em `noindex`, e isso NAO e
  // revisao editorial pendente: a pagina esta pronta, so nao se sustenta no
  // indice. Sem esta distincao o aviso apareceria em 3,9 milhoes de telas.
  const isUnderReview = seo.decision !== 'index' && seo.reason !== SUSPENSION_REASON
  const seriesHref = `${SERIES_INDEX_PATH}${view.seriesSlug}/`
  const headerMeta = [view.dateLabel, view.runtimeLabel].filter(
    (item): item is string => item !== null,
  )

  /**
   * As quatro decisoes de bloco.
   *
   * `SectionBoundary` existe porque a regra tem DUAS metades ("a secao sai do
   * DOM" e "o motivo vai para o log"), e um ternario so cumpre a primeira. O
   * `entityType` e `episode`: mandar `tv` mandaria o operador olhar a serie
   * inteira quando o buraco e de UM episodio.
   */
  const escopo = { entityType: 'episode' as const, entityId: String(view.episodeNumber) }
  const guestSection = decideSection(credits.guestStars, {
    ...escopo,
    section: 'elenco-convidado',
    reason: 'no_episode_credits',
  })
  const regularSection = decideSection(credits.regularCast, {
    ...escopo,
    section: 'elenco',
    reason: 'no_episode_credits',
  })
  const crewSection = decideSection(credits.crew, {
    ...escopo,
    section: 'equipe-tecnica',
    reason: 'no_episode_credits',
  })
  const imagesSection = decideSection(images.images.slice(0, IMAGENS_NA_FICHA), {
    ...escopo,
    section: 'imagens-do-episodio',
    reason: 'no_episode_images',
  })
  const galeriaHref = episodeImagesGalleryPath(
    view.seriesSlug,
    view.seasonNumber,
    view.episodeNumber,
  )

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      { '@type': 'ListItem', position: 2, name: 'Séries', item: `${SITE_URL}${SERIES_INDEX_PATH}` },
      { '@type': 'ListItem', position: 3, name: view.seriesTitle, item: seriesUrl },
      { '@type': 'ListItem', position: 4, name: view.seasonTitle, item: seasonUrl },
      { '@type': 'ListItem', position: 5, name: view.episodeTitle, item: canonicalUrl },
    ],
  }

  const episodeJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    '@id': canonicalUrl,
    url: canonicalUrl,
    name: view.episodeTitle,
    episodeNumber: view.episodeNumber,
    mainEntityOfPage: canonicalUrl,
    partOfSeason: {
      '@type': 'TVSeason',
      seasonNumber: view.seasonNumber,
      url: seasonUrl,
    },
    partOfSeries: { '@type': 'TVSeries', name: view.seriesTitle, url: seriesUrl },
  }
  if (view.overview !== null) episodeJsonLd.description = view.overview
  if (view.airYear !== null) episodeJsonLd.datePublished = String(view.airYear)
  if (view.still !== null) episodeJsonLd.image = view.still.src

  /**
   * `director` e `actor` no schema saem dos MESMOS dados da tela.
   *
   * So entram quando ha crédito de verdade: um `TVEpisode` com `director: []`
   * afirmaria ao buscador que o episodio nao tem diretor, o que e diferente de
   * nao afirmar nada. Nunca inventa `Person` sem nome vindo do banco.
   */
  const diretores = credits.crew.find((group) => group.job === 'Director')?.people ?? []
  if (diretores.length > 0) {
    episodeJsonLd.director = diretores.map((pessoa) => ({ '@type': 'Person', name: pessoa.name }))
  }
  const roteiristas = credits.crew
    .filter((group) => group.job === 'Writer' || group.job === 'Screenplay')
    .flatMap((group) => group.people)
  if (roteiristas.length > 0) {
    episodeJsonLd.author = roteiristas.map((pessoa) => ({ '@type': 'Person', name: pessoa.name }))
  }
  if (credits.guestStars.length > 0) {
    episodeJsonLd.actor = credits.guestStars.map((membro) => ({
      '@type': 'Person',
      name: membro.name,
    }))
  }

  return (
    <main data-vertical="series">
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
              <li>
                {view.seasonHref !== null ? (
                  <a href={view.seasonHref}>{view.seasonTitle}</a>
                ) : (
                  <span>{view.seasonTitle}</span>
                )}
              </li>
              <li aria-current="page">{view.episodeTitle}</li>
            </ol>
          </nav>

          <div className="detail-hero__grid">
            <div className="detail-hero__main">
              <div className="detail-badge-row">
                {/* Os cinco sinais da invariante 11: label + badge + breadcrumb
                    + schema (TVEpisode) + URL. A cor e o apoio, nunca o sinal. */}
                <span className="detail-badge" data-entity-badge="series">
                  Episódio
                </span>
              </div>
              <h1 className="detail-hero__title">{view.episodeTitle}</h1>
              <p className="detail-hero__meta-text">
                {view.seriesTitle} · T{view.seasonNumber} E{view.episodeNumber}
              </p>
              {headerMeta.length > 0 ? (
                <ul className="detail-hero__chips">
                  <li className="detail-hero__meta-text">{headerMeta.join(' · ')}</li>
                </ul>
              ) : null}
              {view.overview !== null ? (
                <p className="detail-hero__synopsis">{view.overview}</p>
              ) : null}
              <p className="season-page__back">
                <a
                  className="detail-hero__back"
                  href={view.seasonHref ?? seriesHref}
                >
                  ← Voltar para {view.seasonTitle}
                </a>
              </p>
            </div>

            {view.still !== null ? (
              // O still do episodio (`episodes.still_path`), que a view sempre
              // resolveu e a pagina nunca desenhou.
              <aside aria-label={`Cena de ${view.episodeTitle}`} className="detail-hero__aside">
                <img
                  alt=""
                  className="episode-still"
                  height={view.still.height}
                  src={view.still.src}
                  width={view.still.width}
                />
              </aside>
            ) : null}
          </div>
        </div>
      </div>

      <div className="detail-container season-page__body">
        <PrevNextNav
          ariaLabel="Navegação entre episódios"
          previousItemLabel="Episódio anterior"
          nextItemLabel="Próximo episódio"
          previous={view.prevEpisode}
          next={view.nextEpisode}
        />

        {/* ===== Equipe técnica: direção e roteiro ===== */}
        <SectionBoundary decision={crewSection}>
          {(groups) => (
            <section aria-labelledby="episodio-equipe-titulo" style={{ paddingTop: 48 }}>
              <SectionHead
                headingId="episodio-equipe-titulo"
                kicker="Ficha"
                thin="técnica"
                title="Equipe"
              />
              <dl className="episode-crew">
                {groups.map((group) => (
                  <div className="episode-crew__row" data-crew-job={group.job} key={group.job}>
                    <dt className="episode-crew__label">{group.label}</dt>
                    <dd className="episode-crew__people">
                      {group.people.map((pessoa, index) => (
                        <span key={`${pessoa.name}-${String(index)}`}>
                          {index > 0 ? ', ' : ''}
                          {pessoa.href !== null ? (
                            <a href={pessoa.href}>{pessoa.name}</a>
                          ) : (
                            pessoa.name
                          )}
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </SectionBoundary>

        {/* ===== Elenco convidado ===== */}
        <SectionBoundary decision={guestSection}>
          {(members) => (
            <section aria-labelledby="episodio-convidados-titulo" style={{ paddingTop: 48 }}>
              <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
                <SectionHead
                  headingId="episodio-convidados-titulo"
                  kicker="Elenco"
                  thin="convidado"
                  title="Elenco"
                />
                {/* A contagem REAL, nunca a exibida: mostrar 18 e dizer 18
                    esconderia 13 pessoas sem avisar que escondeu. */}
                {credits.guestStarsTotal > members.length ? (
                  <p className="detail-hero__meta-text">
                    {members.length} de {credits.guestStarsTotal}
                  </p>
                ) : null}
              </div>
              <CastStrip members={members} />
            </section>
          )}
        </SectionBoundary>

        {/* ===== Elenco regular creditado neste episódio ===== */}
        <SectionBoundary decision={regularSection}>
          {(members) => (
            <section aria-labelledby="episodio-elenco-titulo" style={{ paddingTop: 48 }}>
              <SectionHead
                headingId="episodio-elenco-titulo"
                kicker="Elenco"
                thin="regular"
                title="Elenco"
              />
              <CastStrip members={members} />
            </section>
          )}
        </SectionBoundary>

        {/* ===== Imagens do episódio ===== */}
        <SectionBoundary decision={imagesSection}>
          {(destaques) => (
            <section aria-labelledby="episodio-imagens-titulo" style={{ paddingTop: 48 }}>
              <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
                <SectionHead
                  headingId="episodio-imagens-titulo"
                  kicker="Mídia"
                  thin="do episódio"
                  title="Imagens"
                />
                {galeriaHref !== null && images.total > destaques.length ? (
                  <a className="detail-see-all" href={galeriaHref}>
                    Ver as {images.total} imagens →
                  </a>
                ) : null}
              </div>
              <GalleryImageGrid images={destaques} />
            </section>
          )}
        </SectionBoundary>

        <nav aria-label="Voltar" style={{ paddingTop: 48 }}>
          <ul>
            {view.seasonHref !== null ? (
              <li>
                <a href={view.seasonHref}>Ver {view.seasonTitle}</a>
              </li>
            ) : null}
            <li>
              <a href={seriesHref}>Ver {view.seriesTitle}</a>
            </li>
          </ul>
        </nav>

        {isUnderReview ? (
          <p data-editorial-state="in-review">Esta página ainda está em revisão editorial.</p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(episodeJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
