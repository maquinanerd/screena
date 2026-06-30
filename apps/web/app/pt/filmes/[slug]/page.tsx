import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMoviePageData } from "../../../../src/server/movie-page";
import { MOVIES_INDEX_PATH, SITE_URL } from "../../../../src/lib/site";

/**
 * Pagina publica de filme — /pt/filmes/[slug]/ (schema Movie, acento vermelho).
 *
 * INVARIANTES 3 e 4: server component puro. Le dados SO do PostgreSQL via a
 * camada server-only (`getMoviePageData`) — zero API externa e zero Gemini no
 * render. A revalidacao ISR re-le o snapshot do banco, nunca uma fonte externa.
 *
 * Gate anti-thin (invariante 5): sem `>= 2` blocos renderizaveis, a pagina
 * existe mas recebe `robots=noindex` (decisao de `evaluateMovieIndexability`).
 *
 * Diferenciacao filme/serie (invariante 11) por CINCO sinais simultaneos:
 * label ("Filme") + badge + breadcrumb (/pt/filmes/) + schema (Movie) + URL.
 */

/** ISR: regenera o HTML a partir do PostgreSQL a cada hora (nunca da rede externa). */
export const revalidate = 3600;

interface MoviePageParams {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<MoviePageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getMoviePageData(slug);

  if (data === null) {
    return {
      title: "Filme nao encontrado",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title =
    view.metaTitle ??
    `${view.title}${view.year !== null ? ` (${view.year})` : ""} — Filme`;

  const metadata: Metadata = {
    title,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  // Nunca inventar sinopse: so define description quando ela ja existe no banco.
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription;
  }
  return metadata;
}

export default async function MoviePage({
  params,
}: {
  params: Promise<MoviePageParams>;
}) {
  const { slug } = await params;
  const data = await getMoviePageData(slug);
  if (data === null) notFound();

  const { view, indexability, canonicalUrl } = data;
  const isUnderReview = indexability.decision !== "index";

  // Metadados visiveis (ano · duracao): so o que existe no payload — nada inventado.
  const metaParts: string[] = [];
  if (view.year !== null) metaParts.push(String(view.year));
  if (view.runtimeLabel !== null) metaParts.push(view.runtimeLabel);

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Filmes",
        item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
      },
      { "@type": "ListItem", position: 3, name: view.title, item: canonicalUrl },
    ],
  };

  // Schema `Movie`: SEM AggregateRating (nenhuma nota nesta fase; jamais fingir
  // nota propria). So campos que existem no payload entram no JSON-LD.
  const movieJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: view.title,
    url: canonicalUrl,
  };
  if (view.year !== null) movieJsonLd.datePublished = String(view.year);
  if (view.metaDescription !== null) movieJsonLd.description = view.metaDescription;

  return (
    <main className="movie-page">
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href="/pt/">Inicio</a>
            </li>
            <li>
              <a href={MOVIES_INDEX_PATH}>Filmes</a>
            </li>
            <li aria-current="page">{view.title}</li>
          </ol>
        </nav>

        <article className="movie" data-vertical="movie">
          <header className="movie__header">
            {/* Badge + label textual: dois dos cinco sinais da invariante 11. */}
            <p className="movie__kicker">
              <span data-vertical="movie" className="screena-badge screena-badge--movie">
                Filme
              </span>
            </p>

            <h1 className="movie__title">{view.title}</h1>

            {metaParts.length > 0 ? (
              <p className="movie__meta">{metaParts.join(" · ")}</p>
            ) : null}
          </header>

          <div className="movie__blocks">
            {view.blocks.map((block) => (
              <section key={block.blockType} className="movie-block" data-block-type={block.blockType}>
                <p className="movie-block__body">{block.content}</p>
              </section>
            ))}
          </div>

          {isUnderReview ? (
            <p className="review-notice" data-editorial-state="in-review">
              Esta pagina ainda esta em revisao editorial.
            </p>
          ) : null}
        </article>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(movieJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
