import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd } from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntitySynopsis } from '../../../_components/entity-synopsis'
import { AwardsBand } from '../../../_components/awards-band'
import { CinerieScoreCard } from '../../../_components/cinerie-score-card'
import { SectionBoundary } from '../../../_components/section-boundary'
import { SectionHead } from '../../../_components/section-head'
import { SimilarTitles } from '../../../_components/similar-titles'
import { TrailerModal } from '../../../_components/trailer-modal'
import { WatchBrandsRow } from '../../../_components/watch-brands-row'
import { RatingsPanel } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import {
  decideCinerieScore,
  type CinerieScoreView,
} from '../../../../src/lib/cinerie-score-presenter'
import {
  HERO_SYNOPSIS_MAX_CHARS,
  breadcrumbGenre,
  heroGenreChips,
} from '../../../../src/lib/detail-hero'
import {
  buildSectionAbsence,
  decideSection,
  type SectionDecision,
} from '../../../../src/lib/section-absence'
import { watchBrandsRow } from '../../../../src/lib/watch-brands-row'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getMoviePageData } from '../../../../src/server/movie-page'
import { buildMediaBand } from '../../../../src/lib/media-band-presenter'
import { imagesGalleryPath, videosGalleryPath } from '../../../../src/lib/routes'

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
 * O TOPO É O CANÔNICO E MAIS NADA (decisão do dono, 20/08/2026): breadcrumb
 * com o gênero no meio; badge; título; chips (gêneros + meta + classificação);
 * sinopse de TRÊS linhas (texto completo em "A OBRA"); DOIS botões; cartão à
 * direita com Cinerie Score → Avaliações → Onde assistir (marcas em linha).
 * As sete remoções (linha de métrica, aviso de escala, "Atualizado em" ×2,
 * "Também em", aviso de ofertas, os quatro botões antigos, a faixa de prêmios
 * no topo) estão travadas por `detail-hero-canonical.test.tsx` — por conteúdo
 * renderizado, não por varredura de texto-fonte.
 *
 * BLOCOS DO CANÔNICO QUE NÃO RENDERIZAM, E POR QUÊ (detalhe em docs/frontend/DESIGN-DELTA-detalhe.md):
 *  - "Original Screen"/"Original Cinerie" (selo ao lado do badge): afirmação
 *    FALSA — a Cinerie não produz filme. Travado por `original-screen-absent`.
 *  - Cinerie Score abaixo do PISO de duas fontes contadas: o card não existe e
 *    "Avaliações" sobe no cartão — com uma fonte só não existe composição.
 *    Sem decisão vigente no banco (o proprietário aplica), idem, com motivo
 *    próprio no log.
 *  - Duração e contagens da banda de mídia ("02:31", "6 vídeos · 128 fotos"):
 *    a API do TMDB não entrega duração, e contagem sem galeria para abrir é
 *    promessa sem destino.
 *  - Card "Fotos e Vídeos" da banda: não existe superfície de galeria no
 *    produto; os cards restantes se redistribuem.
 *
 * Toda ausência de DADO passa por `SectionBoundary`, que registra o motivo em
 * log estruturado. Bloco que some sem dizer por quê é defeito, não economia.
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

  const { view, entityId, seo, canonicalUrl, relatedNews, cast, watch, watchAbsence, awards, awardsAbsence, ratings, externalIds, genres, score, fichaFacts, similar, trailer, mediaCounts } =
    data
  const isUnderReview = seo.decision !== 'index'
  const metaText = [view.year !== null ? String(view.year) : null, view.runtimeLabel]
    .filter((item): item is string => item !== null)
    .join(' · ')
  const crumbGenre = breadcrumbGenre(genres)
  const genreChips = heroGenreChips(genres)
  const scoreDecision = decideCinerieScore(score)


  const critiqueBlock = view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null
  const workBlocks = view.blocks.filter((block) => WORK_BLOCK_TYPES.has(block.blockType))
  const castContext = view.blocks.find((block) => block.blockType === 'cast_intro') ?? null
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const primaryCast = cast.slice(0, 6)
  const editorialNews = relatedNews.slice(0, 3)

  // A BANDA DE MIDIA. Os tres cartoes do canonico voltam porque as rotas de
  // galeria passaram a existir; cada um so entra com destino E com conteudo.
  // Ver `src/lib/media-band-presenter.ts` — inclusive para por que a legenda
  // NAO carrega duracao (o TMDB nao a entrega; `size` e resolucao).
  // `slug` JA e o canonico neste ponto: a rota fez `permanentRedirect`
  // acima quando o pedido veio por um slug antigo.
  const mediaBand = buildMediaBand({
    imagesPath: imagesGalleryPath('filmes', slug),
    videosPath: videosGalleryPath('filmes', slug),
    newsAnchor: '#movie-news-title',
    newsCount: editorialNews.length,
    imageCount: mediaCounts.images,
    videoCount: mediaCounts.videos,
    backdropUrl: view.media.backdrop?.src ?? null,
    hasTrailer: trailer !== null,
  })
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
  // O Cinerie Score do cartao: quem decide e o presenter (piso de 2 fontes +
  // decisao vigente); aqui so se monta a SectionDecision para a ausencia falar
  // com o motivo certo (sem decisao != uma fonte so != nenhuma nota).
  const scoreSection: SectionDecision<CinerieScoreView> = scoreDecision.rendered
    ? { rendered: true, value: scoreDecision.view, absence: null }
    : {
        rendered: false,
        value: null,
        absence: buildSectionAbsence({
          ...entityRef,
          section: 'cinerie-score',
          reason: scoreDecision.reason,
        }),
      }
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

  // Espelha a trilha VISIVEL do topo canonico: `Filmes / <genero> / titulo`
  // (o genero entrou no lugar do "Inicio" — decisao do dono, 20/08/2026).
  // Schema e trilha nunca divergem: sem genero, o item do meio nao existe nos
  // dois lados.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Filmes',
        item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
      },
      ...(crumbGenre !== null
        ? [
            {
              '@type': 'ListItem',
              position: 2,
              name: crumbGenre,
              item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: crumbGenre !== null ? 3 : 2,
        name: view.title,
        item: canonicalUrl,
      },
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
      {/* ===== HERO editorial claro — o TOPO CANONICO (tela 06) =====
          Breadcrumb com o GENERO no meio; badge; titulo; chips (generos +
          meta + classificacao); sinopse de TRES linhas (palavra inteira, texto
          completo em "A OBRA"); DOIS botoes. Nada alem do canonico entra aqui
          — nenhum aviso, nenhuma data, nenhum rotulo explicativo (decisao do
          dono, 20/08/2026; travado por detail-hero-canonical.test.tsx). */}
      <div className="detail-hero">
        <div className="detail-container">
          <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
            <ol>
              <li>
                <a href={MOVIES_INDEX_PATH}>Filmes</a>
              </li>
              {crumbGenre !== null ? (
                <li>
                  <a href={MOVIES_INDEX_PATH}>{crumbGenre}</a>
                </li>
              ) : null}
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>

          <div className="detail-hero__grid">
            <div className="detail-hero__main">
              <div className="detail-badge-row">
                {/* So o selo da vertical. "Original Screen"/"Original Cinerie"
                    NAO e portado: a Cinerie nao produz filme (afirmacao falsa;
                    travado por original-screen-absent.test.ts). */}
                <span className="detail-badge" data-entity-badge="movie">
                  Filme
                </span>
              </div>
              <h1 className="detail-hero__title">{view.title}</h1>
              <ul className="detail-hero__chips">
                {genreChips.map((genre) => (
                  <li className="detail-hero__genre-chip" key={genre}>
                    {genre}
                  </li>
                ))}
                {metaText !== '' ? (
                  <li className="detail-hero__meta-text">{metaText}</li>
                ) : null}
                {view.certification !== null ? (
                  <li className="detail-hero__cert">{view.certification}</li>
                ) : null}
              </ul>
              <EntitySynopsis maxChars={HERO_SYNOPSIS_MAX_CHARS} synopsis={view.synopsis} />
              <div className="detail-actions">
                {/* DOIS botoes, exatamente: Minha lista + Avaliar (C8; fetch
                    apos clique, zero chamada externa no render). */}
                <EntityActions entityType="movie" entityId={entityId} />
              </div>
            </div>

            <aside aria-label="Notas e disponibilidade" className="detail-hero__aside">
              {/* O CARTAO da coluna direita, na ordem do canonico:
                  CINERIE SCORE -> AVALIACOES -> ONDE ASSISTIR.

                  O Score so renderiza com >= 2 fontes contadas e decisao
                  vigente (autorizacao do proprietario, 20/08/2026). Abaixo do
                  piso, o bloco NAO existe e "Avaliacoes" sobe e ocupa o topo do
                  cartao — os dois arranjos sao provados por teste. */}
              <SectionBoundary decision={scoreSection}>
                {(scoreView) => (
                  <div className="detail-aside-block detail-aside-block--first">
                    <CinerieScoreCard view={scoreView} />
                  </div>
                )}
              </SectionBoundary>
              <SectionBoundary decision={ratingsSection}>
                {(view) => (
                  <div
                    className={
                      scoreDecision.rendered
                        ? 'detail-aside-block'
                        : 'detail-aside-block detail-aside-block--first'
                    }
                  >
                    <p className="detail-aside-block__label">Avaliações</p>
                    {/* Notas de terceiros na medida da propria fonte; a
                        proveniencia (metrica, data, URL) vive no title/data-*
                        de cada chip, e o credito no rodape global. */}
                    <RatingsPanel view={view} />
                  </div>
                )}
              </SectionBoundary>
              <SectionBoundary decision={watchSection}>
                {(view) => (
                  <div className="detail-aside-block">
                    <p className="detail-aside-block__label">Onde assistir</p>
                    {/* Marcas em linha (canonico), com a MODALIDADE visivel ao
                        lado de cada uma (decisao de 2026-08-13: loja so e
                        honesta com a modalidade na tela). */}
                    <WatchBrandsRow brands={watchBrandsRow(view)} />
                  </div>
                )}
              </SectionBoundary>
            </aside>
          </div>
        </div>
      </div>

      {/* ===== Mídia full-bleed (pôster · TRAILER · cards empilhados) =====
          A banda do canônico: pôster sangrando à esquerda, trailer grande no
          centro com play redondo, e a coluna direita com os cards que TÊM
          destino e dado. Card sem dado NÃO vira card cinza com "Em breve" —
          ele não existe, e os que restarem se redistribuem (o "Em breve" que
          vivia aqui era exatamente esse placeholder, e saiu).

          NADA CARREGA ANTES DO CLIQUE: o iframe do YouTube só é montado dentro
          do diálogo do TrailerModal, após clique explícito. */}
      {view.media.poster !== null || view.media.backdrop !== null ? (
        <div className="media-strip">
          <div
            className="media-strip__grid"
            // A CONTAGEM REAL, e nao 0/1: e ela que o CSS usa para colapsar a
            // grade. Com 0 cartoes a terceira coluna (2fr) ficava declarada e
            // VAZIA — a banda ocupava 2/3 da largura e sobrava branco a direita.
            data-media-cards={mediaBand.cards.length}
          >
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
              {/* Legenda só quando há trailer de verdade. Duração e contagens
                  ("02:31 · Trailer", "6 vídeos · 128 fotos") NÃO renderizam:
                  a API do TMDB não entrega duração, e uma contagem de mídia
                  sem galeria para abrir seria promessa sem destino. */}
              {mediaBand.trailerCaption !== null ? (
                <span className="media-strip__caption">{mediaBand.trailerCaption}</span>
              ) : null}
              {/* As CONTAGENS, no canto inferior direito. Reais: vem de
                  `COUNT(*)` nas mesmas condicoes que a galeria usa para listar. */}
              {mediaBand.countsLabel !== null ? (
                <span className="media-strip__counts">{mediaBand.countsLabel}</span>
              ) : null}
            </div>
                        {/* A COLUNA DE CARDS. O canonico desenha TRES — "Imagens e Posteres",
                "Noticias e Eventos" e "Trailers e Teasers" — e ate 21/08/2026 so o
                do meio existia. O comentario antigo dizia a verdade sobre o porque:
                "nao existe rota de galeria de imagens nem de videos". A regra estava
                certa; o que faltava era o DESTINO. As quatro rotas de galeria agora
                existem, e os cartoes voltam porque levam a algum lugar — nao porque o
                canonico os desenha.

                Cada cartao so entra com destino E com conteudo: um cartao de galeria
                vazia gastaria um clique para dizer "ainda nao ha imagens".

                PREMIOS SAIU DAQUI (decisao do dono): a faixa desce para a secao
                propria logo abaixo. */}
            {mediaBand.cards.length > 0 ? (
              <div className="media-strip__stack">
                {mediaBand.cards.map((card) => (
                  <a className="media-strip__cell" href={card.href} key={card.key}>
                    {card.backgroundUrl !== null ? (
                      <img alt="" loading="lazy" src={card.backgroundUrl} />
                    ) : null}
                    <span className="media-strip__caption">{card.label}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== Prêmios — a faixa desceu do topo (decisao do dono): vive abaixo
          da banda de mídia, como o canônico desenha, e o card "Prêmios e
          Indicações" da banda ancora aqui. ===== */}
      <SectionBoundary decision={awardsSection}>
        {(panel) => (
          <div id="movie-awards">
            <AwardsBand credit={panel.credit} vertical="movie" view={panel.view} />
          </div>
        )}
      </SectionBoundary>

      {/* ===== A obra =====
          A sinopse COMPLETA vive aqui (o topo mostra três linhas). A abertura
          em destaque só existe quando há texto editorial PRÓPRIO — nunca a
          sinopse repetida em corpo maior. O crédito da sinopse continua o do
          catálogo (rodapé global); colocá-la sob um título nosso não a torna
          nossa. */}
      {(synopsisLead !== null || synopsisRest.length > 0 || view.synopsis !== null) ? (
        <section aria-labelledby="movie-work-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="eyebrow-bar">
            <span id="movie-work-title">A obra</span>
          </div>
          {synopsisLead !== null ? (
            <p className="synopsis-lead" data-block-type={synopsisLead.blockType}>
              {synopsisLead.content}
            </p>
          ) : null}
          <div data-work-synopsis="full">
            <EntitySynopsis synopsis={view.synopsis} variant="work" />
          </div>
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
            {/* Sem sobrancelha: "— ELENCO" acima de "ELENCO PRINCIPAL" so
                repetia o titulo (decisao do dono; regra em SectionHead). */}
            <SectionHead headingId="movie-cast-title" kicker="Elenco" thin="principal" title="Elenco" />
            <a className="detail-see-all" href="/pt/pessoas/">
              Ver elenco completo →
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
            {/* O kicker "Editorial" FICA: diz a natureza da secao (conteudo da
                redacao), que o titulo nao diz — a regra so barra repeticao. */}
            <SectionHead headingId="movie-news-title" kicker="Editorial" thin="e bastidores" title="Notícias" />
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
      {fichaFacts.length > 0 || similarSection.rendered ? (
        <section aria-labelledby="movie-facts-title" className="detail-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
          <div className={similarSection.rendered ? 'ficha-grid' : 'ficha-grid ficha-grid--solo'}>
            <div>
              <div className="eyebrow-bar">
                <span id="movie-facts-title">Ficha técnica</span>
              </div>
              <dl className="ficha-rows">
                {fichaFacts.map((fact) => (
                  <div className="ficha-row" key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>
                      {'people' in fact
                        ? fact.people.map((person, index) => (
                            <span key={person.name}>
                              {index > 0 ? ', ' : null}
                              {person.href !== null ? (
                                <a href={person.href}>{person.name}</a>
                              ) : (
                                person.name
                              )}
                            </span>
                          ))
                        : fact.value}
                    </dd>
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
