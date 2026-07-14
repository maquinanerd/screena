import type { Metadata } from "next";
import { Fragment } from "react";

import { AdSlot } from "../../_components/ad-slot";
import type { NewsCardView } from "../../../src/lib/news-presenter";
import { SITE_URL } from "../../../src/lib/site";
import { getNewsIndexData } from "../../../src/server/news-pages";
import styles from "./news-canonical.module.css";

/** Página editorial `03-news` do pacote canônico, ligada ao CMS real. */

export const dynamic = "force-dynamic";

const TITLE = "Notícias";
const DESCRIPTION =
  "Últimas notícias e análises editoriais da Screen sobre cinema e séries, em português.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getNewsIndexData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
}

function CardImage({
  card,
  className,
}: {
  card: NewsCardView;
  className?: string;
}) {
  return (
    <span className={className}>
      {card.image !== null ? (
        <img
          src={card.image.src}
          alt=""
          width={card.image.width}
          height={card.image.height}
          loading="lazy"
        />
      ) : null}
      <span className={styles.imageScrim} aria-hidden="true" />
    </span>
  );
}

function Byline({ card, light = false }: { card: NewsCardView; light?: boolean }) {
  if (card.dateLabel === null && card.author === null) return null;
  return (
    <span className={light ? styles.bylineLight : styles.byline}>
      {card.dateLabel !== null ? <span>{card.dateLabel}</span> : null}
      {card.dateLabel !== null && card.author !== null ? (
        <span aria-hidden="true">·</span>
      ) : null}
      {card.author !== null ? (
        <span>
          por <strong>{card.author}</strong>
        </span>
      ) : null}
    </span>
  );
}

function MagazineMiniCard({ card }: { card: NewsCardView }) {
  return (
    <article className={styles.magazineMiniArticle}>
      <a href={card.href} className={styles.magazineMini}>
        <CardImage card={card} className={styles.magazineMiniImage} />
        <h3>{card.title}</h3>
        {card.deck !== null ? <p>{card.deck}</p> : null}
        <Byline card={card} />
      </a>
    </article>
  );
}

function FeedCard({ card }: { card: NewsCardView }) {
  const hasPrimaryMeta = card.author !== null || card.dateLabel !== null;
  return (
    <article className={styles.feedCard}>
      <a className={styles.feedCardLink} href={card.href}>
        <CardImage card={card} className={styles.feedImage} />
        <div className={styles.feedCopy}>
          {card.category !== null ? (
            <span className={styles.feedCategory}>{card.category}</span>
          ) : null}
          <h3>{card.title}</h3>
          {card.deck !== null ? <p>{card.deck}</p> : null}
          <span className={styles.feedMeta}>
            {card.author !== null ? <strong>{card.author}</strong> : null}
            {card.author !== null && card.dateLabel !== null ? (
              <span aria-hidden="true">·</span>
            ) : null}
            {card.dateLabel !== null ? <span>{card.dateLabel}</span> : null}
            {card.readTimeLabel !== null ? (
              <>
                {hasPrimaryMeta ? <span aria-hidden="true">·</span> : null}
                <span>{card.readTimeLabel}</span>
              </>
            ) : null}
          </span>
        </div>
      </a>
    </article>
  );
}

export default async function NewsIndexPage() {
  const { view, canonicalUrl } = await getNewsIndexData();
  const orderedCards = [view.featured, ...view.cards].filter(
    (card): card is NewsCardView => card !== null,
  );
  const lead = view.featured;
  const magazineCards = view.cards.slice(0, 3);
  const feedCards = view.cards.slice(3);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      { "@type": "ListItem", position: 2, name: TITLE, item: canonicalUrl },
    ],
  };

  const collectionJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  };
  if (orderedCards.length > 0) {
    collectionJsonLd.mainEntity = {
      "@type": "ItemList",
      numberOfItems: orderedCards.length,
      itemListElement: orderedCards.map((card, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    };
  }

  return (
    <main className={styles.page} data-vertical="news">
      <h1 className="u-visually-hidden">{TITLE}</h1>

      <div className={styles.channelHeader}>
        <div className={styles.channelRow}>
          <nav className={styles.tabs} aria-label="Seções de notícias">
            <span aria-current="page">Todas</span>
          </nav>
          <div className={styles.headerAd}>
            <AdSlot variant="leaderboard" margin="0" />
          </div>
        </div>
        <div className={styles.channelRule} />
      </div>

      {lead !== null ? (
        <section className={styles.magazine} aria-labelledby="news-lead-title">
          <div className={styles.magazineGrid}>
            <div className={styles.magazineMain}>
              <article className={styles.magazineLead}>
                <a href={lead.href} className={styles.magazineLeadLink}>
                  <div className={styles.leadCopy}>
                    {lead.category !== null ? (
                      <span className={styles.leadCategory}>{lead.category}</span>
                    ) : null}
                    <h2 id="news-lead-title">{lead.title}</h2>
                    <Byline card={lead} />
                    {lead.deck !== null ? <p>{lead.deck}</p> : null}
                    <span className={styles.readMore}>
                      Ler mais <span aria-hidden="true">→</span>
                    </span>
                  </div>
                  <span className={styles.leadImageVisual} aria-hidden="true">
                    <CardImage card={lead} className={styles.leadImage} />
                  </span>
                </a>
              </article>

              {magazineCards.length > 0 ? (
                <div className={styles.magazineCards}>
                  {magazineCards.map((card) => (
                    <MagazineMiniCard key={card.href} card={card} />
                  ))}
                </div>
              ) : null}
            </div>
            <div className={styles.magazineRail} aria-hidden="true" />
          </div>
        </section>
      ) : (
        <p className={styles.empty}>Ainda não há notícias publicadas nesta seção.</p>
      )}

      <div className={styles.leaderboardShell}>
        <AdSlot variant="leaderboard" margin="56px 0 0" />
      </div>

      {feedCards.length > 0 ? (
        <section className={styles.feedLayout} aria-labelledby="news-feed-title">
          <div>
            <div className={styles.sectionTitle}>
              <span aria-hidden="true" />
              <h2 id="news-feed-title">Últimas notícias</h2>
            </div>
            <div>
              {feedCards.map((card, index) => (
                <Fragment key={card.href}>
                  <FeedCard card={card} />
                  {index === 2 ? (
                    <div className={styles.inlineAd}>
                      <AdSlot variant="leaderboard" margin="0 0 4px" />
                    </div>
                  ) : null}
                </Fragment>
              ))}
            </div>
            {view.hasMore ? (
              <p className={styles.moreCount}>
                Mostrando {orderedCards.length} de {view.totalCount} notícias.
              </p>
            ) : null}
          </div>
          <aside className={styles.feedRail} aria-label="Publicidade">
            <AdSlot variant="skyscraper" margin="0" />
          </aside>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
