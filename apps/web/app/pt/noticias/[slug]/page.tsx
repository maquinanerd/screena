import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import { AdSlot } from "../../../_components/ad-slot";
import type { NewsRelatedEntityType } from "../../../../src/lib/news-presenter";
import { SITE_URL } from "../../../../src/lib/site";
import { getNewsArticleData } from "../../../../src/server/news-pages";
import styles from "./article-canonical.module.css";

/** Artigo `05-article` do pacote canônico, alimentado somente pelo CMS real. */

export const dynamic = "force-dynamic";

const NEWS_INDEX_PATH = "/pt/noticias/";

const ENTITY_LABELS: Readonly<Record<NewsRelatedEntityType, string>> = {
  movie: "Filme",
  tv: "Série",
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
      title: "Notícia não encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.title} — Notícias`,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  const description = view.metaDescription ?? view.deck;
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
  const adAfterIndex = Math.min(2, Math.max(0, view.bodyParagraphs.length - 1));

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Notícias",
        item: `${SITE_URL}${NEWS_INDEX_PATH}`,
      },
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
    <main className={styles.page} data-vertical="news">
      <header
        className={`${styles.hero}${view.heroImage !== null ? ` ${styles.heroWithImage}` : ""}`}
      >
        {view.heroImage !== null ? (
          <img
            src={view.heroImage.src}
            alt=""
            width={view.heroImage.width}
            height={view.heroImage.height}
            className={styles.heroImage}
          />
        ) : null}
        <span className={styles.heroScrim} aria-hidden="true" />
        <div className={styles.heroInner}>
          <nav className={styles.breadcrumb} aria-label="Trilha de navegação">
            <a href="/pt/">Início</a>
            <span aria-hidden="true">›</span>
            <a href={NEWS_INDEX_PATH}>Notícias</a>
            {view.category !== null ? (
              <>
                <span aria-hidden="true">›</span>
                <span aria-current="page">{view.category}</span>
              </>
            ) : null}
          </nav>

          {view.category !== null ? (
            <span className={styles.category}>{view.category}</span>
          ) : null}
          <h1>{view.title}</h1>
          {view.deck !== null ? <p className={styles.deck}>{view.deck}</p> : null}
          <div className={styles.heroMeta}>
            {view.author !== null ? (
              <span>
                por <strong>{view.author}</strong>
              </span>
            ) : null}
            {view.author !== null && view.dateLabel !== null ? (
              <span aria-hidden="true">·</span>
            ) : null}
            {view.dateLabel !== null ? <span>{view.dateLabel}</span> : null}
            {(view.author !== null || view.dateLabel !== null) &&
            view.readTimeLabel !== null ? (
              <span aria-hidden="true">·</span>
            ) : null}
            {view.readTimeLabel !== null ? <span>{view.readTimeLabel}</span> : null}
          </div>
        </div>
      </header>

      <article className={styles.body}>
        {view.bodyParagraphs.map((paragraph, index) => (
          <Fragment key={`${index}-${paragraph.slice(0, 24)}`}>
            <p>{paragraph}</p>
            {index === adAfterIndex ? (
              <div className={styles.midArticleAd}>
                <AdSlot variant="leaderboard" margin="0" />
              </div>
            ) : null}
          </Fragment>
        ))}

        {view.source !== null ? (
          <p className={styles.source}>
            Fonte: <strong>{view.source.name}</strong>
          </p>
        ) : null}

        {view.aiAssisted ? (
          <aside className={styles.aiNotice} role="note">
            Conteúdo produzido com apoio de ferramentas de inteligência artificial
            e revisado pela equipe editorial da Screen.
          </aside>
        ) : null}
      </article>

      {view.related.length > 0 ? (
        <section className={styles.related} aria-labelledby="news-related-title">
          <div className={styles.relatedTitle}>
            <span aria-hidden="true" />
            <h2 id="news-related-title">Relacionado</h2>
          </div>
          <ul>
            {view.related.map((entity) => (
              <li key={entity.href}>
                <a href={entity.href}>{entity.title}</a>
                <span>{ENTITY_LABELS[entity.entityType]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isUnderReview ? (
        <p className={styles.reviewNotice} data-editorial-state="in-review">
          Esta notícia ainda está em revisão editorial.
        </p>
      ) : null}

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
