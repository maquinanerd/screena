import type { Metadata } from "next";

import { NewsCard } from "../../_components/news-card";
import {
  Breadcrumbs,
  EmptyState,
  PageIntro,
  SectionHeader,
} from "../../_components/page-primitives";
import { getNewsIndexData } from "../../../src/server/news-pages";
import { EXPLORE_PATH, SITE_URL } from "../../../src/lib/site";

/**
 * Listagem publica de noticias - /pt/noticias/ (ambiente editorial/blog; NEUTRO).
 *
 * Server component puro: le somente PostgreSQL via `getNewsIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Lista so artigos publicaveis
 * (traducao pt-BR + review + slug/titulo + publishedAt + licenca/display). Sem
 * dado inventado. `noindex` fica restrito aos estados tecnicos definidos pelo
 * avaliador canonico de indexabilidade.
 *
 * Render dinamico (le PostgreSQL por request; nao pre-renderiza no build sem
 * DATABASE_URL) - mesma natureza das listagens de filme/serie/pessoa.
 */

export const dynamic = "force-dynamic";

const TITLE = "Notícias";
const DESCRIPTION =
  "Últimas notícias e análises editoriais do Screen sobre cinema e séries, em português.";

export async function generateMetadata(): Promise<Metadata> {
  const { indexability, canonicalUrl } = await getNewsIndexData();
  const shouldIndex = indexability.decision === "index";
  return {
    title: TITLE,
    description: DESCRIPTION,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
}

export default async function NewsIndexPage() {
  const { view, canonicalUrl } = await getNewsIndexData();
  const orderedCards = [view.featured, ...view.cards].filter(
    (card): card is NonNullable<typeof card> => card !== null,
  );
  const hasItems = orderedCards.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      { "@type": "ListItem", position: 2, name: "Notícias", item: canonicalUrl },
    ],
  };

  const collectionJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    url: canonicalUrl,
    description: DESCRIPTION,
  };
  if (hasItems) {
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
    <main className="news-index" data-vertical="news">
      <div className="container">
        <Breadcrumbs items={[{ label: "Início", href: "/pt/" }, { label: TITLE }]} />

        <PageIntro title={TITLE} description={DESCRIPTION} vertical="news" />

        {hasItems ? (
          <>
            {view.featured !== null ? (
              <section className="news-index__featured" aria-label="Destaque">
                <NewsCard card={view.featured} variant="featured" headingLevel={2} eager />
              </section>
            ) : null}

            {view.cards.length > 0 ? (
              <section className="news-index__feed" aria-labelledby="news-index-feed-title">
                <SectionHeader
                  id="news-index-feed-title"
                  title="Últimas notícias"
                  vertical="news"
                />
                <ul className="news-grid">
                  {view.cards.map((card) => (
                    <li key={card.href} className="news-grid__item">
                      <NewsCard card={card} variant="feed" />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {view.hasMore ? (
              <p className="news-index__more">
                Mostrando as primeiras {orderedCards.length} de {view.totalCount}.
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState
            title="Ainda não há notícias publicadas."
            description="A redação do Screen ainda não publicou notícias nesta seção."
            action={{ label: "Explorar o catálogo", href: EXPLORE_PATH }}
          />
        )}
      </div>

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
