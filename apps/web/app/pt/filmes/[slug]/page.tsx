import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import {
  buildMetaDescription,
  buildSameAs,
  composeCatalogDescriptionSource,
  describeMovieFactually,
  movieDescriptionLead,
  schemaPeople,
  serializeJsonLd,
  toIsoDuration,
} from '@screena/seo'

import { EntityActions } from '../../../_components/entity-actions'
import { EntitySynopsis } from '../../../_components/entity-synopsis'
import { AwardsBand } from '../../../_components/awards-band'
import { CinerieScoreCard } from '../../../_components/cinerie-score-card'
import { AdSlot } from '../../../_components/opapreco/ad-slot'
import { SectionBoundary } from '../../../_components/section-boundary'
import { SectionHead } from '../../../_components/section-head'
import { SimilarTitles } from '../../../_components/similar-titles'
import { TitleTopCast, type TitleTopPerson } from '../../../_components/title-top-cast'
import { TrailerModal } from '../../../_components/trailer-modal'
import { WatchBrandsRow } from '../../../_components/watch-brands-row'
import { RatingsLine } from '../../../_components/ratings-panel'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { isEditorialReviewPending } from '../../../../src/lib/editorial-review'
import { entityPageImageUrls } from '../../../../src/lib/entity-page-images'
import {
  decideCinerieScore,
  type CinerieScoreView,
} from '../../../../src/lib/cinerie-score-presenter'
import { HERO_SYNOPSIS_MAX_CHARS, heroGenreChips } from '../../../../src/lib/detail-hero'
import {
  buildSectionAbsence,
  decideSection,
  type SectionDecision,
} from '../../../../src/lib/section-absence'
import { watchBrandsRow } from '../../../../src/lib/watch-brands-row'
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { socialArt, socialMetadata } from '../../../../src/lib/social-metadata'
import { getMoviePageData } from '../../../../src/server/movie-page'
import { buildMediaBand } from '../../../../src/lib/media-band-presenter'
import { imagesGalleryPath, videosGalleryPath } from '../../../../src/lib/routes'
import '../../../_components/detail-hero.css'
import '../../../_components/detail.css'

/**
 * Detalhe de filme — tela 06 do canônico (revisão de 2026-10-30):
 * barra superior BRANCA (container 1360/64: breadcrumb 11px → três colunas:
 * título 21/700 com o ano, linha de gêneros no acento da vertical e sinopse
 * 14px/56ch com "Ler mais" | Cinerie Score + linha de notas externas | Elenco e
 * Equipe) → mosaico de mídia full-bleed (1fr/3fr/2fr, 472px, filetes brancos de
 * 3px) → tira de ações (Minha lista · Avaliar | Onde assistir) → Prêmios →
 * A obra → OpaPreço `title-mid` → Elenco → Notícias e bastidores → Ficha
 * técnica + Mais como este → OpaPreço `title-bottom`.
 *
 * A seção "Guia Cinerie · Crítica" SAIU (canônico de 2026-10-30). A sinopse
 * completa continua em "A OBRA"; o topo mostra o corte em palavra inteira.
 * Duração, classificação e direção saíram do topo junto com os chips de meta, e
 * seguem na Ficha técnica.
 *
 * DIVERGÊNCIAS do topo novo, todas por governança (ver o relatório da leva):
 *  - o selo textual "Filme" fica, compacto, antes da linha de gêneros: o
 *    canônico o tirou, e a invariante 11 exige label + badge;
 *  - as marcas de IMDb/TMDB/RT são os ARQUIVOS que a licença declara (ou o nome
 *    em texto), nunca o redesenho monocromático em SVG do canônico;
 *  - a caixa do Score mostra a composição real, não "de N avaliações".
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

/**
 * Janela de cache: 5 minutos.
 *
 * Era uma hora, e a ficha e uma pagina de CATALOGO — que muda pouco. O que
 * mudou de dono foi a secao "Noticias e Bastidores": desde que o MNScr passou a
 * vincular a materia a obra, esta pagina tem conteudo editorial, e editorial
 * envelhece em minutos, nao em horas. Medido em 28/08/2026: a materia do
 * trailer em LEGO ja estava vinculada no banco e a ficha do filme continuou
 * mostrando a lista antiga, porque a copia em cache era anterior a publicacao.
 *
 * 5 minutos e o meio-termo declarado: 12x mais renderizacao que antes num
 * conjunto de paginas que quase nunca e visitado duas vezes na mesma janela, em
 * troca de a materia aparecer na ficha enquanto ela ainda e noticia. O certo de
 * verdade e revalidacao SOB DEMANDA — o worker de projecao avisando o site
 * quando cria o vinculo —, e ela continua valendo a pena depois disto.
 */
