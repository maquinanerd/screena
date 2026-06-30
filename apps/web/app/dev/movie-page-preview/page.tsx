import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Interestelar (2014) - Preview visual",
  robots: { index: false, follow: false },
  alternates: { canonical: "/dev/movie-page-preview/" },
};

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

        <article className="movie" data-vertical="movie">
          <header className="movie__header">
            <p className="movie__kicker">
              <span data-vertical="movie" className="screena-badge screena-badge--movie">
                Filme
              </span>
            </p>

            <h1 className="movie__title">
              {title}
              <span className="movie__year"> ({year})</span>
            </h1>

            <p className="movie__meta">{runtimeLabel}</p>
          </header>
        </article>
      </div>

      <div className="movie-media" aria-hidden="true">
        <div className="movie-media__inner">
          <span className="movie-media__play" />
        </div>
      </div>

      <div className="container">
        <section className="movie-editorial">
          <div className="movie-editorial__main">
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
                <p className="movie-preview-label">Preview</p>
                <p className="spoiler-card__label">Resumo sem spoilers</p>
                <p className="spoiler-card__body">{summaryBlock.content}</p>
              </div>
            </aside>
          ) : null}
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
