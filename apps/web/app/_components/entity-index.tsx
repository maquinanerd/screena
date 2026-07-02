import type { ReactNode } from "react";

import { SITE_URL } from "../../src/lib/site";
import type {
  EntityCard,
  EntityIndexView,
} from "../../src/lib/entity-index-presenter";

/**
 * EntityIndex - Componente de apresentacao das listagens publicas (portas de
 * entrada) de filmes/series/pessoas.
 *
 * PRESENTACIONAL e PURO: recebe a `EntityIndexView` ja montada pela camada
 * server via props e so produz JSX. Nao importa @screena/db nem faz IO (o acesso
 * ao PostgreSQL fica em `src/server/entity-indexes.ts`; invariantes 3/4). Renderiza
 * so dados reais dos cards; sem imagem local segura, mostra fallback visual.
 */

export type EntityIndexVertical = "movie" | "series" | "person";

/**
 * Rotulo textual do tipo, exibido como badge sobre o poster (cards do design
 * "Screen Screens v2"). Reforca a invariante 11: o tipo nunca depende so da
 * cor — o badge textual acompanha URL, breadcrumb e titulo da secao.
 */
const CARD_KIND_LABELS: Readonly<Record<EntityIndexVertical, string>> = {
  movie: "Filme",
  series: "Série",
  person: "Pessoa",
};

/**
 * Alt especifico por tipo de card: poster 2:3 para filme/serie, retrato para
 * pessoa. Usa apenas o titulo real do card — nunca descreve conteudo inventado.
 */
function cardImageAlt(card: EntityCard): string {
  return card.kind === "person"
    ? `Retrato de ${card.title}`
    : `Pôster de ${card.title}`;
}

interface EntityIndexProps {
  /** Titulo H1 e nome da colecao (ex.: "Filmes"). */
  title: string;
  /** Descricao editorial curta da secao (copy propria, nao dado de entidade). */
  description: string;
  /** Rotulo do breadcrumb/segmento (ex.: "Filmes"). */
  breadcrumbLabel: string;
  /** URL canonica absoluta do indice (o canonical vai no <head> via metadata). */
  canonicalUrl: string;
  /** Acento de vertical (cor de apoio; nunca o unico sinal). */
  vertical: EntityIndexVertical;
  /** View ja montada (cards ordenados + cap + contagem). */
  view: EntityIndexView;
}

export function EntityIndex({
  title,
  description,
  breadcrumbLabel,
  canonicalUrl,
  vertical,
  view,
}: EntityIndexProps): ReactNode {
  const hasCards = view.cards.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/pt/` },
      { "@type": "ListItem", position: 2, name: breadcrumbLabel, item: canonicalUrl },
    ],
  };

  const collectionJsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: canonicalUrl,
    description,
  };
  if (hasCards) {
    collectionJsonLd.mainEntity = {
      "@type": "ItemList",
      numberOfItems: view.cards.length,
      itemListElement: view.cards.map((card, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${SITE_URL}${card.href}`,
        name: card.title,
      })),
    };
  }

  return (
    <main className="entity-index" data-vertical={vertical}>
      <div className="container">
        <nav className="breadcrumb" aria-label="Trilha de navegacao">
          <ol>
            <li>
              <a href="/pt/">Inicio</a>
            </li>
            <li aria-current="page">{breadcrumbLabel}</li>
          </ol>
        </nav>

        <header className="entity-index__header">
          <h1 className="entity-index__title">{title}</h1>
          <p className="entity-index__desc">{description}</p>
        </header>

        {hasCards ? (
          <>
            <ul className="entity-grid">
              {view.cards.map((card) => (
                <li key={card.href} className="entity-card-item">
                  <a
                    className="entity-card"
                    href={card.href}
                    data-entity-type={card.kind}
                  >
                    <span
                      className={`entity-card__media${card.image ? " entity-card__media--real" : ""}`}
                    >
                      {card.image !== null ? (
                        <img
                          src={card.image.src}
                          alt={cardImageAlt(card)}
                          width={card.image.width}
                          height={card.image.height}
                          className="entity-card__image"
                          loading="lazy"
                        />
                      ) : (
                        <span className="entity-card__fallback" aria-hidden="true" />
                      )}
                      <span
                        className="entity-card__badge"
                        data-entity-type={card.kind}
                      >
                        {CARD_KIND_LABELS[card.kind]}
                      </span>
                    </span>
                    <span className="entity-card__body">
                      <span className="entity-card__title">{card.title}</span>
                      {card.meta !== null ? (
                        <span className="entity-card__meta">{card.meta}</span>
                      ) : null}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {view.hasMore ? (
              <p className="entity-index__more">
                Mostrando os primeiros {view.cards.length} de {view.totalCount}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="entity-index__empty">
            Ainda nao ha {breadcrumbLabel.toLowerCase()} publicados nesta secao.
          </p>
        )}
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </main>
  );
}
