/**
 * portal-presenter.ts — Logica PURA das paginas-portal publicas (home /pt/ e
 * hub /pt/explorar/). Sem rede/DB/IO.
 *
 * Principio (nao inventar dados): as secoes de conteudo do portal so exibem
 * cards REAIS vindos dos getters de listagem (PostgreSQL). Uma secao sem dado
 * real e OMITIDA — nunca preenchida com placeholder, ranking, "populares",
 * nota ou streaming fabricados.
 *
 * Indexacao (invariante 5, politica 2026-07 — indexacao total): um portal
 * indexa quando tem pelo menos 1 secao com dado real. Portal completamente
 * vazio (so hero institucional, nenhuma secao populada) e caso tecnico/vazio e
 * recebe `noindex`. O numero de secoes populadas segue como sinal de qualidade.
 */

import { evaluateIndexability, type IndexabilityResult } from "@screena/seo";

export type { IndexabilityResult } from "@screena/seo";

/**
 * Numero de secoes populadas a partir do qual o portal e considerado "rico"
 * (sinal de qualidade). NAO gate mais indexacao: basta >= 1 secao real para
 * indexar (politica 2026-07 — indexacao total); vazio = noindex tecnico.
 */
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
 * Intercala duas colecoes preservando sua ordem, sem repetir o mesmo destino.
 * A primeira colecao vence empates de `href` no mesmo indice.
 */
export function interleaveUniqueByHref<T extends { href: string }>(
  first: readonly T[],
  second: readonly T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];

  const result: T[] = [];
  const seen = new Set<string>();
  const length = Math.max(first.length, second.length);

  for (let index = 0; index < length && result.length < limit; index += 1) {
    for (const item of [first[index], second[index]]) {
      if (item !== undefined && !seen.has(item.href)) {
        result.push(item);
        seen.add(item.href);
      }
      if (result.length === limit) break;
    }
  }

  return result;
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
 * Decide a indexabilidade de um portal (home/explorar) reusando o avaliador
 * canonico de @screena/seo. Politica 2026-07 (indexacao total): portal com
 * pelo menos 1 secao de dado real indexa; portal vazio (nenhuma secao populada)
 * e caso tecnico/vazio -> `noindex`.
 */
export function evaluatePortalIndexability(input: PortalIndexabilityInput): IndexabilityResult {
  const count = input.populatedSectionCount < 0 ? 0 : input.populatedSectionCount;
  return evaluateIndexability({
    language: "pt-BR",
    hasReliableStructuredData: count > 0,
    valueBlocksCount: count,
    displayedRatings: [],
    thinContentScore: 0,
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
