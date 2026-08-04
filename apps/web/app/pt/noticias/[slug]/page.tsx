import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import {
  articleRobots,
  buildArticleJsonLd,
  buildOpenGraph,
  buildTwitter,
  resolveCanonical,
  serializeJsonLd,
  type ArticleSeoFacts,
} from '@screena/seo'

import { AdSlot } from '../../../_components/ad-slot'
import { ArticleBody } from '../../../_components/article-body'
import { CardBookmark } from '../../../_components/card-bookmark'
import type { NewsArticleView } from '../../../../src/lib/news-presenter'
import { HOME_PATH, SITE_URL, gatePublicRobots } from '../../../../src/lib/site'
import { getNewsArticleData } from '../../../../src/server/news-pages'

/**
 * Artigo — tela 05 do canônico, estrutura EXATA: hero ESCURO full-width
 * (breadcrumb → chip de categoria → headline 52 → deck → byline com avatar/
 * data/tempo de leitura) → corpo de leitura 720 justificado (17/1.8) → AdSlot
 * mid-article → FICHA DO TÍTULO (entity card real da 1ª entidade citada) →
 * fonte → entidades citadas + share → nota de transparência de IA → LEIA
 * TAMBÉM (4 artigos reais). Dados 100% do CMS/catálogo; sem dado -> estado
 * honesto ou omissão registrada em DESIGN-DELTA (nunca substituição
 * semântica). Draft/agendada/retratada dão 404 pelo gate canônico.
 */

export const dynamic = 'force-dynamic'

const NEWS_INDEX_PATH = '/pt/noticias/'

const RELATED_LABELS: Readonly<Record<string, string>> = {
  movie: 'Filme',
  tv: 'Série',
  person: 'Pessoa',
}

interface NewsArticleParams {
  slug: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<NewsArticleParams>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getNewsArticleData(slug)

  if (data === null) {
    return {
      title: 'Notícia não encontrada',
      robots: { index: false, follow: false },
    }
  }

