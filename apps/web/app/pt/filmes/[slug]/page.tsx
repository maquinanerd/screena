import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { WatchAvailabilityPanel } from "../../../_components/watch-availability-panel";
import { EntityExternalIds } from "../../../_components/entity-external-ids";
import { getMoviePageData } from "../../../../src/server/movie-page";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import { MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SITE_URL } from "../../../../src/lib/site";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import styles from "./movie-canonical.module.css";

/**
 * Página pública de filme — /pt/filmes/[slug]/.
 *
 * O markup segue a tela `06` do pacote canônico Screen Screens v4. Os dados de
 * demonstração do protótipo nunca entram nesta rota: cada bloco é alimentado
 * exclusivamente por `getMoviePageData`, e áreas sem presenter real (score,
 * ratings, trailer, prêmios, recomendações e ações de usuário) são omitidas.
 * Pôster/backdrop ausentes recebem somente o fallback visual permitido pelo
 * contrato de dados, sem alegar que existe mídia ou funcionalidade.
 *
 * Invariantes 3/4: Server Component puro, PostgreSQL/cache local pela camada
 * server-only, zero API externa e zero Gemini durante o render.
 */

/** ISR relê apenas o snapshot local do PostgreSQL. */
export const revalidate = 3600;

/** Bloco editorial que ocupa a faixa canônica de crítica quando aprovado. */
const REVIEW_BLOCK_TYPE = "review_summary";
const WORK_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "editorial_intro",
  "summary_without_spoilers",
  "franchise_context",
]);

interface MoviePageParams {
  slug: string;
}

