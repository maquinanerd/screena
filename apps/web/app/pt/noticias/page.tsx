import type { Metadata } from "next";

import { NewsCard } from "../../_components/news-card";
import { getNewsIndexData } from "../../../src/server/news-pages";
import { SITE_URL } from "../../../src/lib/site";

/**
 * Listagem publica de noticias - /pt/noticias/ (ambiente editorial/blog; NEUTRO).
 *
 * Server component puro: le somente PostgreSQL via `getNewsIndexData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Lista so artigos publicaveis
 * (traducao pt-BR + review + slug/titulo + publishedAt + licenca/display). Sem
 * dado inventado. Listagem vazia/fina -> noindex.
 *
 * Render dinamico (le PostgreSQL por request; nao pre-renderiza no build sem
 * DATABASE_URL) - mesma natureza das listagens de filme/serie/pessoa.
 */

export const dynamic = "force-dynamic";

const TITLE = "Noticias";
const DESCRIPTION =
  "Ultimas noticias e analises editoriais da Screen sobre cinema e series, em portugues.";

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
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/pt/` },
      { "@type": "ListItem", position: 2, name: "Noticias", item: canonicalUrl },
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
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href="/pt/">Inicio</a>
            </li>
            <li aria-current="page">Noticias</li>
          </ol>
        </nav>

        <header className="news-index__header">
          <h1 className="news-index__title">{TITLE}</h1>
          <p className="news-index__desc">{DESCRIPTION}</p>
        </header>

        {hasItems ? (
          <>
            {view.featured !== null ? (
              <section className="news-index__featured" aria-label="Destaque">
                <NewsCard card={view.featured} variant="featured" />
              </section>
            ) : null}

            {view.cards.length > 0 ? (
              <section className="news-index__feed" aria-label="Ultimas noticias">
                <h2 className="news-index__feed-title">Ultimas noticias</h2>
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
          <p className="news-index__empty">
            Ainda nao ha noticias publicadas nesta secao.
          </p>
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
