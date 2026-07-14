import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { buildSameAs } from "@screena/seo";

import { AdSlot } from "../../../_components/ad-slot";
import { canonicalRedirectPath } from "../../../../src/lib/canonical-redirect";
import type { PersonCreditEntityType } from "../../../../src/lib/person-presenter";
import { SITE_URL } from "../../../../src/lib/site";
import { getPersonPageData } from "../../../../src/server/person-page";

import styles from "./person-canonical.module.css";

/**
 * Tela canônica 09 · Pessoa.
 *
 * O HTML do pacote `Screen Screens v4` determina ordem, grade, medidas e
 * tipografia. Os holes do protótipo, porém, só aparecem quando o presenter
 * atual possui dado real: não fabricamos mídia, prêmios, galeria, notas ou
 * "conhecido por". O render continua server-only, lendo apenas PostgreSQL.
 */

export const revalidate = 3600;

const PESSOAS_INDEX_PATH = "/pt/pessoas/";

const CREDIT_TYPE_LABELS: Readonly<Record<PersonCreditEntityType, string>> = {
  movie: "Filme",
  tv: "Série",
};

interface PersonPageParams {
  slug: string;
}

interface PersonalDetail {
  label: string;
  value: string;
}

function formatPersonDate(isoDate: string | null): string | null {
  if (isoDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function personInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase("pt-BR");
}

function collectPersonalDetails(view: {
  originalName: string | null;
  roleLabel: string | null;
  birthDateIso: string | null;
  deathDateIso: string | null;
  placeOfBirth: string | null;
}): PersonalDetail[] {
  const birthDate = formatPersonDate(view.birthDateIso);
  const deathDate = formatPersonDate(view.deathDateIso);
  const details: Array<PersonalDetail | null> = [
    view.originalName === null
      ? null
      : { label: "Nome original", value: view.originalName },
    birthDate === null ? null : { label: "Nascimento", value: birthDate },
    deathDate === null ? null : { label: "Falecimento", value: deathDate },
    view.placeOfBirth === null
      ? null
      : { label: "Local", value: view.placeOfBirth },
    view.roleLabel === null
      ? null
      : { label: "Atuação principal", value: view.roleLabel },
  ];

  return details.filter((detail): detail is PersonalDetail => detail !== null);
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
      title: "Pessoa não encontrada",
      robots: { index: false, follow: false },
    };
  }

  const { view, indexability, canonicalUrl } = data;
  const shouldIndex = indexability.decision === "index";
  const metadata: Metadata = {
    title: view.metaTitle ?? `${view.name} - Pessoa`,
    robots: shouldIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    alternates: { canonical: canonicalUrl },
  };

  if (view.metaDescription !== null) metadata.description = view.metaDescription;
  return metadata;
}

