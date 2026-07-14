import type { ReactNode } from "react";

import type { HomeUpcomingMovie } from "../../src/lib/home-upcoming-presenter";
import type {
  NewsCardView,
  NewsIndexView,
} from "../../src/lib/news-presenter";
import { NEWS_INDEX_PATH, SITE_URL } from "../../src/lib/site";
import { AdSlot } from "./ad-slot";
import styles from "./category-home.module.css";

type CategoryVertical = "movie" | "series";

interface CategoryHomeProps {
  readonly canonicalUrl: string;
  readonly description: string;
  readonly pageTitle: string;
  readonly vertical: CategoryVertical;
  readonly newsView: NewsIndexView;
  readonly upcoming?: readonly HomeUpcomingMovie[];
}

function uniqueNewsCards(view: NewsIndexView): NewsCardView[] {
  const candidates = [
    ...(view.featured === null ? [] : [view.featured]),
    ...view.cards,
  ];
  const seen = new Set<string>();
  const cards: NewsCardView[] = [];

  for (const card of candidates) {
    if (seen.has(card.href)) continue;
    seen.add(card.href);
    cards.push(card);
    if (cards.length === 5) break;
  }

  return cards;
}

function SectionHeading({
  description,
  id,
  title,
}: {
  readonly description?: string;
  readonly id: string;
  readonly title: string;
}): ReactNode {
  return (
    <header className={styles.sectionHeader}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionAccent} aria-hidden="true" />
        <h2 id={id} className={styles.sectionTitle}>
          {title}
        </h2>
      </div>
      {description !== undefined ? (
        <p className={styles.sectionDescription}>{description}</p>
      ) : null}
    </header>
  );
}

function NewsImage({ item }: { readonly item: NewsCardView }): ReactNode {
  if (item.image === null) return null;
  return (
    <img
      className={styles.newsImage}
      src={item.image.src}
      alt=""
      width={item.image.width}
      height={item.image.height}
      loading="lazy"
    />
  );
}

function NewsFeature({ item }: { readonly item: NewsCardView }): ReactNode {
  return (
    <a className={styles.newsFeature} href={item.href}>
      <NewsImage item={item} />
      <span className={styles.newsScrim} aria-hidden="true" />
      <div className={styles.newsFeatureCopy}>
        {item.category !== null ? (
          <span className={styles.newsBadge}>{item.category}</span>
        ) : null}
        <h3 className={styles.newsFeatureTitle}>{item.title}</h3>
        {item.deck !== null ? (
          <span className={styles.newsFeatureDeck}>{item.deck}</span>
        ) : null}
      </div>
    </a>
  );
}

function NewsMini({ item }: { readonly item: NewsCardView }): ReactNode {
  return (
    <a className={styles.newsMini} href={item.href}>
      <NewsImage item={item} />
      <span className={styles.newsScrim} aria-hidden="true" />
      <div className={styles.newsMiniCopy}>
        <h3 className={styles.newsMiniTitle}>{item.title}</h3>
        {item.deck !== null ? (
          <span className={styles.newsMiniDeck}>{item.deck}</span>
        ) : null}
      </div>
    </a>
  );
}

function AdShell({
  margin,
  variant,
}: {
  readonly margin: "56px 0 0" | "72px 0 0";
  readonly variant: "billboard" | "leaderboard";
}): ReactNode {
  return (
    <div className={styles.adShell}>
      <AdSlot margin={margin} variant={variant} />
    </div>
  );
}

export function CategoryHome({
  canonicalUrl,
  description,
  newsView,
  pageTitle,
  upcoming = [],
  vertical,
}: CategoryHomeProps): ReactNode {
  const comingCards = vertical === "movie" ? upcoming.slice(0, 4) : [];
  const newsCards = uniqueNewsCards(newsView);
  const featuredNews = newsCards[0] ?? null;
  const secondaryNews = newsCards.slice(1, 5);

  const collectionJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: pageTitle,
    url: canonicalUrl,
    description,
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: `${SITE_URL}/pt/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: pageTitle,
        item: canonicalUrl,
      },
    ],
  };

  return (
    <main className={styles.page} data-vertical={vertical}>
      <header className={styles.categoryIntro}>
        <h1 className={styles.categoryTitle}>{pageTitle}</h1>
        <p className={styles.categoryDescription}>{description}</p>
      </header>

      {/* Hero e Top 10 exigem destaque curado/ranking real e ficam ocultos. */}
      <AdShell margin="56px 0 0" variant="leaderboard" />

      {/* Streaming e ranking dependem de contratos ausentes e ficam omitidos. */}

      {/* 2. Billboard: posição canônica entre ranking e Coming. */}
      <AdShell margin="72px 0 0" variant="billboard" />

      {comingCards.length > 0 ? (
        <section
          className={styles.comingSection}
          aria-labelledby="category-coming-title"
        >
          <SectionHeading
            id="category-coming-title"
            title="Em breve"
            description="Próximos lançamentos"
          />
          <div className={styles.comingGrid}>
            {comingCards.map((item) => (
              <a className={styles.comingCard} href={item.href} key={item.href}>
                <span className={styles.comingMedia}>
                  {item.imageUrl !== null ? (
                    <img
                      className={styles.comingImage}
                      src={item.imageUrl}
                      alt=""
                      width={780}
                      height={439}
                      loading="lazy"
                    />
                  ) : null}
                  <span className={styles.comingScrim} aria-hidden="true" />
                </span>
                <span className={styles.comingDate}>{item.date}</span>
                <h3 className={styles.comingTitle}>{item.title}</h3>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* 3. Leaderboard: imediatamente antes de Top News. */}
      <AdShell margin="56px 0 0" variant="leaderboard" />

      {featuredNews !== null ? (
        <section
          className={styles.newsSection}
          aria-labelledby="category-news-title"
        >
          <div className={styles.newsHeader}>
            <div className={styles.sectionTitleRow}>
              <span className={styles.sectionAccent} aria-hidden="true" />
              <h2 id="category-news-title" className={styles.sectionTitle}>
                Top News
              </h2>
            </div>
            <a className={styles.newsMore} href={NEWS_INDEX_PATH}>
              Ver tudo <span aria-hidden="true">›</span>
            </a>
          </div>
          <div className={styles.newsGrid}>
            <NewsFeature item={featuredNews} />
            {secondaryNews.length > 0 ? (
              <div className={styles.newsMiniGrid}>
                {secondaryNews.map((item) => (
                  <NewsMini item={item} key={item.href} />
                ))}
              </div>
            ) : null}
          </div>
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
