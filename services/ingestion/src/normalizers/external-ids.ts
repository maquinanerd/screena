/**
 * external-ids.ts — Constroi `entity_external_ids` para uma entidade.
 *
 * Sempre grava o id TMDB (source='tmdb'); grava 'imdb' apenas quando ha
 * imdb_id valido. IMDb aqui e SO identificador/referencia — NUNCA fonte de
 * rating (invariantes 1/2).
 */

import {
  imdbWebUrl,
  tmdbExternalIdSource,
  tmdbWebUrl,
  type TmdbEntityKind,
} from '@screena/tmdb-client'
import type { ExternalIdInput } from '../types.js'
import { normalizeImdbId } from '../utils/normalize.js'

/** Lista de ids externos (tmdb + imdb quando houver) para uma entidade. */
export function buildExternalIds(
  kind: TmdbEntityKind,
  tmdbId: number,
  imdbIdRaw: string | null | undefined,
): ExternalIdInput[] {
  // source namespaceado por tipo (tmdb_movie/tmdb_tv/tmdb_person) — ver
  // tmdbExternalIdSource: o TMDB reusa ids entre tipos.
  const ids: ExternalIdInput[] = [
    { source: tmdbExternalIdSource(kind), externalId: String(tmdbId), url: tmdbWebUrl(kind, tmdbId) },
  ]
  const imdbId = normalizeImdbId(imdbIdRaw)
  if (imdbId !== null) {
    ids.push({ source: 'imdb', externalId: imdbId, url: imdbWebUrl(imdbId) })
  }
  return ids
}
