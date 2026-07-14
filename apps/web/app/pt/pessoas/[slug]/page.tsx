import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { getPersonPageData } from "../../../../src/server/person-page";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import { SITE_URL } from "../../../../src/lib/site";
import { buildExternalLinks } from "../../../../src/lib/external-links";
import type { PersonCreditEntityType } from "../../../../src/lib/person-presenter";
import { RelatedNewsSection } from "../../../_components/related-news-section";
import { EntityExternalIds } from "../../../_components/entity-external-ids";
import { Breadcrumbs, EmptyState } from "../../../_components/page-primitives";

/**
 * Pagina publica de pessoa - /pt/pessoas/[slug]/ (schema Person, tom NEUTRO).
 *
 * Server component puro: le somente PostgreSQL via `getPersonPageData`. Zero API
 * externa, zero Gemini e zero TMDB no render. Pessoa e superficie
 * institucional/neutra (invariante 11): sem cor de vertical filme/serie; a
 * diferenciacao vem de label ("Pessoa") + badge + breadcrumb + schema + URL.
 *
 * Nada e inventado: biografia, funcao, datas, local e filmografia so aparecem
 * quando existem no payload; caso contrario a secao e omitida. A decisao de
 * indexabilidade segue o avaliador canonico e a politica de indexacao total.
 *
 * URL canonica unica: slug antigo (alias despromovido em `slugs`) nao renderiza
 * 200 — redireciona permanentemente para o slug canonico. A cobertura de slug de
 * pessoa esta completa hoje, mas a defesa evita o mesmo bug em trocas futuras.
 */

export const revalidate = 3600;

const PESSOAS_INDEX_PATH = "/pt/pessoas/";

/**
 * Rotulo textual visivel do tipo de credito. A cor e apenas apoio — invariante
 * 11: a diferenciacao filme/serie nunca depende so da cor.
 */
const CREDIT_TYPE_LABELS: Readonly<Record<PersonCreditEntityType, string>> = {
  movie: "Filme",
  tv: "Série",
};

interface PersonPageParams {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PersonPageParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPersonPageData(slug);

  if (data === null) {
    return {
      title: "Pessoa nao encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const title = view.metaTitle ?? `${view.name} - Pessoa`;

  const metadata: Metadata = {
    title,
    robots: shouldIndex ? { index: true, follow: true } : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };
  if (view.metaDescription !== null) {
    metadata.description = view.metaDescription;
  }
  return metadata;
}

export default async function PersonPage({ params }: { params: Promise<PersonPageParams> }) {
  const { slug } = await params;
  const data = await getPersonPageData(slug);
  if (data === null) notFound();

  // Slug nao-canonico (alias antigo) nunca responde 200: 308 para o canonico.
  const redirectPath = canonicalRedirectPath(PESSOAS_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, canonicalUrl, relatedNews, externalIds } = data;

  const metaItems = [view.lifeLabel, view.placeOfBirth].filter(
    (item): item is string => item !== null,
  );
  // Links de identidade externa (mesmas fontes do `sameAs` do JSON-LD).
  const externalLinks = buildExternalLinks(externalIds, "person");
  const hasEditorial = view.blocks.length > 0;
  const hasCredits = view.credits.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
      {
        "@type": "ListItem",
        position: 2,
        name: "Pessoas",
        item: `${SITE_URL}${PESSOAS_INDEX_PATH}`,
      },
      { "@type": "ListItem", position: 3, name: view.name, item: canonicalUrl },
    ],
  };

