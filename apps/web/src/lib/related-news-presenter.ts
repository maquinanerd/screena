/**
 * related-news-presenter.ts - Monta os cards de "Noticias relacionadas" exibidos
 * nas paginas de detalhe (filme/serie/pessoa). PURO: sem rede/DB/IO.
 *
 * Reusa `buildNewsCard` (mesma porta de publicacao/licenca/imagem das paginas de
 * noticias): item nao publicavel -> descartado. Aqui so acrescentamos ordenacao
 * (publishedAt desc) e o limite de cards. Nada e inventado.
 */

import {
  buildNewsCard,
  type NewsCardView,
  type NewsListItemInput,
} from "./news-presenter";

/** Quantidade maxima de noticias relacionadas exibidas numa pagina de detalhe. */
export const RELATED_NEWS_LIMIT = 4;

export interface RelatedNewsItemInput extends NewsListItemInput {
  indexStatus: string;
}

/**
 * Filtra publicaveis (via `buildNewsCard`), ordena por data desc (depois titulo)
 * e aplica o limite. Entrada vazia/sem publicaveis -> lista vazia (a secao some).
 */
export function buildRelatedNewsCards(
  items: RelatedNewsItemInput[],
  limit: number = RELATED_NEWS_LIMIT,
): NewsCardView[] {
  const cards = items
    .filter((item) => item.indexStatus === "index")
    .map(buildNewsCard)
    .filter((card): card is NewsCardView => card !== null);
  cards.sort((a, b) => {
    const ad = a.dateIso ?? "";
    const bd = b.dateIso ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.title.localeCompare(b.title);
  });
  return cards.slice(0, Math.max(0, limit));
}