function initialsFor(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase("pt-BR");
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
      title: "Filme não encontrado",
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

  const redirectPath = canonicalRedirectPath(MOVIES_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, indexability, canonicalUrl, relatedNews, cast, watch, externalIds } =
    data;
  const isUnderReview = indexability.decision !== "index";
  const externalLinks = buildExternalLinks(externalIds, "movie");

  const heroMeta = [
    view.year !== null ? String(view.year) : null,
    view.runtimeLabel,
  ].filter((item): item is string => item !== null);

  const facts = [
    { label: "Ano", value: view.year === null ? "—" : String(view.year) },
    { label: "Duração", value: view.runtimeLabel ?? "—" },
    { label: "Situação", value: view.statusLabel ?? "—" },
    { label: "Idioma original", value: view.originalLanguageLabel ?? "—" },
  ];

  const critiqueBlock =
    view.blocks.find((block) => block.blockType === REVIEW_BLOCK_TYPE) ?? null;
  const workBlocks = view.blocks.filter((block) =>
    WORK_BLOCK_TYPES.has(block.blockType),
  );
  const watchContext =
    view.blocks.find((block) => block.blockType === "where_to_watch_text") ?? null;
  const castContext =
    view.blocks.find((block) => block.blockType === "cast_intro") ?? null;
  const newsContext =
    view.blocks.find((block) => block.blockType === "news_context") ?? null;
  const workLead = workBlocks[0] ?? null;
  const workBody = workBlocks.slice(1);
  const primaryCast = cast.slice(0, 6);
  const editorialNews = relatedNews.slice(0, 3);
  const mediaNews = editorialNews[0] ?? null;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Filmes",
        item: `${SITE_URL}${MOVIES_INDEX_PATH}`,
      },
      { "@type": "ListItem", position: 3, name: view.title, item: canonicalUrl },
    ],
  };

  const movieJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    "@id": canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  };
  if (view.year !== null) movieJsonLd.datePublished = String(view.year);
  if (view.metaDescription !== null) {
    movieJsonLd.description = view.metaDescription;
  }
  const sameAs = buildSameAs(externalIds, "movie");
  if (sameAs.length > 0) movieJsonLd.sameAs = sameAs;

  return (
    <main
      className={`${styles.page} movie-page`}
      data-screen-label="Filme · Detalhe"
      data-vertical="movie"
    >
      <section className={styles.hero} aria-labelledby="movie-title">
        <div className={styles.breadcrumbFrame}>
          <nav className={styles.breadcrumb} aria-label="Trilha de navegação">
            <ol className={styles.breadcrumbList}>
              <li className={styles.breadcrumbItem}>
                <a className={styles.breadcrumbLink} href={MOVIES_INDEX_PATH}>
                  Filmes
                </a>
              </li>
              <li className={styles.breadcrumbItem}>
                <span className={styles.breadcrumbCurrent} aria-current="page">
                  {view.title}
                </span>
              </li>
            </ol>
          </nav>
        </div>

        <div className={styles.heroFrame}>
          <div className={styles.heroLead}>
            <div className={styles.badgeRow}>
              <span className={styles.movieBadge}>Filme</span>
            </div>
            <h1 className={styles.title} id="movie-title">
              {view.title}
            </h1>

            {heroMeta.length > 0 ? (
              <p className={styles.heroMeta}>{heroMeta.join(" · ")}</p>
            ) : null}

            {view.metaDescription !== null ? (
              <p className={styles.heroSynopsis}>{view.metaDescription}</p>
            ) : null}

            {externalLinks.length > 0 ? (
              <div className={styles.identityLinks}>
                <EntityExternalIds links={externalLinks} />
              </div>
            ) : null}
          </div>

          {watch !== null ? (
            <div className={styles.watchColumn}>
              <WatchAvailabilityPanel view={watch} />
              {watchContext !== null ? (
                <p
                  className={styles.watchContext}
                  data-block-type={watchContext.blockType}
                >
                  {watchContext.content}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className={styles.mediaStrip} aria-label={`Mídia de ${view.title}`}>
        <div className={styles.mediaGrid}>
          <div className={styles.mediaPoster}>
            {view.media.poster !== null ? (
              <img
                src={view.media.poster.src}
                alt={`Pôster de ${view.title}`}
                width={view.media.poster.width}
                height={view.media.poster.height}
                className={styles.mediaImage}
              />
            ) : (
              <span
                className={styles.mediaFallback}
                role="img"
                aria-label={`Pôster indisponível para ${view.title}`}
              />
            )}
          </div>

          <div className={styles.mediaBackdrop}>
            {view.media.backdrop !== null ? (
              <img
                src={view.media.backdrop.src}
                alt=""
                width={view.media.backdrop.width}
                height={view.media.backdrop.height}
                className={styles.mediaImage}
              />
            ) : (
              <span className={styles.mediaFallback} aria-hidden="true" />
            )}
          </div>

          <div className={styles.mediaTiles}>
            <span className={styles.mediaTile} aria-hidden="true" />
            {mediaNews !== null ? (
              <a
                className={styles.mediaNewsLink}
                href={mediaNews.href}
                aria-label={`Abrir notícia: ${mediaNews.title}`}
              >
                {mediaNews.image !== null ? (
                  <img
                    src={mediaNews.image.src}
                    alt=""
                    width={mediaNews.image.width}
                    height={mediaNews.image.height}
                    className={styles.mediaImage}
                    loading="lazy"
                  />
                ) : null}
                <span className={styles.mediaTileLabel}>Notícias e eventos</span>
              </a>
            ) : (
              <span className={styles.mediaTile} aria-hidden="true" />
            )}
            <span className={styles.mediaTile} aria-hidden="true" />
          </div>
        </div>
      </section>

      {workLead !== null ? (
        <section className={styles.sectionFrame} aria-labelledby="movie-work-title">
          <div className={styles.workGrid}>
            <div>
              <h2 className={styles.eyebrow} id="movie-work-title">
                A obra
              </h2>
              <p
                className={styles.workLead}
                data-block-type={workLead.blockType}
              >
                {workLead.content}
              </p>
              {workBody.map((block) => (
                <p
                  className={styles.workBody}
                  data-block-type={block.blockType}
                  key={block.blockType}
                >
                  {block.content}
                </p>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {critiqueBlock !== null ? (
        <section className={styles.critique} aria-labelledby="movie-review-title">
          <div className={styles.critiqueMedia}>
            {view.media.backdrop !== null ? (
              <img
                src={view.media.backdrop.src}
                alt=""
                width={view.media.backdrop.width}
                height={view.media.backdrop.height}
                className={styles.mediaImage}
                loading="lazy"
              />
            ) : null}
          </div>
          <span className={styles.critiqueScrim} aria-hidden="true" />
          <span className={styles.critiqueBottomScrim} aria-hidden="true" />
          <div className={styles.critiqueFrame}>
            <div className={styles.critiqueContent}>
              <h2 className={styles.critiqueLabel} id="movie-review-title">
                Guia Screen · Crítica da redação
              </h2>
              <p
                className={styles.critiqueText}
                data-block-type={critiqueBlock.blockType}
              >
                {critiqueBlock.content}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {primaryCast.length > 0 ? (
        <section className={styles.castSection} aria-labelledby="movie-cast-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>Elenco</p>
              <h2 className={styles.sectionTitle} id="movie-cast-title">
                Elenco principal
              </h2>
            </div>
          </div>

          {castContext !== null ? (
            <p
              className={styles.sectionContext}
              data-block-type={castContext.blockType}
            >
              {castContext.content}
            </p>
          ) : null}

          <ul
            className={styles.castGrid}
            aria-label="Elenco principal; use as setas para percorrer"
            tabIndex={0}
          >
            {primaryCast.map((member, index) => {
              const content = (
                <>
                  <span className={styles.castPortrait}>
                    {member.profile !== null ? (
                      <img
                        src={member.profile.src}
                        alt={`Retrato de ${member.name}`}
                        width={member.profile.width}
                        height={member.profile.height}
                        className={styles.mediaImage}
                        loading="lazy"
                      />
                    ) : (
                      <span className={styles.castInitials} aria-hidden="true">
                        {initialsFor(member.name)}
                      </span>
                    )}
                  </span>
                  <span className={styles.castName}>{member.name}</span>
                  {member.character !== null ? (
                    <span className={styles.castCharacter}>{member.character}</span>
                  ) : null}
                </>
              );

              return (
                <li className={styles.castCard} key={`${member.name}-${index}`}>
                  {member.href !== null ? (
                    <a className={styles.castCardLink} href={member.href}>
                      {content}
                    </a>
                  ) : (
                    <div className={styles.castCardStatic}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {editorialNews.length > 0 ? (
        <section className={styles.newsSection} aria-labelledby="movie-news-title">
          <div className={styles.sectionHead}>
            <div>
              <p className={styles.eyebrow}>Editorial</p>
              <h2 className={styles.sectionTitle} id="movie-news-title">
                Notícias e bastidores
              </h2>
              <p
                className={styles.sectionSubtitle}
                data-block-type={newsContext?.blockType}
              >
                {newsContext?.content ??
                  "Contexto, entrevistas e cobertura do filme."}
              </p>
            </div>
            <a className={styles.sectionLink} href={NEWS_INDEX_PATH}>
              Ver tudo →
            </a>
          </div>

          <ul className={styles.newsGrid}>
            {editorialNews.map((article) => {
              const meta = [article.author, article.readTimeLabel].filter(
                (item): item is string => item !== null,
              );
              return (
                <li className={styles.newsCard} key={article.href}>
                  <article>
                    <a className={styles.newsCardLink} href={article.href}>
                      <span className={styles.newsMedia}>
                        {article.image !== null ? (
                          <img
                            src={article.image.src}
                            alt={`Imagem de ${article.title}`}
                            width={article.image.width}
                            height={article.image.height}
                            className={styles.mediaImage}
                            loading="lazy"
                          />
                        ) : null}
                      </span>
                      {article.category !== null ? (
                        <span className={styles.newsCategory}>{article.category}</span>
                      ) : null}
                      <h3 className={styles.newsTitle}>{article.title}</h3>
                      {meta.length > 0 ? (
                        <span className={styles.newsMeta}>{meta.join(" · ")}</span>
                      ) : null}
                    </a>
                  </article>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className={styles.factsFrame} aria-labelledby="movie-facts-title">
        <div className={styles.factsColumn}>
          <h2 className={styles.eyebrow} id="movie-facts-title">
            Ficha técnica
          </h2>
          <dl className={styles.factsList}>
            {facts.map((fact) => (
              <div className={styles.factRow} key={fact.label}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={styles.factValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {isUnderReview ? (
        <div className={styles.noticeFrame}>
          <p className={styles.reviewNotice} data-editorial-state="in-review">
            Esta página ainda está em revisão editorial.
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