  // `@id`/`mainEntityOfPage` = URL canonica autorreferente e estavel da pessoa.
  // `sameAs` so com IDs externos REAIS (nunca inventa). SEM AggregateRating.
  const personJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": canonicalUrl,
    name: view.name,
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
  };
  if (view.originalName !== null) personJsonLd.alternateName = view.originalName;
  if (view.roleLabel !== null) personJsonLd.jobTitle = view.roleLabel;
  if (view.birthDateIso !== null) personJsonLd.birthDate = view.birthDateIso;
  if (view.deathDateIso !== null) personJsonLd.deathDate = view.deathDateIso;
  if (view.placeOfBirth !== null) {
    personJsonLd.birthPlace = { "@type": "Place", name: view.placeOfBirth };
  }
  if (view.metaDescription !== null) personJsonLd.description = view.metaDescription;
  const sameAs = buildSameAs(externalIds, "person");
  if (sameAs.length > 0) personJsonLd.sameAs = sameAs;

  return (
    <main className="person-page" data-vertical="person">
      <div className="container">
        <Breadcrumbs
          items={[
            { label: "Início", href: "/pt/" },
            { label: "Pessoas", href: PESSOAS_INDEX_PATH },
            { label: view.name },
          ]}
        />

        <section className="person-hero">
          <div
            className={`person-hero__portrait${view.hasRealImage ? " person-hero__portrait--real" : ""}`}
          >
            {view.profile !== null ? (
              <img
                src={view.profile.src}
                alt={`Foto de ${view.name}`}
                width={view.profile.width}
                height={view.profile.height}
                className="person-hero__image"
              />
            ) : (
              <span className="person-hero__portrait-fallback" aria-hidden="true" />
            )}
          </div>

          <div className="person-hero__lead">
            <p className="person-hero__badge">
              <span className="screena-badge screena-badge--person">Pessoa</span>
            </p>
            <h1 className="person-hero__name">{view.name}</h1>
            {view.originalName !== null ? (
              <p className="person-hero__original">{view.originalName}</p>
            ) : null}
            {view.roleLabel !== null ? <p className="person-hero__role">{view.roleLabel}</p> : null}
            {metaItems.length > 0 ? (
              <p className="person-hero__meta">{metaItems.join(" · ")}</p>
            ) : null}
            {view.metaDescription !== null ? (
              <p className="person-hero__intro">{view.metaDescription}</p>
            ) : null}
            <EntityExternalIds links={externalLinks} />
          </div>
        </section>
      </div>

      {hasEditorial ? (
        <div className="container">
          <section className="person-section" aria-labelledby="person-bio-title">
            <h2 id="person-bio-title" className="person-section-title">
              Biografia
            </h2>
            <div className="person-bio">
              {view.blocks.map((block) => (
                <div
                  key={block.blockType}
                  className="person-block"
                  data-block-type={block.blockType}
                >
                  <p className="person-block__body">{block.content}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {hasCredits ? (
        <div className="container">
          <section className="person-section" aria-labelledby="person-filmography-title">
            <h2 id="person-filmography-title" className="person-section-title">
              Filmografia
            </h2>
            {/* Linhas no layout da Filmografia do design "Screen Screens v2":
                ano à esquerda, ponto de tipo (cor = apoio; o tipo real esta em
                data-entity-type + URL do link), titulo e papel. Somente dados
                reais do payload; campos ausentes sao omitidos. */}
            <ul className="person-credits">
              {view.credits.map((credit, index) => (
                <li
                  key={`${credit.entityType}-${credit.href}-${index}`}
                  className="person-credit"
                  data-entity-type={credit.entityType}
                >
                  {/* Coluna de 44px sempre presente (vazia sem ano real) para
                      manter a grade alinhada entre linhas — nada e inventado. */}
                  <span className="person-credit__year">
                    {credit.year !== null ? credit.year : null}
                  </span>
                  <span className="person-credit__type">
                    {CREDIT_TYPE_LABELS[credit.entityType]}
                  </span>
                  <a className="person-credit__link" href={credit.href}>
                    {credit.title}
                  </a>
                  {credit.roleLabel !== null ? (
                    <span className="person-credit__role">{credit.roleLabel}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {!hasEditorial && !hasCredits ? (
        <div className="container person-empty-state">
          <EmptyState
            title="Biografia e filmografia ainda não disponíveis"
            description="Este perfil reúne apenas os dados factuais já publicados no catálogo."
            action={{ label: "Ver outras pessoas", href: PESSOAS_INDEX_PATH }}
          />
        </div>
      ) : null}

      <RelatedNewsSection cards={relatedNews} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
