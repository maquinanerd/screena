import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getNewsArticleData } from "../../../../src/server/news-pages";
import { SITE_URL } from "../../../../src/lib/site";
import type { NewsRelatedEntityType } from "../../../../src/lib/news-presenter";

/**
 * Pagina publica de noticia - /pt/noticias/[slug]/ (schema NewsArticle; NEUTRO).
 *
 * Server component puro: le somente PostgreSQL via `getNewsArticleData`. Zero API
 * externa, zero Gemini, zero TMDB e zero WordPress/MN26 no render. So renderiza
 * artigo publicavel (traducao pt-BR + review + publishedAt + licenca/display);
 * caso contrario `notFound`. Nada e inventado: autor, categoria, data, fonte,
 * corpo e relacionados so aparecem quando existem. Corpo fino -> noindex.
 *
 * Render dinamico (le PostgreSQL por request; nao pre-renderiza no build).
 */

export const dynamic = "force-dynamic";

const NEWS_INDEX_PATH = "/pt/noticias/";

const ENTITY_LABELS: Readonly<Record<NewsRelatedEntityType, string>> = {
  movie: "Filme",
  tv: "Serie",
  person: "Pessoa",
};

interface NewsArticleParams {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<NewsArticleParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getNewsArticleData(slug);

  if (data === null) {
    return {
      title: "Noticia nao encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title = view.metaTitle ?? `${view.title} - Noticias`;
  const description = view.metaDescription ?? view.deck;

  const metadata: Metadata = {
    title,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  if (description !== null) metadata.description = description;
  return metadata;
}

export default async function NewsArticlePage({
  params,
}: {
  params: Promise<NewsArticleParams>;
}) {
  const { slug } = await params;
  const data = await getNewsArticleData(slug);
  if (data === null) notFound();

  const { view, indexability, canonicalUrl } = data;
  const isUnderReview = indexability.decision !== "index";
  const heroMeta = [view.author, view.dateLabel, view.readTimeLabel].filter(
    (item): item is string => item !== null,
  );

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/pt/` },
      { "@type": "ListItem", position: 2, name: "Noticias", item: `${SITE_URL}${NEWS_INDEX_PATH}` },
      { "@type": "ListItem", position: 3, name: view.title, item: canonicalUrl },
    ],
  };

  const articleJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: view.title,
    url: canonicalUrl,
  };
  if (view.dateIso !== null) articleJsonLd.datePublished = view.dateIso;
  const jsonDescription = view.metaDescription ?? view.deck;
  if (jsonDescription !== null) articleJsonLd.description = jsonDescription;
  if (view.author !== null) {
    articleJsonLd.author = { "@type": "Person", name: view.author };
  }
  if (view.category !== null) articleJsonLd.articleSection = view.category;
  if (view.heroImage !== null) {
    articleJsonLd.image = `${SITE_URL}${view.heroImage.src}`;
  }

  return (
    <main className="news-article" data-vertical="news">
      <header className={`news-article__hero${view.heroImage ? " news-article__hero--real" : ""}`}>
        {view.heroImage !== null ? (
          <img
            src={view.heroImage.src}
            alt=""
            width={view.heroImage.width}
            height={view.heroImage.height}
            className="news-article__hero-image"
          />
        ) : null}
        <div className="news-article__hero-inner">
          <nav className="breadcrumb breadcrumb--onhero" aria-label="Trilha de navegacao">
            <ol>
              <li>
                <a href="/pt/">Inicio</a>
              </li>
              <li>
                <a href={NEWS_INDEX_PATH}>Noticias</a>
              </li>
              <li aria-current="page">{view.title}</li>
            </ol>
          </nav>
          {view.category !== null ? (
            <p className="news-article__badge">
              <span className="screena-badge screena-badge--news">{view.category}</span>
            </p>
          ) : null}
          <h1 className="news-article__title">{view.title}</h1>
          {view.deck !== null ? (
            <p className="news-article__deck">{view.deck}</p>
          ) : null}
          {heroMeta.length > 0 ? (
            <p className="news-article__meta">{heroMeta.join(" · ")}</p>
          ) : null}
        </div>
      </header>

      <div className="container">
        <article className="news-article__body">
          {view.bodyParagraphs.map((paragraph, index) => (
            <p key={index} className="news-article__paragraph">
              {paragraph}
            </p>
          ))}

          {view.source !== null ? (
            <p className="news-article__source">
              Fonte: <span className="news-article__source-name">{view.source.name}</span>
            </p>
          ) : null}

          {view.aiAssisted ? (
            <aside className="news-article__ai" role="note">
              Este conteudo pode ter sido produzido com auxilio de ferramentas de
              inteligencia artificial e revisado pela equipe editorial da Screena.
              Imagens sao meramente ilustrativas.
            </aside>
          ) : null}
        </article>

        {view.related.length > 0 ? (
          <section className="news-article__related" aria-labelledby="news-related-title">
            <h2 id="news-related-title" className="news-article__related-title">
              Relacionado
            </h2>
            <ul className="news-related">
              {view.related.map((entity) => (
                <li key={entity.href} className="news-related__item">
                  <a className="news-related__link" href={entity.href}>
                    {entity.title}
                  </a>
                  <span className="news-related__type">{ENTITY_LABELS[entity.entityType]}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isUnderReview ? (
          <p className="news-article__notice" data-editorial-state="in-review">
            Esta noticia ainda esta em revisao editorial.
          </p>
        ) : null}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
