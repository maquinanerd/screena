import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getMoviePageData } from "../../../../src/server/movie-page";
import { MOVIES_INDEX_PATH, SITE_URL } from "../../../../src/lib/site";

/**
 * Pagina publica de filme — /pt/filmes/[slug]/ (schema Movie, acento vermelho).
 *
 * Tela "Movie Detail" do handoff de design (White Cinematic Editorial): header
 * editorial (badge "Filme" + titulo + ano + duracao), faixa de midia como
 * PLACEHOLDER visual decorativo (sem dados falsos), blocos editoriais reais e
 * card lateral "Resumo sem spoilers" quando o bloco existir. Ratings, onde
 * assistir, elenco, bilheteria, premios e relacionados ficam FORA DE ESCOPO
 * nesta fase — sao omitidos (nunca placeholders que finjam features).
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

/** content_block cujo texto, quando presente, vira o card lateral sem spoilers. */
const SUMMARY_BLOCK_TYPE = "summary_without_spoilers";

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

  // Duracao visivel (so o que existe no payload; ano vai no titulo, nao aqui).
  const runtimeLabel = view.runtimeLabel;

  // Particiona os blocos ja aprovados: o "resumo sem spoilers" (quando existir)
  // vira card lateral; os demais formam a coluna editorial. Cada bloco aparece
  // exatamente uma vez — nada e escondido, nada e inventado.
  const summaryBlock =
    view.blocks.find((block) => block.blockType === SUMMARY_BLOCK_TYPE) ?? null;
  const mainBlocks = view.blocks.filter(
    (block) => block.blockType !== SUMMARY_BLOCK_TYPE,
  );
  const hasEditorial = mainBlocks.length > 0 || summaryBlock !== null;

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
    <main className="movie-page" data-vertical="movie">
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

            <h1 className="movie__title">
              {view.title}
              {view.year !== null ? (
                <span className="movie__year"> ({view.year})</span>
              ) : null}
            </h1>

            {runtimeLabel !== null ? (
              <p className="movie__meta">{runtimeLabel}</p>
            ) : null}
          </header>
        </article>
      </div>

      {/* Faixa de midia: placeholder visual decorativo (handoff §3.6) — poster
          a esquerda, palco de trailer/cena ao centro (com botao de play) e tres
          tiles a direita. Sem <img> inventado, sem contagens falsas, sem dados de
          terceiros — apenas o skeleton cinematografico. aria-hidden: nada de
          informativo para leitores de tela. */}
      <div className="movie-media" aria-hidden="true">
        <div className="movie-media__grid">
          <div className="movie-media__poster" />
          <div className="movie-media__stage">
            <span className="movie-media__play" />
          </div>
          <div className="movie-media__tiles">
            <span className="movie-media__tile" />
            <span className="movie-media__tile" />
            <span className="movie-media__tile" />
          </div>
        </div>
      </div>

      <div className="container">
        {hasEditorial ? (
          <section className="movie-editorial">
            <div className="movie-editorial__main">
              {mainBlocks.map((block) => (
                <div
                  key={block.blockType}
                  className="movie-block"
                  data-block-type={block.blockType}
                >
                  <p className="movie-block__body">{block.content}</p>
                </div>
              ))}
            </div>

            {summaryBlock !== null ? (
              <aside className="movie-aside">
                <div className="spoiler-card" data-block-type={summaryBlock.blockType}>
                  <p className="spoiler-card__label">Resumo sem spoilers</p>
                  <p className="spoiler-card__body">{summaryBlock.content}</p>
                </div>
              </aside>
            ) : null}
          </section>
        ) : null}

        {isUnderReview ? (
          <p className="review-notice" data-editorial-state="in-review">
            Esta pagina ainda esta em revisao editorial.
          </p>
        ) : null}
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
