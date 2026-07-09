/**
 * supported-kinds.ts — Quais tipos da fila o piloto P0-00d busca detalhe e como
 * rotear o tipo para o metodo correto do client. Modulo PURO.
 *
 * DESCOBERTA (P0-00c) enfileira 7 tipos; o APPEND/detalhe rico (P0-00b) so cobre
 * movie/tv/person. Neste piloto, os demais (collection/network/company/keyword)
 * sao contados como `unsupportedSkipped` — nunca desaparecem em silencio.
 */

import type { TmdbDiscoveryKind } from '../discovery/id-exports.js'
import type { RawDetailSource, SupportedRawKind } from './types.js'

/** Tipos suportados pelo piloto (subset do enum TmdbEntityKind). */
export const SUPPORTED_RAW_KINDS: readonly SupportedRawKind[] = ['movie', 'tv', 'person']

/** Type guard: o tipo descoberto e um dos que o piloto busca detalhe. */
export function isSupportedRawKind(kind: TmdbDiscoveryKind): kind is SupportedRawKind {
  return kind === 'movie' || kind === 'tv' || kind === 'person'
}

/**
 * Roteia o tipo para o metodo correto da fonte de detalhe:
 *  - `movie`  -> `getMovie`
 *  - `tv`     -> `getTvShow`
 *  - `person` -> `getPerson`
 *
 * Exaustivo sobre `SupportedRawKind` (sem `default` — um tipo novo forca erro de
 * compilacao, nunca um fallback silencioso).
 */
export function fetchByKind(
  source: RawDetailSource,
  kind: SupportedRawKind,
  tmdbId: number,
): Promise<unknown> {
  switch (kind) {
    case 'movie':
      return source.getMovie(tmdbId)
    case 'tv':
      return source.getTvShow(tmdbId)
    case 'person':
      return source.getPerson(tmdbId)
  }
}
