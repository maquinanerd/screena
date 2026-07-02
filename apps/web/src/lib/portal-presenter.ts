/**
 * portal-presenter.ts — Logica PURA das paginas-portal publicas (home /pt/ e
 * hub /pt/explorar/). Sem rede/DB/IO.
 *
 * Principio (nao inventar dados): as secoes de conteudo do portal so exibem
 * cards REAIS vindos dos getters de listagem (PostgreSQL). Uma secao sem dado
 * real e OMITIDA — nunca preenchida com placeholder, ranking, "populares",
 * nota ou streaming fabricados.
 *
 * Gate anti-thin (invariante 5): um portal so e `index` quando pelo menos
 * MIN_PORTAL_SECTIONS secoes tem dado real — cada secao populada e um bloco de
 * valor proprio; a copy institucional do hero nao conta. Na duvida, noindex.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

export type { IndexabilityResult } from "@screena/seo";

/** Minimo de secoes com dado real para o portal poder indexar (>= 2 blocos). */
export const MIN_PORTAL_SECTIONS = 2;

/** Cap de cards por secao de entidade na home. */
export const HOME_ENTITY_CARD_LIMIT = 6;

/** Cap de cards de noticia na home. */
export const HOME_NEWS_CARD_LIMIT = 4;

/** Cap de cards por secao de entidade no hub explorar. */
export const EXPLORE_ENTITY_CARD_LIMIT = 8;

/** Cap de cards de noticia no hub explorar. */
export const EXPLORE_NEWS_CARD_LIMIT = 3;

/**
 * Recorte deterministico de uma secao: os N primeiros cards ja ordenados pelo
 * presenter de listagem (nunca reordena, nunca completa com item inventado).
 */
export function takeSectionCards<T>(cards: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];
  return cards.slice(0, limit);
}

/**
 * Conta quantas secoes do portal tem pelo menos 1 item real. Recebe as
 * contagens reais (length dos cards de cada secao renderizada).
 */
export function countPopulatedSections(counts: readonly number[]): number {
  return counts.reduce((total, count) => (count > 0 ? total + 1 : total), 0);
}

export interface PortalIndexabilityInput {
  /** Quantas secoes do portal tem dado real (>= 0). */
  populatedSectionCount: number;
}

/**
 * Decide a indexabilidade de um portal (home/explorar) reusando o gate
 * canonico de @screena/seo: cada secao populada com dado real conta como um
 * bloco de valor; com menos de MIN_PORTAL_SECTIONS a pagina existe mas recebe
 * `noindex` (hub de navegacao puro e conteudo fino).
 */
export function evaluatePortalIndexability(
  input: PortalIndexabilityInput,
): IndexabilityResult {
  const count =
    input.populatedSectionCount < 0 ? 0 : input.populatedSectionCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: true,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: count >= MIN_PORTAL_SECTIONS ? 0 : 1,
    reviewStatusOk: true,
  });
}

/**
 * Rotulo de contagem real de uma colecao ("12 títulos", "1 pessoa"). So para
 * numeros vindos do banco; contagem <= 0 retorna null (nada de numero fake).
 */
export function formatCollectionCount(
  totalCount: number,
  singular: string,
  plural: string,
): string | null {
  if (!Number.isInteger(totalCount) || totalCount <= 0) return null;
  return `${totalCount} ${totalCount === 1 ? singular : plural}`;
}
