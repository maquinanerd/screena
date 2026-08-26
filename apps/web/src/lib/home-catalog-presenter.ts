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
  buildSeriesCard,
  type EntityCard,
  type MovieListItemInput,
  type SeriesListItemInput,
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

/**
 * Cards do trilho "Séries da semana", na ordem do trending.
 *
 * ============================================================================
 * O TRILHO SE CHAMA "DA SEMANA", E ATÉ 2026-08-26 ELE NÃO ERA
 * ============================================================================
 * Irmão exato de `buildTrendingMovieCards` — e ele não existia. O trilho de
 * séries da home era alimentado por `seriesIndex.view.cards`, a LISTAGEM
 * genérica de séries. Medido em produção: sob o rótulo "Séries da semana" a
 * home exibia `ربع قرن`, `2026年国际足联美国加拿大墨西哥世界杯`, `3RACHA Session`,
 * `A Very Haunted Renovation`, `Ajeya: Special Task Force`, `Alerta roja` — a
 * ordem da listagem, não um recorte de tempo. Nenhuma delas é "da semana"; é o
 * começo do alfabeto.
 *
 * É o MESMO defeito que `home-catalog.ts` descreve para "Filmes em alta" antes
 * de 2026-08-21, com uma diferença que o tornava mais difícil de ver: lá a
 * consulta era errada, aqui a consulta era de OUTRA seção. O rótulo prometia
 * uma janela que a query nunca teve.
 */
export function buildTrendingSeriesCards(
  items: readonly SeriesListItemInput[],
): EntityCard[] {
  return compactCards(items, buildSeriesCard);
}
