/**
 * Presenter puro das faixas de catálogo da home canônica.
 *
 * A camada server entrega os itens já ordenados pelo **trending do dia**
 * (`discovery_snapshots`, capturado offline pela fila `trending` do agendador).
 * Este módulo apenas transforma os registros em cards e preserva essa ordem.
 * Não completa a grade, não repete títulos e não cria ranking.
 *
 * `buildTrendingMovieCards` se chama assim desde sempre; até 2026-08-21 a ordem
 * que chegava aqui era `popularity desc` — um acumulado sem janela. O nome dizia
 * uma coisa e o dado fazia outra, e a próxima pessoa a ler o nome teria
 * acreditado nele. Agora o nome está correto.
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
