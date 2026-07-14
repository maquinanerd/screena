import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { getMoviePageData } from "../../../../src/server/movie-page";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import { MOVIES_INDEX_PATH, SITE_URL } from "../../../../src/lib/site";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import { RelatedNewsSection } from "../../../_components/related-news-section";
import { CastStrip } from "../../../_components/cast-strip";
import { WatchAvailabilityPanel } from "../../../_components/watch-availability-panel";
import { EntityDetailHero } from "../../../_components/entity-detail-hero";

/**
 * Pagina publica de filme — /pt/filmes/[slug]/ (schema Movie, acento vermelho).
 *
 * Tela "Movie Detail" do handoff de design (White Cinematic Editorial): header
 * editorial (badge "Filme" + titulo + ano + duracao), faixa de midia preparada
 * para poster/backdrop locais seguros (fallback visual quando ausentes),
 * blocos editoriais reais e card lateral "Resumo sem spoilers" quando existir.
 * Ratings, onde
 * assistir, elenco, bilheteria, premios e relacionados ficam FORA DE ESCOPO
 * nesta fase — sao omitidos (nunca placeholders que finjam features).
 *
 * INVARIANTES 3 e 4: server component puro. Le dados SO do PostgreSQL via a
 * camada server-only (`getMoviePageData`) — zero API externa e zero Gemini no
 * render. A revalidacao ISR re-le o snapshot do banco, nunca uma fonte externa.
 *
 * Indexacao total (invariante 5): blocos editoriais enriquecem a pagina, mas
 * nao sao pre-requisito de indexacao; `noindex` fica restrito a casos tecnicos.
 *
 * URL canonica unica: um slug antigo (alias despromovido em `slugs`) NAO
 * renderiza 200 — redireciona permanentemente para o slug canonico. Duas URLs
 * servindo a mesma ficha diluiriam sinal e contradiriam o `<link rel=canonical>`.
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
      title: "Filme não encontrado",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title =
    view.metaTitle ?? `${view.title}${view.year !== null ? ` (${view.year})` : ""} — Filme`;

  const metadata: Metadata = {
    title,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  // Nunca inventar sinopse: so define description quando ela ja existe no banco.
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription;
  }
  return metadata;
}

export default async function MoviePage({ params }: { params: Promise<MoviePageParams> }) {
  const { slug } = await params;
  const data = await getMoviePageData(slug);
  if (data === null) notFound();

  // Slug nao-canonico (alias antigo) nunca responde 200: 308 para o canonico.
  const redirectPath = canonicalRedirectPath(MOVIES_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, canonicalUrl, relatedNews, cast, watch, externalIds } = data;

  // Ficha tecnica: SO dados factuais que existem no payload; cada ausente e
  // omitido (nunca placeholder). O ano fica no <h1>; a ficha complementa com
  // duracao (movies.runtime_minutes) + situacao/idioma (colunas reais
  // status/original_language mapeadas em pt-BR). Sem nota/streaming inventado.
  const facts = [
    view.runtimeLabel !== null ? { label: "Duração", value: view.runtimeLabel } : null,
    view.statusLabel !== null ? { label: "Situação", value: view.statusLabel } : null,
    view.originalLanguageLabel !== null
      ? { label: "Idioma original", value: view.originalLanguageLabel }
      : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  // Links de identidade externa (mesmas fontes do `sameAs` do JSON-LD).
  const externalLinks = buildExternalLinks(externalIds, "movie");

  // Particiona os blocos ja aprovados: o "resumo sem spoilers" (quando existir)
  // vira card lateral; os demais formam a coluna editorial. Cada bloco aparece
  // exatamente uma vez — nada e escondido, nada e inventado.
  const summaryBlock = view.blocks.find((block) => block.blockType === SUMMARY_BLOCK_TYPE) ?? null;
  const mainBlocks = view.blocks.filter((block) => block.blockType !== SUMMARY_BLOCK_TYPE);
  const hasEditorial = mainBlocks.length > 0 || summaryBlock !== null;

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

  // Schema `Movie`: SEM AggregateRating (nenhuma nota nesta fase; jamais fingir
  // nota propria). `@id`/`mainEntityOfPage` = URL canonica (no autorreferente e
  // estavel da entidade). `sameAs` so entra com IDs externos REAIS (invariante:
  // nunca inventa perfil). So campos que existem no payload entram no JSON-LD.
  const movieJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    "@id": canonicalUrl,
    name: view.title,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  };
  if (view.year !== null) movieJsonLd.datePublished = String(view.year);
  if (view.metaDescription !== null) movieJsonLd.description = view.metaDescription;
  const sameAs = buildSameAs(externalIds, "movie");
  if (sameAs.length > 0) movieJsonLd.sameAs = sameAs;

  return (
    <main className="movie-page" data-vertical="movie">
      <EntityDetailHero
        vertical="movie"
        label="Filme"
        title={view.title}
        periodLabel={view.year === null ? null : String(view.year)}
        synopsis={view.metaDescription}
        poster={view.media.poster}
        backdrop={view.media.backdrop}
        facts={facts}
        externalLinks={externalLinks}
        breadcrumbs={[
          { label: "Início", href: "/pt/" },
          { label: "Filmes", href: MOVIES_INDEX_PATH },
          { label: view.title },
        ]}
      />

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

      {/* Elenco principal (cast_members/people) — dado factual de catalogo. So
          aparece quando ha elenco real; nunca inventa nomes nem personagens. */}
      {cast.length > 0 ? (
        <div className="container">
          <CastStrip heading="Elenco principal" members={cast} />
        </div>
      ) : null}

      {/* Disponibilidade no Brasil (watch_availability licenciado). So aparece
          com oferta `display_allowed = true`; hoje a ingestao grava `false` por
          padrao, entao o painel fica omitido ate promocao humana explicita.
          Nunca exibe pirataria, nota nem plataforma inventada. */}
      {watch !== null ? (
        <div className="container">
          <WatchAvailabilityPanel view={watch} />
        </div>
      ) : null}

      <RelatedNewsSection cards={relatedNews} />

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
