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

        {/* Top info bar — variacao SEGURA da rota real: so a coluna principal
            (titulo, ano, badge, sinopse curta). As colunas "Avaliacoes" e "Onde
            assistir" do design NAO sao renderizadas aqui enquanto nao houver
            ratings/streaming reais — exibir esses headings vazios pareceria
            feature falsa. Os placeholders decorativos ficam SO na preview
            (/dev/movie-page-preview). Nada de nota, logo ou plataforma inventada. */}
        <section className="movie-topbar movie-topbar--solo" data-vertical="movie">
          <div className="movie-topbar__lead">
            <h1 className="movie-topbar__title">
              {view.title}
              {view.year !== null ? (
                <span className="movie-topbar__year"> ({view.year})</span>
              ) : null}
            </h1>
            {/* Badge + label textual: dois dos cinco sinais da invariante 11. */}
            <p className="movie-topbar__badge">
              <span data-vertical="movie" className="screena-badge screena-badge--movie">
                Filme
              </span>
            </p>
            {runtimeLabel !== null ? (
              <p className="movie-topbar__meta">{runtimeLabel}</p>
            ) : null}
            {view.metaDescription !== null ? (
              <p className="movie-topbar__synopsis">{view.metaDescription}</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* Faixa de midia full-bleed do design (grid 1fr/3fr/2fr, 540px): poster,
          palco de trailer/cena (com botao de play) e tres tiles. 100% decorativa
          (aria-hidden): sem <img> inventado, sem legendas/contagens, sem rotulos
          de feature — apenas a composicao cinematografica. */}
      <div className="movie-media" aria-hidden="true">
        <div className="movie-media__grid">
          <div className="movie-media__poster" />
          <div className="movie-media__stage">
            <span className="movie-media__play">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M7 4.6v14.8L19.5 12z" />
              </svg>
            </span>
          </div>
          <div className="movie-media__tiles">
            <span className="movie-media__tile" />
            <span className="movie-media__tile" />
            <span className="movie-media__tile" />
          </div>
        </div>
      </div>

      {hasEditorial ? (
        <div className="container">
          <section className="movie-synopsis">
            <h2 className="movie-synopsis__title">Sinopse</h2>
            <div className="movie-synopsis__grid">
              <div className="movie-synopsis__main">
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
                    <svg
                      className="spoiler-card__icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="9" cy="8" r="3.2" />
                      <path d="M3.2 20a5.8 5.8 0 0 1 11.6 0" />
                      <path d="M16.5 5.6a3 3 0 0 1 0 5.8" />
                      <path d="M17 13.6a5.6 5.6 0 0 1 3.8 6.4" />
                    </svg>
                    <div className="spoiler-card__text">
                      <p className="spoiler-card__label">Resumo sem spoilers</p>
                      <p className="spoiler-card__body">{summaryBlock.content}</p>
                    </div>
                  </div>
                </aside>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {isUnderReview ? (
        <div className="container">
          <p className="review-notice" data-editorial-state="in-review">
            Esta pagina ainda esta em revisao editorial.
          </p>
        </div>
      ) : null}

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
