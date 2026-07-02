import type { ReactNode } from "react";

import { SITE_URL } from "../../src/lib/site";
import type { EntityIndexView } from "../../src/lib/entity-index-presenter";
import { EntityCardLink } from "./entity-card";

/**
 * EntityIndex - Componente de apresentacao das listagens publicas (portas de
 * entrada) de filmes/series/pessoas.
 *
 * PRESENTACIONAL e PURO: recebe a `EntityIndexView` ja montada pela camada
 * server via props e so produz JSX. Nao importa @screena/db nem faz IO (o acesso
 * ao PostgreSQL fica em `src/server/entity-indexes.ts`; invariantes 3/4). Renderiza
 * so dados reais dos cards; sem imagem local segura, mostra fallback visual.
 * O card em si vive em `entity-card.tsx` (compartilhado com home/explorar).
 */

export type EntityIndexVertical = "movie" | "series" | "person";

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
                  <EntityCardLink card={card} />
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
