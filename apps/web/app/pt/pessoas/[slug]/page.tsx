import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'

import { buildSameAs, serializeJsonLd, buildMetaDescription } from '@screena/seo'

import { AdSlot } from '../../../_components/ad-slot'
import { SectionTitle } from '../../../_components/ds'
import { EntityExternalIds } from '../../../_components/entity-external-ids'
import { Filmography } from '../../../_components/filmography'
import { SectionBoundary } from '../../../_components/section-boundary'
import { canonicalRedirectPath } from '../../../../src/lib/canonical-redirect'
import { buildExternalLinks } from '../../../../src/lib/external-links'
import { formatHiddenCreditsNotice } from '../../../../src/lib/person-presenter'
import { decideSection } from '../../../../src/lib/section-absence'
import { SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getPersonPageData } from '../../../../src/server/person-page'

/**
 * Pessoa — tela 09 do canônico, estrutura EXATA: header 200px/1fr (retrato
 * CIRCULAR + kicker + nome 56 + chips + bio 68ch) → [banda de mídia: omitida —
 * sem vídeo/entrevista licenciados; delta registrado] → [barra de prêmios:
 * omitida — sem dado de awards no banco; delta] → CONHECIDO POR (5 cards com
 * poster real) → FOTOS (só galeria LICENCIADA; invariante 6) → Ad → FILMOGRAFIA
 * (tabela com filtro real Tudo/Filmes/Séries; sem célula de rating — ratings
 * externos inativos) → DETALHES PESSOAIS (2 colunas) → NOTÍCIAS RELACIONADAS
 * (2 cards horizontais). Dados 100% do PostgreSQL.
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

const PESSOAS_INDEX_PATH = '/pt/pessoas/'
const BIOGRAPHY_BLOCK_TYPES: ReadonlySet<string> = new Set(['editorial_intro'])
const KNOWN_FOR_LIMIT = 5

interface PersonPageParams {
  slug: string
}

interface PersonalDetail {
  label: string
  value: string
}

function formatPersonDate(isoDate: string | null): string | null {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null

  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function collectPersonalDetails(view: {
  originalName: string | null
  roleLabel: string | null
  birthDateIso: string | null
  deathDateIso: string | null
  placeOfBirth: string | null
}): PersonalDetail[] {
  const birthDate = formatPersonDate(view.birthDateIso)
  const deathDate = formatPersonDate(view.deathDateIso)
  const details: Array<PersonalDetail | null> = [
    view.originalName === null ? null : { label: 'Nome original', value: view.originalName },
    birthDate === null ? null : { label: 'Nascimento', value: birthDate },
    deathDate === null ? null : { label: 'Falecimento', value: deathDate },
    view.placeOfBirth === null ? null : { label: 'Local', value: view.placeOfBirth },
    // A FUNÇÃO NÃO ENTRA AQUI, e a razão não é espaço.
    //
    // Ela já é dita no kicker do cabeçalho ("Pessoa · Atuação"), que é o slot do
    // canônico para isso. Repeti-la em "Detalhes pessoais" produzia a linha
    // `Atuação principal | Atuação` — rótulo e valor dizendo a mesma palavra.
    // Não eram dois campos mal rotulados nem bug de renderização: era UM campo
    // impresso duas vezes, e o valor tinha perdido o acento na tabela de
    // tradução, o que fazia as duas impressões parecerem campos distintos.
  ]

  return details.filter((detail): detail is PersonalDetail => detail !== null)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PersonPageParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getPersonPageData(slug)

  if (data === null) {
    return {
      title: 'Pessoa não encontrada',
      robots: { index: false, follow: false },
    }
  }

  const { view, seo, canonicalUrl } = data
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.name} - Pessoa`,
    robots: gatePublicRobots(seo.robots),
    alternates: { canonical: canonicalUrl },
  }

  if (view.metaDescription !== null) {
    metadata.description = buildMetaDescription(view.metaDescription) ?? view.metaDescription
  }
  return metadata
}

export default async function PersonPage({ params }: { params: Promise<PersonPageParams> }) {
  const { slug } = await params
  const data = await getPersonPageData(slug)
  if (data === null) notFound()

  const redirectPath = canonicalRedirectPath(PESSOAS_INDEX_PATH, slug, data.canonicalSlug)
  if (redirectPath !== null) permanentRedirect(redirectPath)

  const { view, entityId, seo, canonicalUrl, relatedNews, externalIds, gallery } = data
  const isUnderReview = seo.decision !== 'index'
  const personalDetails = collectPersonalDetails(view)
  const biography = [
    view.metaDescription,
    ...view.blocks
      .filter((block) => BIOGRAPHY_BLOCK_TYPES.has(block.blockType))
      .map((block) => block.content),
    // TERCEIRA origem, e a que faltava: a `biography` que o TMDB devolve no
    // detalhe de pessoa. Ela vem POR ULTIMO de proposito — texto proprio
    // (`meta_description`, `editorial_intro`) precede o de terceiro.
    // `view.sourceBiography` ja passou pelo gate de licenca (invariante 6): a
    // pagina nao decide isso, so ordena.
    view.sourceBiography,
  ].filter((paragraph): paragraph is string => paragraph !== null)
  const newsContext = view.blocks.find((block) => block.blockType === 'news_context') ?? null
  // A BIOGRAFIA É UM BLOCO DO CANÔNICO, e hoje ela falta em quase toda pessoa.
  //
  // Faltar é aceitável; faltar CALADA não é. A decisão é sobre a biografia
  // INTEIRA (não sobre a seção de continuação): com um parágrafo, o cabeçalho o
  // exibe e não há ausência nenhuma para registrar; com zero, o log diz por quê.
  //
  // TRÊS origens, em ordem: `meta_description` (texto próprio de SEO),
  // `content_blocks` de tipo `editorial_intro` (texto próprio editorial) e a
  // `biography` crua do TMDB (texto de terceiro, por último).
  //
  // A terceira era BAIXADA E DESCARTADA até 20/08/2026 — `people` tinha a coluna
  // de governança (`biography_source_status`) e não tinha a de texto. Agora tem.
  // Mas ter o texto não é exibi-lo: `biography_source_status` nasce `unknown` e
  // o gate de licença (invariante 6) continua barrando até decisão humana. Ou
  // seja, `no_biography_source` continua sendo o motivo correto hoje — mudou a
  // causa (era "não existe coluna", virou "não há licença registrada").
  const biographySection = decideSection(biography.length > 0 ? biography : null, {
    entityType: 'person',
    entityId,
    section: 'biografia',
    reason: 'no_biography_source',
  })
  const externalLinks = buildExternalLinks(externalIds, 'person')
  const initials = view.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part.slice(0, 1))
    .join('')

  // Chips do header: só fatos reais (créditos, nascimento/local)
  const birthYear =
    view.birthDateIso !== null && /^\d{4}/.test(view.birthDateIso)
      ? view.birthDateIso.slice(0, 4)
      : null
  const birthChip = [
    birthYear !== null ? `Nascido em ${birthYear}` : null,
    view.placeOfBirth,
  ].filter((item): item is string => item !== null)
  const chips = [
    view.credits.length > 0
      ? `${view.credits.length} ${view.credits.length === 1 ? 'crédito' : 'créditos'}`
      : null,
    birthChip.length > 0 ? birthChip.join(' · ') : null,
  ].filter((item): item is string => item !== null)

  // A filmografia trunca quando o título do crédito não tem slug canônico pt-BR
  // (está no catálogo, mas não tem página) — e até agora saía calada. Quem
  // decide se a linha existe é o formatador: `null` = lista completa.
  const hiddenCreditsNotice = formatHiddenCreditsNotice(view.hiddenCreditCount)
  const knownFor = view.credits.filter((credit) => credit.posterUrl !== null).slice(0, KNOWN_FOR_LIMIT)
  const galleryPhotos = gallery.urls
  const galleryRest = gallery.total - galleryPhotos.length

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: `${SITE_URL}/pt/` },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Pessoas',
        item: `${SITE_URL}${PESSOAS_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.name, item: canonicalUrl },
    ],
  }

  const personJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': canonicalUrl,
    name: view.name,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  }
  if (view.originalName !== null) personJsonLd.alternateName = view.originalName
  if (view.roleLabel !== null) personJsonLd.jobTitle = view.roleLabel
  if (view.birthDateIso !== null) personJsonLd.birthDate = view.birthDateIso
  if (view.deathDateIso !== null) personJsonLd.deathDate = view.deathDateIso
  if (view.placeOfBirth !== null) {
    personJsonLd.birthPlace = { '@type': 'Place', name: view.placeOfBirth }
  }
  if (view.metaDescription !== null) personJsonLd.description = view.metaDescription
  const sameAs = buildSameAs(externalIds, 'person')
  if (sameAs.length > 0) personJsonLd.sameAs = sameAs

  return (
    <main data-vertical="person">
      {/* Header canônico: retrato circular 200px + kicker/nome/chips/bio */}
      <div className="person-head">
        <div
          className="person-head__avatar"
          style={view.profile === null ? undefined : { borderRadius: '50%' }}
        >
          {view.profile !== null ? (
            <img
              alt={`Retrato de ${view.name}`}
              fetchPriority="high"
              height={view.profile.height}
              src={view.profile.src}
              width={view.profile.width}
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </div>

        <header>
          <div className="person-head__kicker">
            Pessoa{view.roleLabel !== null ? ` · ${view.roleLabel}` : ''}
          </div>
          <h1 className="person-head__name">{view.name}</h1>
          {chips.length > 0 ? (
            <div className="person-chips">
              {chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          ) : null}
          {biography.length > 0 ? <p className="person-bio">{biography[0]}</p> : null}
          {externalLinks.length > 0 ? (
            <div className="entity-links" style={{ marginTop: 18 }}>
              <EntityExternalIds links={externalLinks} />
            </div>
          ) : null}
        </header>
      </div>

      {/* Banda de mídia (vídeos/entrevistas) e barra de prêmios do canônico:
          omitidas — sem vídeo licenciado nem dado de premiação no banco
          (DESIGN-DELTA; nada de conteúdo inventado). */}

      <div className="container">
        <SectionBoundary decision={biographySection}>
          {(paragraphs) =>
            paragraphs.length > 1 ? (
              <section aria-labelledby="person-bio-title" className="section">
                <SectionTitle id="person-bio-title" title="Biografia" />
                <div className="art-body" style={{ margin: 0, padding: 0, textAlign: 'left' }}>
                  {paragraphs.slice(1).map((paragraph, index) => (
                    <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ) : null
          }
        </SectionBoundary>

        {knownFor.length > 0 ? (
          <section aria-labelledby="person-known-for-title" className="section">
            <SectionTitle id="person-known-for-title" title="Conhecido por" />
            <div className="known-for">
              {knownFor.map((credit) => (
                <a
                  className="known-for__card"
                  data-entity-type={credit.entityType}
                  href={credit.href}
                  key={credit.href}
                >
                  <span className="known-for__poster">
                    {credit.posterUrl !== null ? (
                      <img alt="" loading="lazy" src={credit.posterUrl} />
                    ) : null}
                    <span
                      className={
                        credit.entityType === 'movie'
                          ? 'known-for__type'
                          : 'known-for__type known-for__type--series'
                      }
                    >
                      {credit.entityType === 'movie' ? 'Filme' : 'Série'}
                    </span>
                  </span>
                  <span className="known-for__body">
                    <span className="known-for__title">{credit.title}</span>
                    {credit.roleLabel !== null ? (
                      <span className="known-for__role">{credit.roleLabel}</span>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {/* Fotos: SÓ galeria licenciada (invariante 6) — vazia até decisão humana */}
        {galleryPhotos.length > 0 ? (
          <section aria-labelledby="person-photos-title" className="section">
            <SectionTitle id="person-photos-title" title="Fotos" />
            <div className="person-photos">
              {galleryPhotos.map((url, index) => (
                <div key={url}>
                  <img alt={`Foto de ${view.name}`} loading="lazy" src={url} />
                  {index === galleryPhotos.length - 1 && galleryRest > 0 ? (
                    <span className="person-photos__more">+{galleryRest}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <AdSlot format="leaderboard" slotId="person-credits" />

        <section aria-labelledby="person-filmography-title" className="section">
          <div className="section-head">
            <SectionTitle id="person-filmography-title" title="Filmografia" />
          </div>
          {view.credits.length > 0 ? (
            <Filmography
              items={view.credits.map((credit) => ({
                entityType: credit.entityType,
                title: credit.title,
                href: credit.href,
                year: credit.year,
                roleLabel: credit.roleLabel,
              }))}
            />
          ) : (
            <p className="muted">Filmografia ainda não disponível.</p>
          )}
          {/*
            FORA do ternário de propósito. O caso que mais importa é justamente
            aquele em que a lista está VAZIA e mesmo assim há créditos no banco:
            ali "Filmografia ainda não disponível" sozinha se lê como "esta
            pessoa não tem créditos", que é a afirmação falsa. A linha precisa
            aparecer nos dois ramos.
          */}
          {hiddenCreditsNotice !== null ? (
            <p className="muted">{hiddenCreditsNotice}</p>
          ) : null}
        </section>

        {personalDetails.length > 0 ? (
          <section aria-labelledby="person-details-title" className="section">
            <SectionTitle id="person-details-title" title="Detalhes pessoais" />
            <dl className="person-details">
              {personalDetails.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {relatedNews.length > 0 ? (
          <section aria-labelledby="person-related-news-title" className="section">
            <SectionTitle id="person-related-news-title" title="Notícias relacionadas" />
            {newsContext !== null ? (
              <p data-block-type={newsContext.blockType}>{newsContext.content}</p>
            ) : null}
            <div className="person-news">
              {relatedNews.slice(0, 2).map((card) => (
                <a className="person-news__card" href={card.href} key={card.href}>
                  <span className="person-news__img">
                    {card.image !== null ? <img alt="" loading="lazy" src={card.image.src} /> : null}
                  </span>
                  <span className="person-news__body">
                    {card.category !== null ? (
                      <span className="person-news__cat">{card.category}</span>
                    ) : null}
                    <span className="person-news__title">{card.title}</span>
                    {card.dateLabel !== null ? (
                      <span className="person-news__meta">{card.dateLabel}</span>
                    ) : null}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
          </p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(personJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