export const revalidate = 300

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

  const { view, seo, canonicalUrl, genres, cast, directors } = data
  const title =
    view.metaTitle ?? `${view.title}${view.year !== null ? ` (${view.year})` : ''} — Filme`
  // A descricao COMPOSTA (22/09/2026): a descricao editorial propria, ou uma
  // abertura com os fatos da ficha seguida da sinopse — antes era a sinopse do
  // TMDB cortada, o mesmo snippet de todo site que reusa o TMDB. Sem sinopse no
  // idioma publicado, a descricao e montada so com os FATOS que a ficha mostra
  // (auditoria de SEO, achado M4: antes a tag nem saia).
  const description =
    buildMetaDescription(
      composeCatalogDescriptionSource({
        editorial: view.editorialMetaDescription,
        lead: movieDescriptionLead({
          year: view.year,
          genres,
          directors: directors.map((person) => person.name),
          cast: cast.map((member) => member.name),
        }),
        synopsis: view.metaDescription,
      }),
    ) ??
    buildMetaDescription(
      describeMovieFactually({
        title: view.title,
        year: view.year,
        genres,
        directors: directors.map((person) => person.name),
        cast: cast.map((member) => member.name),
        runtimeLabel: view.runtimeLabel,
      }),
    )

  const metadata: Metadata = {
    title,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
    // A arte que a ficha exibe, sob a mesma licenca (decisao do dono D4): o
    // backdrop, depois o poster; sem nenhum dos dois, a marca.
    ...socialMetadata({
      type: 'video.movie',
      title,
      description,
      canonicalUrl,
      images: [
        socialArt(view.media.backdrop, view.title, 'landscape'),
        socialArt(view.media.poster, view.title, 'portrait'),
      ],
    }),
  }
  if (description !== null) metadata.description = description
  return metadata
}

