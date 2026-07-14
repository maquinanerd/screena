import type { ReactNode } from "react";

import { EXPLORE_PATH, SITE_URL } from "../../src/lib/site";
import type { EntityIndexView } from "../../src/lib/entity-index-presenter";
import { EntityCardLink } from "./entity-card";
import { Breadcrumbs, EmptyState, PageIntro } from "./page-primitives";

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
  /** Mensagem de estado vazio (copy propria; fallback generico quando ausente). */
  emptyMessage?: string;
}

export function EntityIndex({
  title,
  description,
  breadcrumbLabel,
  canonicalUrl,
  vertical,
  view,
  emptyMessage,
}: EntityIndexProps): ReactNode {
  const hasCards = view.cards.length > 0;

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Início", item: `${SITE_URL}/pt/` },
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
        <Breadcrumbs items={[{ label: "Início", href: "/pt/" }, { label: breadcrumbLabel }]} />

        <PageIntro title={title} description={description} vertical={vertical} />

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
          <EmptyState
            title={
              emptyMessage ??
              (vertical === "movie"
                ? "Nenhum filme disponível ainda."
                : vertical === "series"
                  ? "Nenhuma série disponível ainda."
                  : "Nenhuma pessoa disponível ainda.")
            }
            description="Explore outras áreas do catálogo enquanto esta coleção é atualizada."
            action={{ label: "Explorar o catálogo", href: EXPLORE_PATH }}
          />
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
