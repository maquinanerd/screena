import type { ReactNode } from "react";

import type { ExternalLink } from "../../src/lib/external-links";
import { EntityExternalIds } from "./entity-external-ids";
import { EntityFacts, type EntityFact } from "./entity-facts";
import { Breadcrumbs, type BreadcrumbItem } from "./page-primitives";

type EntityDetailVertical = "movie" | "series";

interface EntityDetailImage {
  src: string;
  width: number;
  height: number;
}

interface EntityDetailHeroProps {
  vertical: EntityDetailVertical;
  label: string;
  title: string;
  periodLabel: string | null;
  synopsis: string | null;
  poster: EntityDetailImage | null;
  backdrop: EntityDetailImage | null;
  facts: EntityFact[];
  externalLinks: ExternalLink[];
  breadcrumbs: readonly BreadcrumbItem[];
}

/**
 * Hero compartilhado das fichas de filme e série.
 *
 * Componente apresentacional e server-compatible: recebe somente a view já
 * resolvida pelo chamador, não acessa banco/rede e omite qualquer dado ausente.
 * A imagem de fundo é decorativa; o pôster identifica visualmente a obra.
 */
export function EntityDetailHero({
  vertical,
  label,
  title,
  periodLabel,
  synopsis,
  poster,
  backdrop,
  facts,
  externalLinks,
  breadcrumbs,
}: EntityDetailHeroProps): ReactNode {
  return (
    <section
      className={`entity-detail-hero${
        backdrop === null ? " entity-detail-hero--without-backdrop" : ""
      }`}
      data-vertical={vertical}
    >
      {backdrop !== null ? (
        <div className="entity-detail-hero__backdrop">
          <img
            src={backdrop.src}
            alt=""
            width={backdrop.width}
            height={backdrop.height}
            className="entity-detail-hero__backdrop-image"
          />
        </div>
      ) : null}
      <div className="entity-detail-hero__veil" aria-hidden="true" />

      <div className="container entity-detail-hero__inner">
        <Breadcrumbs items={breadcrumbs} onMedia />

        <div
          className={`entity-detail-hero__layout${
            poster === null ? " entity-detail-hero__layout--without-poster" : ""
          }`}
        >
          {poster !== null ? (
            <figure className="entity-detail-hero__poster">
              <img
                src={poster.src}
                alt={`Pôster de ${title}`}
                width={poster.width}
                height={poster.height}
                className="entity-detail-hero__poster-image"
              />
            </figure>
          ) : null}

          <div className="entity-detail-hero__content">
            <p className="entity-detail-hero__badge">
              <span className={`screena-badge screena-badge--${vertical}`} data-vertical={vertical}>
                {label}
              </span>
            </p>
            <h1 className="entity-detail-hero__title">
              {title}
              {periodLabel !== null ? (
                <span className="entity-detail-hero__period"> ({periodLabel})</span>
              ) : null}
            </h1>
            <EntityFacts facts={facts} />
            {synopsis !== null ? <p className="entity-detail-hero__synopsis">{synopsis}</p> : null}
            <EntityExternalIds links={externalLinks} />
          </div>
        </div>
      </div>
    </section>
  );
}
