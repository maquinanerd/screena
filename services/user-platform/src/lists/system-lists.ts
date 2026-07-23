/**
 * Listas de sistema da user platform (missao: listas nascem privadas).
 *
 * PURO: nao faz rede, DB nem IO. As quatro listas de sistema existem para
 * todo usuario e sao criadas de forma idempotente pelo adapter; aqui vive
 * apenas o catalogo canonico e o plano de criacao dos faltantes.
 *
 * Fonte dos tipos: core/types.ts (SYSTEM_LIST_KEYS espelha o enum do
 * Postgres) — nunca redeclarar as chaves aqui.
 */

import { SYSTEM_LIST_KEYS, type SystemListKey } from "../core/types.js";

/** Metadados exibiveis de uma lista de sistema (titulo pt-BR + slug). */
export interface SystemListDefinition {
  readonly titlePt: string;
  readonly slug: string;
}

/**
 * Catalogo canonico das listas de sistema. A ordem de exibicao/criacao
 * canonica e a de SYSTEM_LIST_KEYS (watchlist, favorites, watching, watched).
 */
export const SYSTEM_LISTS: Readonly<Record<SystemListKey, SystemListDefinition>> = {
  watchlist: { titlePt: "Quero assistir", slug: "quero-assistir" },
  favorites: { titlePt: "Favoritos", slug: "favoritos" },
  watching: { titlePt: "Assistindo", slug: "assistindo" },
  watched: { titlePt: "Assistidos", slug: "assistidos" },
};

/**
 * Planeja quais listas de sistema faltam para um usuario.
 *
 * Recebe as chaves ja existentes (em qualquer ordem, com ou sem duplicata)
 * e devolve as faltantes NA ORDEM CANONICA de SYSTEM_LIST_KEYS. A aplicacao
 * (insert idempotente) e responsabilidade do adapter, em transacao.
 */
export function planEnsureSystemLists(
  existingKeys: ReadonlyArray<SystemListKey>,
): SystemListKey[] {
  const existing = new Set<SystemListKey>(existingKeys);
  return SYSTEM_LIST_KEYS.filter((key) => !existing.has(key));
}
