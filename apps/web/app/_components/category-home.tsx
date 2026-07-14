import type { ReactNode } from "react";

import type {
  EntityCard,
  EntityIndexView,
} from "../../src/lib/entity-index-presenter";
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
  readonly view: EntityIndexView;
  readonly vertical: CategoryVertical;
  readonly newsView: NewsIndexView;
  readonly upcoming?: readonly HomeUpcomingMovie[];
}

const KIND_LABEL: Readonly<Record<CategoryVertical, string>> = {
  movie: "Filme",
  series: "Série",
};

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

function CatalogCard({
  card,
  vertical,
}: {
  readonly card: EntityCard;
  readonly vertical: CategoryVertical;
}): ReactNode {
  return (
    <a className={styles.catalogCard} href={card.href}>
      <div className={styles.catalogMedia}>
        {card.image !== null ? (
          <img
            className={styles.catalogImage}
            src={card.image.src}
            alt={`Pôster de ${card.title}`}
            width={card.image.width}
            height={card.image.height}
            loading="lazy"
          />
        ) : null}
        <span className={styles.catalogScrim} aria-hidden="true" />
        <span className={styles.catalogBadge}>{KIND_LABEL[vertical]}</span>
        <div className={styles.catalogCopy}>
          <h3 className={styles.catalogTitle}>{card.title}</h3>
          {card.meta !== null ? (
            <span className={styles.catalogMeta}>{card.meta}</span>
          ) : null}
        </div>
      </div>
    </a>
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

function CategoryHero({
  fallbackTitle,
  hero,
  vertical,
}: {
  readonly fallbackTitle: string;
  readonly hero: EntityCard | null;
  readonly vertical: CategoryVertical;
}): ReactNode {
  return (
    <section className={styles.hero} aria-labelledby="category-page-title">
      <span className={styles.heroBase} aria-hidden="true" />
      <span className={styles.heroDepthScrim} aria-hidden="true" />
      <span className={styles.heroVerticalScrim} aria-hidden="true" />
      <div className={styles.heroInner}>
        <div className={styles.heroLead}>
          <h1 id="category-page-title" className={styles.heroTitle}>
            {hero?.title ?? fallbackTitle}
          </h1>
          {hero !== null ? (
            <>
              <div className={styles.heroMeta} aria-label="Informações do título">
                <span>{KIND_LABEL[vertical]}</span>
                {hero.meta !== null ? (
                  <>
                    <span className={styles.heroSeparator} aria-hidden="true">
                      ·
                    </span>
                    <span>{hero.meta}</span>
                  </>
                ) : null}
              </div>
              <div className={styles.heroActions}>
                <a className={styles.heroDetails} href={hero.href}>
                  Ver detalhes
                </a>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
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
  view,
}: CategoryHomeProps): ReactNode {
  const hero = view.cards[0] ?? null;
  const catalogCards = view.cards.slice(1, 5);
  const visibleEntityCards = hero === null ? [] : [hero, ...catalogCards];
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
  if (visibleEntityCards.length > 0) {
    collectionJsonLd.mainEntity = {
      "@type": "ItemList",
      numberOfItems: visibleEntityCards.length,
      itemListElement: visibleEntityCards.map((card, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    };
  }

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
      <CategoryHero
        fallbackTitle={pageTitle}
        hero={hero}
        vertical={vertical}
      />

      {catalogCards.length > 0 ? (
        <section
          className={styles.catalogSection}
          aria-labelledby="category-catalog-title"
        >
          <SectionHeading
            id="category-catalog-title"
            title={`Catálogo de ${pageTitle.toLowerCase()}`}
            description="Títulos publicados na Screen"
          />
          <div className={styles.catalogGrid}>
            {catalogCards.map((card) => (
              <CatalogCard key={card.href} card={card} vertical={vertical} />
            ))}
          </div>
        </section>
      ) : null}

      {/* 1. Leaderboard: após a primeira grade, como em 04-cat-home. */}
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
