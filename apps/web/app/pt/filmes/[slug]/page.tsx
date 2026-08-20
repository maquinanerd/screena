import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntitySynopsis } from '../../../_components/entity-synopsis'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { AwardsBand } from '../../../_components/awards-band'
import { SectionBoundary } from '../../../_components/section-boundary'
import { SimilarTitles } from '../../../_components/similar-titles'
import { TrailerModal } from '../../../_components/trailer-modal'
import { WatchAvailabilityPanel } from '../../../_components/watch-availability-panel'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { decideSection } from '../../../../src/lib/section-absence'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getMoviePageData } from '../../../../src/server/movie-page'

/**
 * Detalhe de filme — tela 06 do canônico, na ESTRUTURA EXATA do HTML:
 * hero editorial CLARO (#FDFCFA, container 1360/64: breadcrumb → badge FILME
 * quadrado → H1 38/800 → chips de meta → sinopse → ações | coluna direita com
 * Avaliações + Onde assistir) → faixa de mídia full-bleed (grid 1fr/3fr/2fr,
 * 472px) → A obra (eyebrow com barra vermelha, lead 22 + corpo 16/1.75) →
 * Guia Cinerie · crítica (full-bleed com overlay vermelho) → Elenco (faixa 6
 * col, retratos 3/4) → Notícias e bastidores (1.4fr/1fr/1fr) → Ficha técnica
 * (320px).
 *
 * BLOCOS DO CANÔNICO QUE NÃO RENDERIZAM, E POR QUÊ (detalhe em docs/frontend/DESIGN-DELTA-detalhe.md):
 *  - "Original Screen" (rótulo ao lado do selo): resíduo do rebrand E afirmação
 *    FALSA — "original" significa produção própria, e a Cinerie não produz
 *    filme. Não é portado. Travado por `original-screen-absent.test.tsx`.
 *  - Cinerie Score (o "82"): não existe fórmula aprovada
 *    (`PRODUCTION_FORMULA_REGISTRY` vazio) nem decisão `cinerie_score_display`
 *    com `derivative_allowed`. O bloco não renderiza — nunca um número
 *    inventado nem "ainda não calculado" ocupando a hierarquia do desenho.
 *  - Faixa de prêmios: LIGADA e licenciada. O dado vem de `entity_awards`
 *    (promovido do campo `Awards` da OMDb que estava em `api_cache`) e o
 *    crédito é da OMDb — prêmio é FATO público, não opinião, então quem recebe
 *    o crédito é quem entregou o dado, com o verbo do transporte ("Dados de
 *    premiação fornecidos por"). Decisão de 2026-08-13 em
 *    `docs/legal/omdb-awards-source-provenance.md`. A faixa só aparece em
 *    títulos cuja linha passou pelo gate; sem ela, o motivo vai para o log.
 *  - Chips de gênero: `movies` não tem relação com `genres` (a tabela é a lista
 *    canônica por media_type, sem junção com o título).
 *  - "Mais como este": sem dataset de recomendação determinístico.
 *  - Logos de fontes/provedores: `logo_allowed = false` em toda licença.
 *
 * Toda ausência acima passa por `SectionBoundary`, que registra o motivo em log
 * estruturado. Bloco que some sem dizer por quê é defeito, não economia.
 */

export const revalidate = 3600

const REVIEW_BLOCK_TYPE = 'review_summary'
const WORK_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'editorial_intro',
  'summary_without_spoilers',
  'franchise_context',
])

interface MoviePageParams {
  slug: string
}

interface MovieFact {
  label: string
  value: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<MoviePageParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getMoviePageData(slug)

  if (data === null) {
    return {
      title: 'Filme não encontrado',
      robots: { index: false, follow: false },
    }
  }

  const { view, seo, canonicalUrl } = data
  const title =
    view.metaTitle ?? `${view.title}${view.year !== null ? ` (${view.year})` : ''} — Filme`

  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
  }
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription
  }
  return metadata
}

