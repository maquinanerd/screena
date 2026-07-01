import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Interestelar (2014) - Preview visual",
  robots: { index: false, follow: false },
  alternates: { canonical: "/dev/movie-page-preview/" },
};

/**
 * Preview visual da pagina de filme — reproduz a tela "Movie Detail" do design
 * (Screena Screens.dc.html) com dados FICTICIOS, SEM banco. Serve so para validar
 * a composicao (top info bar, faixa de midia, secao Sinopse). noindex.
 *
 * Sem DB, sem API externa, sem Gemini: e uma pagina estatica de referencia visual.
 */

const shortSynopsis =
  "Texto ficticio de preview: em um futuro proximo, a humanidade busca um novo lar entre as estrelas. Usado apenas para validar a sinopse curta da top info bar.";

const previewBlocks = [
  {
    blockType: "editorial_intro",
    content:
      "Texto editorial ficticio para preview: Interestelar aparece aqui apenas como exemplo visual da pagina de filme, com ritmo de leitura, largura de coluna e hierarquia editorial ja aplicados.",
  },
  {
    blockType: "summary_without_spoilers",
    content:
      "Texto ficticio de preview sem spoilers: uma jornada de ficcao especulativa sobre tempo, distancia e escolhas familiares, usado somente para validar o card lateral.",
  },
] as const;

export default function MoviePagePreview() {
  const title = "Interestelar";
  const year = 2014;
  const runtimeLabel = "2 h 49 min";
  const summaryBlock = previewBlocks.find(
    (block) => block.blockType === "summary_without_spoilers",
  );
  const mainBlocks = previewBlocks.filter(
    (block) => block.blockType !== "summary_without_spoilers",
  );

  const movieJsonLd = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: title,
    datePublished: String(year),
    url: "/dev/movie-page-preview/",
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: "/pt/" },
      { "@type": "ListItem", position: 2, name: "Filmes", item: "/pt/filmes/" },
      {
        "@type": "ListItem",
        position: 3,
        name: title,
        item: "/dev/movie-page-preview/",
      },
    ],
  };

  return (
    <main className="movie-page" data-vertical="movie">
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href="/pt/">Inicio</a>
            </li>
            <li>
              <a href="/pt/filmes/">Filmes</a>
            </li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>

        {/* Top info bar do design — grid 3 colunas. Col 1 (dados de preview);
            cols 2/3 sao placeholders decorativos (ratings/streaming fora de
            escopo). */}
        <section className="movie-topbar" data-vertical="movie">
          <div className="movie-topbar__lead">
            <p className="movie-preview-label">Preview</p>
            <h1 className="movie-topbar__title">
              {title}
              <span className="movie-topbar__year"> ({year})</span>
            </h1>
            <p className="movie-topbar__badge">
              <span data-vertical="movie" className="screena-badge screena-badge--movie">
                Filme
              </span>
            </p>
            <p className="movie-topbar__meta">{runtimeLabel}</p>
            <p className="movie-topbar__synopsis">{shortSynopsis}</p>
          </div>

          <div className="movie-ratings" aria-hidden="true">
            <p className="movie-col-label">Avaliacoes</p>
            <div className="movie-ratings__boxes">
              <div className="movie-ratings__box">
                <span className="movie-skel movie-skel--logo" />
                <span className="movie-skel movie-skel--score" />
              </div>
              <div className="movie-ratings__box">
                <span className="movie-skel movie-skel--logo" />
                <span className="movie-skel movie-skel--score" />
              </div>
              <div className="movie-ratings__box">
                <span className="movie-skel movie-skel--logo" />
                <span className="movie-skel movie-skel--score" />
              </div>
            </div>
          </div>

          <div className="movie-watch" aria-hidden="true">
            <p className="movie-col-label">Onde assistir</p>
            <div className="movie-watch__chips">
              <span className="movie-watch__chip">
                <span className="movie-skel movie-skel--chip" />
              </span>
              <span className="movie-watch__chip">
                <span className="movie-skel movie-skel--chip" />
              </span>
              <span className="movie-watch__chip">
                <span className="movie-skel movie-skel--chip" />
              </span>
              <span className="movie-watch__chip">
                <span className="movie-skel movie-skel--chip" />
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Faixa de midia full-bleed (grid 1fr/3fr/2fr) — decorativa. */}
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
                  data-preview="true"
                >
                  <p className="movie-preview-label">Preview</p>
                  <p className="movie-block__body">{block.content}</p>
                </div>
              ))}
            </div>

            {summaryBlock !== undefined ? (
              <aside className="movie-aside">
                <div
                  className="spoiler-card"
                  data-block-type={summaryBlock.blockType}
                  data-preview="true"
                >
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
                    <p className="movie-preview-label">Preview</p>
                    <p className="spoiler-card__label">Resumo sem spoilers</p>
                    <p className="spoiler-card__body">{summaryBlock.content}</p>
                  </div>
                </div>
              </aside>
            ) : null}
          </div>
        </section>
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