export default async function PersonPage({
  params,
}: {
  params: Promise<PersonPageParams>;
}) {
  const { slug } = await params;
  const data = await getPersonPageData(slug);
  if (data === null) notFound();

  const redirectPath = canonicalRedirectPath(PESSOAS_INDEX_PATH, slug, data.canonicalSlug);
  if (redirectPath !== null) permanentRedirect(redirectPath);

  const { view, indexability, canonicalUrl, relatedNews, externalIds } = data;
  const isUnderReview = indexability.decision !== "index";
  const hasCredits = view.credits.length > 0;
  const personalDetails = collectPersonalDetails(view);
  const biography = [
    view.metaDescription,
    ...view.blocks.map((block) => block.content),
  ].filter((paragraph): paragraph is string => paragraph !== null);
  const lifeAndPlace = [view.lifeLabel, view.placeOfBirth].filter(
    (item): item is string => item !== null,
  );
  const creditCountLabel = hasCredits
    ? `${view.credits.length} ${view.credits.length === 1 ? "título" : "títulos"} na filmografia`
    : null;

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
    <main className={styles.page} data-vertical="person">
      <header className={styles.hero}>
        <div className={styles.portraitFrame}>
          <div className={styles.portrait}>
            {view.profile !== null ? (
              <img
                src={view.profile.src}
                alt={`Foto de ${view.name}`}
                width={view.profile.width}
                height={view.profile.height}
                className={styles.portraitImage}
                fetchPriority="high"
              />
            ) : (
              <span className={styles.portraitFallback} aria-hidden="true">
                {personInitials(view.name)}
              </span>
            )}
          </div>
        </div>

        <div className={styles.heroLead}>
          <p className={styles.kicker}>
            Pessoa{view.roleLabel === null ? null : ` · ${view.roleLabel}`}
          </p>
          <h1 className={styles.name}>{view.name}</h1>

          {creditCountLabel !== null || lifeAndPlace.length > 0 ? (
            <div className={styles.chips}>
              {creditCountLabel !== null ? (
                <span className={styles.chip}>{creditCountLabel}</span>
              ) : null}
              {lifeAndPlace.length > 0 ? (
                <span className={styles.chip}>{lifeAndPlace.join(" · ")}</span>
              ) : null}
            </div>
          ) : null}

          {biography.length > 0 ? (
            <div className={styles.biography}>
              {biography.map((paragraph, index) => (
                <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.adShell}>
        <AdSlot variant="leaderboard" margin="56px 0 0" />
      </div>

      {hasCredits ? (
        <section className={styles.section} aria-labelledby="person-filmography-title">
          <h2 id="person-filmography-title" className={styles.sectionTitle}>
            Filmografia
          </h2>
          <ul className={styles.filmography}>
            {view.credits.map((credit, index) => (
              <li
                key={`${credit.entityType}-${credit.href}-${index}`}
                className={styles.credit}
                data-entity-type={credit.entityType}
              >
                <span className={styles.creditYear}>
                  {credit.year === null ? null : credit.year}
                </span>
                <span className={styles.creditDot} aria-hidden="true" />
                <span className={styles.visuallyHidden}>
                  {CREDIT_TYPE_LABELS[credit.entityType]}
                </span>
                <a className={styles.creditTitle} href={credit.href}>
                  {credit.title}
                </a>
                {credit.roleLabel === null ? null : (
                  <span className={styles.creditRole}>{credit.roleLabel}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {personalDetails.length > 0 ? (
        <section className={styles.section} aria-labelledby="person-details-title">
          <h2 id="person-details-title" className={styles.sectionTitle}>
            Detalhes pessoais
          </h2>
          <dl className={styles.details}>
            {personalDetails.map((detail) => (
              <div key={detail.label} className={styles.detail}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {relatedNews.length > 0 ? (
        <section className={styles.section} aria-labelledby="person-related-news-title">
          <h2 id="person-related-news-title" className={styles.sectionTitle}>
            Notícias relacionadas
          </h2>
          <ul className={styles.newsGrid}>
            {relatedNews.map((card) => {
              const meta = [card.author, card.dateLabel, card.readTimeLabel].filter(
                (item): item is string => item !== null,
              );

              return (
                <li key={card.href} className={styles.newsItem}>
                  <a className={styles.newsCard} href={card.href}>
                    <span className={styles.newsMedia}>
                      {card.image === null ? (
                        <span className={styles.newsFallback} aria-hidden="true" />
                      ) : (
                        <img
                          src={card.image.src}
                          alt={`Imagem de ${card.title}`}
                          width={card.image.width}
                          height={card.image.height}
                          className={styles.newsImage}
                          loading="lazy"
                        />
                      )}
                    </span>
                    <span className={styles.newsBody}>
                      {card.category === null ? null : (
                        <span className={styles.newsCategory}>{card.category}</span>
                      )}
                      <span className={styles.newsTitle}>{card.title}</span>
                      {meta.length > 0 ? (
                        <span className={styles.newsMeta}>{meta.join(" · ")}</span>
                      ) : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {isUnderReview ? (
        <p className={styles.reviewNotice} data-editorial-state="in-review">
          Esta página ainda está em revisão editorial.
        </p>
      ) : null}

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