  const { view, indexability, canonicalUrl } = data
  const facts = seoFactsOf(view, indexability.decision, canonicalUrl)
  const canonical = resolveCanonical(facts)

  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.title} — Notícias`,
    // `robots` e `canonical` sao DERIVADOS da decisao de indexabilidade, nunca
    // projetados do CMS. O override editorial so entra quando a pagina indexa —
    // `resolveCanonical` e quem resolve esse conflito.
    //
    // `gatePublicRobots` por cima NAO e redundante: `articleRobots` e puro e so
    // conhece a decisao da MATERIA. O kill switch de AMBIENTE — que mantem
    // preview e staging inteiramente fora do indice — vive no gate, e sem ele
    // um deploy de preview indexaria materia por materia.
    robots: gatePublicRobots(articleRobots(indexability.decision)),
    alternates: { canonical: canonical.href },
    openGraph: buildOpenGraph(facts),
    twitter: buildTwitter(facts),
  }
  const description = view.metaDescription ?? view.deck
  if (description !== null) metadata.description = description
  return metadata
}

/**
 * View publica -> fatos de SEO tecnico.
 *
 * Ponte deliberadamente boba: toda a decisao mora em `@screena/seo`, que e puro
 * e testado. Espalhar `if` de SEO pela pagina foi exatamente o que produziu, no
 * passado, duas superficies discordando sobre a mesma URL.
 */
function seoFactsOf(
  view: NewsArticleView,
  decision: ArticleSeoFacts['decision'],
  canonicalUrl: string,
): ArticleSeoFacts {
  return {
    canonicalUrl,
    canonicalOverride: view.canonicalOverride,
    decision,
    title: view.title,
    metaTitle: view.metaTitle,
    metaDescription: view.metaDescription,
    deck: view.deck,
    socialTitle: view.socialTitle,
    socialDescription: view.socialDescription,
    articleSection: view.articleSection,
    schemaTypeRecommendation: view.schemaTypeRecommendation,
    imageUrl: view.heroImage === null ? null : `${SITE_URL}${view.heroImage.src}`,
    imageAlt: view.heroImage?.alt ?? null,
    publishedAtIso: view.dateIso,
    updatedAtIso: view.updatedAtIso,
    authorName: view.author,
    siteName: 'Cinerie',
    locale: 'pt-BR',
  }
}

export default async function NewsArticlePage({ params }: { params: Promise<NewsArticleParams> }) {
  const { slug } = await params
  const data = await getNewsArticleData(slug)
  if (data === null) notFound()

  const { view, indexability, canonicalUrl, readAlso, bodyBlocks } = data
  const isUnderReview = indexability.decision !== 'index'
  const card = view.entityCard

  // Corpo ESTRUTURADO quando o CMS o projetou; corpo textual legado quando não.
  // Nunca os dois: seria o mesmo texto duas vezes na página.
  const hasStructuredBody = bodyBlocks.length > 0

  // AdSlot mid-article do canônico: entra no meio do corpo quando há corpo
  // suficiente; senão, depois do último parágrafo.
  const paragraphs = view.bodyParagraphs
  const adAfter = paragraphs.length >= 4 ? Math.ceil(paragraphs.length * 0.6) : paragraphs.length
  const bodyBefore = paragraphs.slice(0, adAfter)
  const bodyAfter = paragraphs.slice(adAfter)

  // Mesma regra de posição do anúncio, aplicada aos blocos: só conta bloco de
  // TEXTO. Cortar no meio de uma contagem que inclui divisores e fichas colocaria
  // o anúncio entre uma imagem e a legenda dela.
  const textBlockCount = bodyBlocks.filter(
    (block) => block.kind === 'paragraph' || block.kind === 'quote',
  ).length
  const blockAdAfter =
    textBlockCount >= 4 ? Math.ceil(bodyBlocks.length * 0.6) : bodyBlocks.length

  const shareUrl = encodeURIComponent(canonicalUrl)
  const shareText = encodeURIComponent(view.title)

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Início',
        item: `${SITE_URL}${HOME_PATH}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Notícias',
        item: `${SITE_URL}${NEWS_INDEX_PATH}`,
      },
      { '@type': 'ListItem', position: 3, name: view.title, item: canonicalUrl },
    ],
  }

  // JSON-LD DERIVADO, com o tipo resolvido no lado publico: a recomendacao do
  // CMS e uma sugestao. `Review` sem review propria seria schema falso, e a
  // decisao de ter review propria nao pertence ao pipeline editorial.
  const articleJsonLd = buildArticleJsonLd(
    seoFactsOf(view, indexability.decision, canonicalUrl),
  )

  return (
    <main data-vertical="news">
      {/* HERO escuro (canônico): breadcrumb → chip → headline → deck → byline */}
      <header className="art-hero">
        {view.heroImage !== null ? (
          <div className="art-hero__img">
            <img
              alt=""
              fetchPriority="high"
              height={view.heroImage.height}
              src={view.heroImage.src}
              width={view.heroImage.width}
            />
          </div>
        ) : null}
        <div className="art-hero__scrim" />
        <div className="art-hero__inner">
          <nav aria-label="Trilha de navegação" className="art-crumb">
            <a href={HOME_PATH}>Início</a>
            <span aria-hidden="true" className="art-crumb__sep">
              ›
            </span>
            <a href={NEWS_INDEX_PATH}>Notícias</a>
            {view.category !== null ? (
              <>
                <span aria-hidden="true" className="art-crumb__sep">
                  ›
                </span>
                <span aria-current="page">{view.category}</span>
              </>
            ) : null}
          </nav>
          {view.category !== null ? <span className="art-chip">{view.category}</span> : null}
          <h1 className="art-title">{view.title}</h1>
          {view.deck !== null ? <p className="art-deck">{view.deck}</p> : null}
          <div className="art-byline">
            {view.author !== null ? (
              <span className="art-byline__author">
                <span aria-hidden="true" className="art-byline__avatar" />
                por <strong>{view.author}</strong>
              </span>
            ) : null}
            {view.author !== null && view.dateLabel !== null ? (
              <span aria-hidden="true" className="art-byline__sep">
                ·
              </span>
            ) : null}
            {view.dateLabel !== null ? <span>{view.dateLabel}</span> : null}
            {view.readTimeLabel !== null ? (
              <>
                <span aria-hidden="true" className="art-byline__sep">
                  ·
                </span>
                <span>{view.readTimeLabel}</span>
              </>
            ) : null}
          </div>
        </div>
      </header>

      {/* Corpo de leitura 720 */}
      <article className="art-body">
        {/* Crédito da capa. Fica AQUI, e não dentro do `art-hero`, por dois
            motivos: o hero é `position:absolute` sob um scrim escuro, onde
            `--c-text-muted` perde contraste; e a coluna de leitura é o mesmo
            contexto em que o crédito de imagem de corpo já é renderizado, então
            reusar `art-figure__credit` mantém uma única linguagem visual de
            crédito na página — sem classe nem posicionamento novos.

            Só aparece quando existe: quando a licença exige atribuição, o CMS
            recusa projetar sem `credit` (`attribution_missing`), então crédito
            presente == atribuição satisfeita. */}
        {view.heroImage?.credit != null ? (
          <p className="art-figure__credit">{view.heroImage.credit}</p>
        ) : null}

        {hasStructuredBody ? (
          <>
            <ArticleBody blocks={bodyBlocks.slice(0, blockAdAfter)} />

            <div className="art-ad">
              <AdSlot format="leaderboard" slotId="article-mid" />
            </div>

            <ArticleBody blocks={bodyBlocks.slice(blockAdAfter)} />
          </>
        ) : (
          <>
            {bodyBefore.map((paragraph, index) => (
              <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}

            <div className="art-ad">
              <AdSlot format="leaderboard" slotId="article-mid" />
            </div>

            {bodyAfter.map((paragraph, index) => (
              <p key={`after-${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
            ))}
          </>
        )}

        {/* Ficha do título — entity card real da 1ª entidade citada */}
        {card !== null ? (
          <aside
            aria-label={`Ficha de ${card.title}`}
            className="art-ficha"
            data-vertical={card.entityType === 'movie' ? 'movie' : 'series'}
          >
            <a aria-hidden="true" className="art-ficha__poster" href={card.href} tabIndex={-1}>
              {card.posterUrl !== null ? <img alt="" loading="lazy" src={card.posterUrl} /> : null}
            </a>
            <div className="art-ficha__body">
              <span className="art-ficha__kicker">{card.kicker}</span>
              <a className="art-ficha__title" href={card.href}>
                {card.title}
              </a>
              {card.metaLine !== null ? <div className="art-ficha__meta">{card.metaLine}</div> : null}
              {/* Área de score do canônico: Cinerie Score segue BLOQUEADO —
                  estado honesto, nunca outra métrica no lugar. */}
              <div className="art-ficha__stats">
                <span>
                  Cinerie Score <strong>—</strong> ainda não calculado
                </span>
              </div>
              {card.summary !== null ? <p className="art-ficha__summary">{card.summary}</p> : null}
              <div className="art-ficha__footer">
                <div className="art-ficha__actions">
                  <CardBookmark
                    entityId={card.entityId}
                    entityType={card.entityType}
                    label="Minha lista"
                    title={card.title}
                  />
                </div>
                <a className="art-ficha__link" href={card.href}>
                  {card.entityType === 'movie' ? 'Ver página do filme' : 'Ver página da série'} →
                </a>
              </div>
            </div>
          </aside>
        ) : null}

        {view.source !== null ? (
          <p className="art-source">
            Fonte: <strong>{view.source.name}</strong>
          </p>
        ) : null}

        {/* Entidades citadas (chips) + share — o CMS não tem tags editoriais;
            as entidades citadas ficam como componente próprio rotulado. */}
        <div className="art-share">
          {view.related.length > 0 ? (
            <ul aria-label="Entidades citadas nesta matéria" className="related-entities">
              {view.related.map((entity) => (
                <li key={`${entity.entityType}:${entity.href}`}>
                  <a href={entity.href}>
                    <span
                      className={
                        entity.entityType === 'movie'
                          ? 'badge badge--movie'
                          : entity.entityType === 'tv'
                            ? 'badge badge--series'
                            : 'badge'
                      }
                    >
                      {RELATED_LABELS[entity.entityType] ?? entity.entityType}
                    </span>
                    {entity.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <span />
          )}
          <div className="art-share__row">
            <span className="art-share__label">Compartilhar</span>
            <a
              aria-label="Compartilhar no X"
              className="art-share__btn"
              href={`https://x.com/intent/post?text=${shareText}&url=${shareUrl}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 0 24 24" width="14">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.65l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.07l4.713 6.231zm-1.16 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              aria-label="Compartilhar no Facebook"
              className="art-share__btn"
              href={`https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              <svg aria-hidden="true" fill="currentColor" height="15" viewBox="0 0 24 24" width="15">
                <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.5-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.9h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94z" />
              </svg>
            </a>
          </div>
        </div>

        {view.aiAssisted ? (
          <p className="art-note" role="note">
            Conteúdo produzido pela equipe editorial da Cinerie, com apoio de ferramentas de
            inteligência artificial. Imagens meramente ilustrativas.
          </p>
        ) : null}

        {isUnderReview ? (
          <p className="muted" data-editorial-state="in-review">
            Esta notícia ainda está em revisão editorial.
          </p>
        ) : null}
      </article>

      {/* Leia também — 4 artigos reais */}
      {readAlso.length > 0 ? (
        <section aria-labelledby="read-also-title" className="read-also">
          <div className="eyebrow-bar">
            <span aria-hidden="true" className="eyebrow-bar__mark" />
            <h2 className="section-title" id="read-also-title">
              <strong>Leia</strong> <span>também</span>
            </h2>
          </div>
          <div className="read-also__grid">
            {readAlso.map((item) => (
              <a href={item.href} key={item.href}>
                <span className="read-also__cover">
                  {/* Mesmo caso dos cards da listagem: a imagem identifica o
                      link. `?? ""` quando o CMS não aprovou descrição — sem
                      descrição aprovada a imagem É decorativa, e o texto do
                      card já nomeia o link. */}
                  {item.image !== null ? (
                    <img alt={item.image.alt ?? ''} loading="lazy" src={item.image.src} />
                  ) : null}
                </span>
                {item.category !== null ? (
                  <span className="read-also__cat">{item.category}</span>
                ) : null}
                <h3 className="read-also__title">{item.title}</h3>
                {item.dateLabel !== null ? (
                  <div className="read-also__date">{item.dateLabel}</div>
                ) : null}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
    </main>
  )
}