export default async function MoviePage({ params }: { params: Promise<MoviePageParams> }) {
  const { slug } = await params
  const data = await getMoviePageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(MOVIES_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, entityId, seo, canonicalUrl, relatedNews, cast, watch, watchAbsence, awards, awardsAbsence, ratings, externalIds, genres, score, fichaFacts, similar, trailer, mediaCounts, directors, releaseDateIso } =
    data
  // So quando a pagina ESPERA uma decisao — nunca por portao de qualidade, caso
  // tecnico, licenca ou valvula (ver `isEditorialReviewPending`).
  const isUnderReview = isEditorialReviewPending(seo)
  // A linha de gêneros do topo (canônico: "DRAMA · SUSPENSE · MISTÉRIO").
  const genreLine = heroGenreChips(genres).join(' · ')
  const scoreDecision = decideCinerieScore(score)

  const workBlocks = view.blocks.filter((block) => WORK_BLOCK_TYPES.has(block.blockType))
  const castContext = view.blocks.find((block) => block.blockType === 'cast_intro') ?? null
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  const primaryCast = cast.slice(0, 6)
  const editorialNews = relatedNews.slice(0, 3)
  // "Elenco e Equipe" do topo: dois do elenco e a direção (a mesma da ficha
  // técnica). Sem direção, três do elenco. Direção não tem retrato no banco —
  // o círculo mostra as iniciais.
  const topDirector = directors[0] ?? null
  const topPeople: TitleTopPerson[] = [
    ...primaryCast.slice(0, topDirector !== null ? 2 : 3).map((member) => ({
      name: member.name,
      role: member.character !== null ? `como ${member.character}` : null,
      href: member.href,
      profile: member.profile,
    })),
    ...(topDirector !== null
      ? [{ name: topDirector.name, role: 'Direção', href: topDirector.href, profile: null }]
      : []),
  ]

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

  // Espelha a trilha VISIVEL do topo: `Filmes / titulo`. Schema e trilha nunca
  // divergem.
  //
  // O degrau de GENERO saiu dos dois lados em 11/09/2026 (decisao do dono): ele
  // apontava para a MESMA URL da listagem geral, porque nao existe pagina de
  // genero — "Filmes › Ação" levava a todos os filmes (auditoria de SEO, M8).
  // Volta quando a pagina de genero existir.
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
      {
        '@type': 'ListItem',
        position: 2,
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
  // Data COMPLETA quando o banco a tem; o ano sozinho so na falta dela (auditoria
  // de SEO: o `Movie` saia so com o ano).
  const datePublished = releaseDateIso ?? (view.year !== null ? String(view.year) : null)
  if (datePublished !== null) movieJsonLd.datePublished = datePublished
  if (view.metaDescription !== null) {
    movieJsonLd.description = view.metaDescription
  }
  // O que a ficha MOSTRA, e nada alem disso (auditoria de SEO, 3.5): a arte da
  // faixa de midia — `image` e obrigatoria para o Google em `Movie` —, os generos
  // da ficha, a direcao da ficha tecnica, o elenco da faixa e a duracao. Pessoa
  // com pagina ganha `url`; sem pagina, so o nome.
  // A MESMA lista que o shard de sitemap anuncia na URL desta ficha.
  const images = entityPageImageUrls(view.media, SITE_URL)
  if (images.length > 0) movieJsonLd.image = images
  if (genres.length > 0) movieJsonLd.genre = genres
  const directorList = schemaPeople(directors, SITE_URL)
  if (directorList.length > 0) movieJsonLd.director = directorList
  const actorList = schemaPeople(primaryCast, SITE_URL)
  if (actorList.length > 0) movieJsonLd.actor = actorList
  const duration = toIsoDuration(view.runtimeMinutes)
  if (duration !== null) movieJsonLd.duration = duration
  const sameAs = buildSameAs(externalIds, 'movie')
  if (sameAs.length > 0) movieJsonLd.sameAs = sameAs

  return (
    <main data-vertical="movie">
      {/* ===== Barra superior BRANCA — o TOPO CANONICO (tela 06, 2026-10-30) =====
          Três colunas: título com o ano + gêneros + sinopse cortada | Cinerie
          Score + notas externas | Elenco e Equipe. Os botões e "Onde assistir"
          desceram para a tira logo abaixo do mosaico. */}
      <div className="detail-hero detail-hero--title">
        <div className="detail-container">
          <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
            <ol>
              <li>
                <a href={MOVIES_INDEX_PATH}>Filmes</a>
              </li>
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>

          <div className="title-top">
            <div className="title-top__main">
              <h1 className="title-top__title">
                {view.title}
                {view.year !== null ? ` (${view.year})` : null}
              </h1>
              <div className="detail-badge-row title-top__kicker">
                {/* O selo da vertical FICA, compacto, mesmo sem estar no
                    canônico novo: label + badge são a invariante 11. "Original
                    Screen"/"Original Cinerie" NAO e portado: a Cinerie nao
                    produz filme (travado por original-screen-absent.test.ts). */}
                <span className="detail-badge" data-entity-badge="movie">
                  Filme
                </span>
                {genreLine !== '' ? <span className="title-top__genres">{genreLine}</span> : null}
              </div>
              <EntitySynopsis
                maxChars={HERO_SYNOPSIS_MAX_CHARS}
                readMoreHref="#movie-work-title"
                synopsis={view.synopsis}
                variant="top"
              />
            </div>

            <div className="title-top__score">
              {/* O Score so renderiza com >= 2 fontes contadas e decisao vigente
                  (autorizacao do proprietario, 20/08/2026). Abaixo do piso ele
                  NAO existe e a linha de notas ocupa a coluna sozinha. */}
              <SectionBoundary decision={scoreSection}>
                {(scoreView) => <CinerieScoreCard view={scoreView} />}
              </SectionBoundary>
              <SectionBoundary decision={ratingsSection} speak>
                {(view) => (
                  // Notas de terceiros na medida da propria fonte; a
                  // proveniencia (metrica, data, URL) vive no title/data-* de
                  // cada item, e o credito no rodape global.
                  <RatingsLine view={view} />
                )}
              </SectionBoundary>
            </div>

            <TitleTopCast
              people={topPeople}
              seeAllHref={castSection.rendered ? '#movie-cast-title' : null}
            />
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
                  // O poster NAO e o LCP quando ha destaque (2026-09-11): a celula
                  // dele e 1/6 da faixa no desktop e 1/3 no tablet e no celular, e a
                  // do destaque, ao lado, e sempre maior. `low` tira o preload de
                  // alta prioridade que o SSR do React 19 emite para toda <img>
                  // eager — sem `lazy`, porque ele segue acima da dobra. Sem
                  // destaque, ele e a maior imagem da faixa e volta a `high`.
                  fetchPriority={view.media.backdrop === null ? 'high' : 'low'}
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
                  // O LCP da ficha em TODA largura (2026-09-11). Carregava com
                  // `loading="lazy"`: medido na auditoria de SEO, 269 ms de espera e
                  // prioridade baixa no elemento que decide o LCP, enquanto o
                  // preload de alta prioridade ia para o poster.
                  fetchPriority="high"
                  height={view.media.backdrop.height}
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

      {/* ===== Ações + onde assistir (canônico de 2026-10-30) =====
          A tira logo abaixo do mosaico: os DOIS botões à esquerda (Minha lista
          + Avaliar; fetch após clique, zero chamada externa no render) e as
          marcas licenciadas à direita, com a MODALIDADE visível ao lado de cada
          uma (decisão de 2026-08-13: loja só é honesta com a modalidade na
          tela). */}
      <div className="detail-container title-actions">
        <div className="title-actions__bar">
          <div className="detail-actions">
            <EntityActions entityType="movie" entityId={entityId} />
          </div>
          <div className="title-actions__watch">
            <p className="title-actions__label">Onde assistir</p>
            <SectionBoundary decision={watchSection} speak>
              {(view) => <WatchBrandsRow brands={watchBrandsRow(view)} />}
            </SectionBoundary>
          </div>
        </div>
      </div>

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
          {/* Sem o filete de 16x2 antes do rótulo (canônico de 2026-10-30). */}
          <div className="eyebrow-bar eyebrow-bar--plain">
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

      {/* ===== OpaPreço · title-mid =====
          No lugar da antiga faixa "Guia Cinerie · Crítica", que saiu no
          canônico de 2026-10-30. A margem vive na classe do PRÓPRIO slot: com
          anúncio desligado ou vazio ele não renderiza, e o respiro some junto. */}
      <AdSlot
        className="title-ad title-ad--mid"
        id="title-mid"
        tags={{ vertical: 'movie', entity: slug, genres }}
      />

      {/* ===== Elenco · faixa visual ===== */}
      <SectionBoundary decision={castSection}>
        {(members) => (
        <section aria-labelledby="movie-cast-title" className="detail-container" style={{ paddingTop: 60 }}>
          <div className="section-head" style={{ alignItems: 'flex-end', marginBottom: 26 }}>
            {/* Sem sobrancelha: o canônico de 2026-10-30 deixou só o título. */}
            <SectionHead headingId="movie-cast-title" thin="principal" title="Elenco" />
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
            {/* Sem o kicker "Editorial": o canônico de 2026-10-30 deixou só o
                título. */}
            <SectionHead headingId="movie-news-title" thin="e bastidores" title="Notícias" />
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
              <div className="eyebrow-bar eyebrow-bar--plain">
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

      {/* ===== OpaPreço · title-bottom — depois de "Mais como este" ===== */}
      <AdSlot
        className="title-ad title-ad--bottom"
        id="title-bottom"
        tags={{ vertical: 'movie', entity: slug, genres }}
      />

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