export default async function MoviePage({ params }: { params: Promise<MoviePageParams> }) {
  const { slug } = await params
  const data = await getMoviePageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(MOVIES_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, entityId, seo, canonicalUrl, relatedNews, cast, watch, watchAbsence, awards, awardsAbsence, ratings, externalIds, similar, trailer } =
    data
  const isUnderReview = seo.decision !== 'index'
  const externalLinks = buildExternalLinks(externalIds, 'movie')
  const metaText = [view.year !== null ? String(view.year) : null, view.runtimeLabel]
    .filter((item): item is string => item !== null)
    .join(' · ')
  const facts = [
    view.year === null ? null : { label: 'Ano', value: String(view.year) },
    view.runtimeLabel === null ? null : { label: 'Duração', value: view.runtimeLabel },
    view.statusLabel === null ? null : { label: 'Situação', value: view.statusLabel },
    view.originalLanguageLabel === null
      ? null
      : { label: 'Idioma original', value: view.originalLanguageLabel },
    view.certification === null
      ? null
      : { label: 'Classificação', value: view.certification },
  ].filter((fact): fact is MovieFact => fact !== null)

  const critiqueBlock = view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null
  const workBlocks = view.blocks.filter((block) => WORK_BLOCK_TYPES.has(block.blockType))
  const watchContext =
    view.blocks.find((block) => block.blockType === 'where_to_watch_text') ?? null
  const castContext = view.blocks.find((block) => block.blockType === 'cast_intro') ?? null
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const primaryCast = cast.slice(0, 6)
  const editorialNews = relatedNews.slice(0, 3)
  const synopsisLead = workBlocks[0] ?? null
  const synopsisRest = workBlocks.slice(1)

  // Blocos dirigidos por dado. Cada decisão carrega o motivo da ausência — não
  // existe "sumiu e não há o que registrar" (ver `section-absence.ts`).
  const entityRef = { entityType: 'movie', entityId: String(entityId) } as const
  const ratingsSection = decideSection(ratings, {
    ...entityRef,
    section: 'avaliacoes',
    reason: 'no_authorized_rating',
  })
  const watchSection = decideSection(watch, {
    ...entityRef,
    section: 'onde-assistir',
    // DERIVADO do estado do catálogo, nunca escrito à mão aqui (ver
    // `watchAbsenceReason`): "ninguém está autorizado ainda" é um passo de
    // operação pendente; "este título não está em lugar nenhum" é um fato sobre
    // a obra. Os dois se parecem exatamente iguais na tela, e só o log separa.
    // O `??` nunca é usado: `watchAbsence` só é null quando há painel, e aí
    // `decideSection` não lê o motivo.
    reason: watchAbsence ?? 'no_authorized_provider',
  })
  const awardsSection = decideSection(awards, {
    ...entityRef,
    section: 'premios',
    // DERIVADO do estado do catalogo, nunca escrito a mao aqui: "nao ha faixa
    // exibivel em titulo nenhum" e passo pendente (licenca nao aplicada no
    // banco, promocao nao reexecutada); "este titulo nao ganhou nada" e fato
    // sobre a obra. Os dois sao identicos na tela, e so o log separa.
    // O `??` nunca e usado: `awardsAbsence` so e null quando ha faixa.
    reason: awardsAbsence ?? 'no_awards_source',
  })
  const critiqueSection = decideSection(critiqueBlock, {
    ...entityRef,
    section: 'guia-critica',
    reason: 'no_editorial_review',
  })
  const castSection = decideSection(primaryCast, {
    ...entityRef,
    section: 'elenco',
    reason: 'no_cast',
  })
  const newsSection = decideSection(editorialNews, {
    ...entityRef,
    section: 'noticias',
    reason: 'no_linked_article',
  })
  // "Mais como este": a segunda coluna da faixa final. Ate aqui ela era um
  // `<div />` VAZIO — metade da faixa reservada para nada em todo titulo. Agora
  // ou tem trilho, ou a grade vira de uma coluna e a ausência vai para o log.
  const similarSection = decideSection(similar, {
    ...entityRef,
    section: 'mais-como-este',
    // Por ENTIDADE: o dataset existe para filme (colecoes do TMDB) — este
    // titulo e que nao esta em colecao nenhuma. Fato sobre a obra.
    reason: 'no_recommendation_for_entity',
  })

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Filmes',
        item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.title, item: canonicalUrl },
    ],
  }

  const movieJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    '@id': canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  }
  if (view.year !== null) movieJsonLd.datePublished = String(view.year)
  if (view.metaDescription !== null) {
    movieJsonLd.description = view.metaDescription
  }
  const sameAs = buildSameAs(externalIds, 'movie')
  if (sameAs.length > 0) movieJsonLd.sameAs = sameAs

  return (
    <main data-vertical="movie">
      {/* ===== HERO editorial claro (canônico: vermelho = filme) ===== */}
      <div className="detail-hero">
        <div className="detail-container">
          <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
            <ol>
              <li>
                <a href="/pt/">Início</a>
              </li>
              <li>
                <a href={MOVIES_INDEX_PATH}>Filmes</a>
              </li>
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>

          <div className="detail-hero__grid">
            <div className="detail-hero__main">
              <div className="detail-badge-row">
                <span className="detail-badge" data-entity-badge="movie">
                  Filme
                </span>
              </div>
              <h1 className="detail-hero__title">{view.title}</h1>
              <ul className="detail-hero__chips">
                {metaText !== '' ? (
                  <li className="detail-hero__meta-text">{metaText}</li>
                ) : null}
                {view.certification !== null ? (
                  <li className="detail-hero__cert">{view.certification}</li>
                ) : null}
              </ul>
              <EntitySynopsis synopsis={view.synopsis} />
              <div className="detail-actions">
                {/* Ações REAIS de biblioteca (C8): fetch após clique, zero
                    chamada externa no render. */}
                <EntityActions entityType="movie" entityId={entityId} />
              </div>
              {externalLinks.length > 0 ? (
                <div className="entity-links" style={{ marginTop: 20 }}>
                  <EntityExternalIds links={externalLinks} />
                </div>
              ) : null}
            </div>

            <aside aria-label="Notas e disponibilidade" className="detail-hero__aside">
              {/* O canônico abre esta coluna com o Cinerie Score em 47/800 — o
                  maior peso tipográfico da página. Não há fórmula aprovada,
                  então o bloco não existe aqui e a coluna começa direto em
                  "Avaliações". Ver o cabeçalho do arquivo. */}
              <SectionBoundary decision={ratingsSection}>
                {(view) => (
                  <div className="detail-aside-block detail-aside-block--first">
                    <p className="detail-aside-block__label">Avaliações</p>
                    {/* Notas de terceiros na medida da própria fonte, com o
                        crédito DENTRO de cada chip (condição de licença). */}
                    <RatingsPanel view={view} />
                  </div>
                )}
              </SectionBoundary>
              <SectionBoundary decision={watchSection}>
                {(view) => (
                  <div className="detail-aside-block">
                    <p className="detail-aside-block__label">Onde assistir</p>
                    <WatchAvailabilityPanel view={view} />
                    {watchContext !== null ? (
                      <p className="watch-panel__note" data-block-type={watchContext.blockType}>
                        {watchContext.content}
                      </p>
                    ) : null}
                  </div>
                )}
              </SectionBoundary>
            </aside>
          </div>
        </div>
      </div>

      {/* ===== Faixa de premios (fato da obra, com o credito colado nele) ===== */}
      <SectionBoundary decision={awardsSection}>
        {(panel) => (
          <AwardsBand credit={panel.credit} vertical="movie" view={panel.view} />
        )}
      </SectionBoundary>

      {/* ===== Mídia full-bleed (1fr/3fr/2fr, 472px) — só imagens REAIS ===== */}
      {view.media.poster !== null || view.media.backdrop !== null ? (
        <div className="media-strip">
          <div className="media-strip__grid">
            <div className="media-strip__cell">
              {view.media.poster !== null ? (
                <img
                  alt={`Pôster de ${view.title}`}
                  fetchPriority="high"
                  height={view.media.poster.height}
                  src={view.media.poster.src}
                  width={view.media.poster.width}
                />
              ) : null}
            </div>
            {/*
              O SLOT DO TRAILER. Até 20/08/2026 esta célula mostrava o backdrop
              e nada mais — o bloco do canônico é pôster · TRAILER · 3 atalhos,
              e o trailer nunca chegou aqui.

              Não era permissão faltando: a licença de vídeo do TMDB existe
              desde 13/08/2026. Era fiação — nada consultava `tmdb_videos` para
              a entidade da página.

              O backdrop CONTINUA, como pôster do player: é a imagem sobre a
              qual o play aparece. Sem trailer, a célula fica exatamente como
              estava — sem botão, sem espaço reservado, sem promessa.

              NADA CARREGA ANTES DO CLIQUE. O `<iframe>` do YouTube só existe
              dentro do diálogo, que só é montado quando `open` vira true. O
              botão é um `<button>`, não um player escondido.
            */}
            <div className="media-strip__cell" data-trailer={trailer !== null ? 'ready' : undefined}>
              {view.media.backdrop !== null ? (
                <img
                  alt=""
                  height={view.media.backdrop.height}
                  loading="lazy"
                  src={view.media.backdrop.src}
                  width={view.media.backdrop.width}
                />
              ) : null}
              {trailer !== null ? (
                <span className="media-strip__playwrap">
                  <TrailerModal
                    title={view.title}
                    trailer={trailer}
                    triggerClassName="media-strip__play"
                  />
                </span>
              ) : null}
              <span className="media-strip__caption">
                {trailer !== null ? 'Trailer' : 'Mídia do título'}
              </span>
            </div>
            <div className="media-strip__stack">
              <a className="media-strip__cell" href={NEWS_INDEX_PATH}>
                {view.media.backdrop !== null ? (
                  <img alt="" loading="lazy" src={view.media.backdrop.src} />
                ) : null}
                <span className="media-strip__caption">Notícias e Eventos</span>
              </a>
              <a className="media-strip__cell" href="/pt/onde-assistir/">
                {view.media.poster !== null ? (
                  <img alt="" loading="lazy" src={view.media.poster.src} />
                ) : null}
                <span className="media-strip__caption">Onde assistir</span>
              </a>
              <a className="media-strip__cell" href="/pt/em-breve/">
                {view.media.backdrop !== null ? (
                  <img alt="" loading="lazy" src={view.media.backdrop.src} />
                ) : null}
                <span className="media-strip__caption">Em breve</span>
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== A obra ===== */}
      {(synopsisLead !== null || synopsisRest.length > 0) ? (
        <section aria-labelledby="movie-work-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="eyebrow-bar">
            <span id="movie-work-title">A obra</span>
          </div>
          {synopsisLead !== null ? (
            <p className="synopsis-lead" data-block-type={synopsisLead.blockType}>
              {synopsisLead.content}
            </p>
          ) : null}
          {synopsisRest.map((block) => (
            <p className="synopsis-body" data-block-type={block.blockType} key={block.blockType}>
              {block.content}
            </p>
          ))}
        </section>
      ) : null}

      {/* ===== Guia Cinerie · crítica (full-bleed, overlay vermelho) =====
          A fonte É real e já está ligada: um `content_block` de tipo
          `review_summary` com `review_status` publicável. O que não existe é
          conteúdo — ninguém escreveu nenhum ainda. Sem bloco, sem faixa (e sem
          a imagem editorial que ela pediria). A nota em estrela e a assinatura
          nominal do canônico NÃO têm contrato: `content_blocks` guarda texto,
          não veredito numérico nem autoria. Ver docs/frontend/DESIGN-DELTA-detalhe.md. */}
      <SectionBoundary decision={critiqueSection}>
        {(block) => (
          <section aria-label="Crítica da redação" className="critic-band">
            {view.media.backdrop !== null ? (
              <img alt="" className="critic-band__img" loading="lazy" src={view.media.backdrop.src} />
            ) : null}
            <div className="critic-band__scrim-h" />
            <div className="critic-band__scrim-v" />
            <div className="critic-band__inner">
              <div className="critic-band__content">
                <span className="critic-band__eyebrow">Guia Cinerie · Crítica da redação</span>
                <p className="critic-band__quote" data-block-type={block.blockType}>
                  {block.content}
                </p>
                <p className="critic-band__byline">Redação Cinerie</p>
              </div>
            </div>
          </section>
        )}
      </SectionBoundary>

      {/* ===== Elenco · faixa visual ===== */}
      <SectionBoundary decision={castSection}>
        {(members) => (
        <section aria-labelledby="movie-cast-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
            <div>
              <div className="eyebrow-bar">
                <span>Elenco</span>
              </div>
              <h2 className="detail-section-title" id="movie-cast-title">
                Elenco <span className="thin">principal</span>
              </h2>
            </div>
            <a className="detail-see-all" href="/pt/pessoas/">
              Ver pessoas →
            </a>
          </div>
          {castContext !== null ? (
            <p data-block-type={castContext.blockType}>{castContext.content}</p>
          ) : null}
          <ul className="cast-strip">
            {members.map((member, index) => (
              <li key={`${member.name}-${index}`}>
                {member.href !== null ? (
                  <a className="cast-tile" href={member.href}>
                    <span className="cast-tile__photo">
                      {member.profile !== null ? (
                        <img alt="" loading="lazy" src={member.profile.src} />
                      ) : (
                        <span aria-hidden="true">
                          {member.name
                            .split(' ')
                            .slice(0, 2)
                            .map((part) => part.slice(0, 1))
                            .join('')}
                        </span>
                      )}
                    </span>
                    <p className="cast-tile__name">{member.name}</p>
                    {member.character !== null ? (
                      <p className="cast-tile__role">{member.character}</p>
                    ) : null}
                  </a>
                ) : (
                  <div className="cast-tile">
                    <span className="cast-tile__photo">
                      {member.profile !== null ? (
                        <img alt="" loading="lazy" src={member.profile.src} />
                      ) : (
                        <span aria-hidden="true">
                          {member.name
                            .split(' ')
                            .slice(0, 2)
                            .map((part) => part.slice(0, 1))
                            .join('')}
                        </span>
                      )}
                    </span>
                    <p className="cast-tile__name">{member.name}</p>
                    {member.character !== null ? (
                      <p className="cast-tile__role">{member.character}</p>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
        )}
      </SectionBoundary>

      {/* ===== Notícias e bastidores ===== */}
      <SectionBoundary decision={newsSection}>
        {(articles) => (
        <section aria-labelledby="movie-news-title" className="detail-container" style={{ paddingTop: 64 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
            <div>
              <div className="eyebrow-bar">
                <span>Editorial</span>
              </div>
              <h2 className="detail-section-title" id="movie-news-title">
                Notícias <span className="thin">e bastidores</span>
              </h2>
            </div>
            <a className="see-all" href={NEWS_INDEX_PATH}>
              Ver tudo
            </a>
          </div>
          {newsContext !== null ? (
            <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
          ) : null}
          <ul className="mnews-grid">
            {articles.map((article) => (
              <li key={article.href}>
                <a className="mnews-card" href={article.href}>
                  <span className="mnews-card__cover">
                    {article.image !== null ? (
                      <img alt="" loading="lazy" src={article.image.src} />
                    ) : null}
                  </span>
                  {article.category !== null ? (
                    <span className="mnews-card__cat">{article.category}</span>
                  ) : null}
                  <span className="mnews-card__title">{article.title}</span>
                  <span className="mnews-card__meta">
                    {[article.author, article.readTimeLabel]
                      .filter((item): item is string => item !== null)
                      .join(' · ')}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
        )}
      </SectionBoundary>

      {/* ===== Ficha técnica + Mais como este ===== */}
      {facts.length > 0 || similarSection.rendered ? (
        <section aria-labelledby="movie-facts-title" className="detail-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
          <div className={similarSection.rendered ? 'ficha-grid' : 'ficha-grid ficha-grid--solo'}>
            <div>
              <div className="eyebrow-bar">
                <span id="movie-facts-title">Ficha técnica</span>
              </div>
              <dl className="ficha-rows">
                {facts.map((fact) => (
                  <div className="ficha-row" key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <SectionBoundary decision={similarSection}>
              {(similarView) => (
                <SimilarTitles headingId="movie-similar-title" view={similarView} />
              )}
            </SectionBoundary>
          </div>
        </section>
      ) : null}

      <div className="detail-container">
        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
          </p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(movieJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
