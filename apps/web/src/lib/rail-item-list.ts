/**
 * rail-item-list.ts — o `ItemList` das categorias home-like (`/pt/filmes/`,
 * `/pt/series/`).
 *
 * O DEFEITO QUE ISTO CORRIGE (auditoria de SEO de 11/09/2026, secao 3.4): o
 * `ItemList` das duas paginas vinha da listagem por ano (`getMovieIndexData`) —
 * 24 titulos, dos quais 0 apareciam ou eram linkados na pagina, que renderiza
 * outro conjunto (hero, trilhos, rankings). Marcar o que o leitor nao ve e o
 * padrao que leva a acao manual por dados estruturados.
 *
 * Agora a lista e montada com os MESMOS cards do trilho que a pagina renderiza
 * ("Filmes em alta" / "Séries da semana"), e a paridade com o HTML e provada
 * renderizando `HomeLike` em `app/_components/__tests__/home-like-item-list.test.tsx`.
 *
 * PURO: sem banco, sem rede.
 */

import { SITE_URL } from "./site";

/** O minimo de um card que o trilho renderiza como link. */
export interface RailCard {
  readonly href: string;
  readonly title: string;
}

/** `ItemList` do trilho, ou `null` sem card nenhum — lista vazia nao descreve nada. */
export function railItemListJsonLd(
  name: string,
  cards: readonly RailCard[],
  siteUrl: string = SITE_URL,
): Record<string, unknown> | null {
  if (cards.length === 0) return null;
  return {
    "@type": "ItemList",
    name,
    numberOfItems: cards.length,
    itemListElement: cards.map((card, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${siteUrl}${card.href}`,
      name: card.title,
    })),
  };
}
