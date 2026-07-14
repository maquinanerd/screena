/**
 * Presenter puro das faixas de catálogo da home canônica.
 *
 * A camada server entrega os itens já ordenados pelo snapshot persistido de
 * `popularity`. Este módulo apenas transforma os registros em cards e preserva
 * essa ordem. Não completa a grade, não repete títulos e não cria ranking.
 */

import {
  buildMovieCard,
  type EntityCard,
  type MovieListItemInput,
} from "./entity-index-presenter";

export const HOME_TRENDING_CARD_LIMIT = 6;

function compactCards<T>(
  items: readonly T[],
  buildCard: (item: T) => EntityCard | null,
): EntityCard[] {
  const cards: EntityCard[] = [];
  for (const item of items) {
    const card = buildCard(item);
    if (card !== null) cards.push(card);
    if (cards.length === HOME_TRENDING_CARD_LIMIT) break;
  }
  return cards;
}

export function buildTrendingMovieCards(
  items: readonly MovieListItemInput[],
): EntityCard[] {
  return compactCards(items, buildMovieCard);
}
