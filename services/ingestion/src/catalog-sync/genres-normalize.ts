/**
 * genres-normalize.ts — Normalizacao PURA de `/genre/{movie,tv}/list` para linhas
 * de `genres` (Fase 6). media_type = 'movie' | 'tv'. Testavel sem rede/DB.
 */

import type { TmdbGenreList } from '@screena/tmdb-client'

/** Linha normalizada de `genres` (PK: media_type + tmdb_id). */
export interface GenreRow {
  readonly mediaType: 'movie' | 'tv'
  readonly tmdbId: number
  readonly name: string
}

/** Resultado de um upsert de generos. */
export interface GenresUpsertOutcome {
  readonly created: number
  readonly updated: number
  readonly unchanged: number
}

/** Porta de persistencia de `genres`. */
export interface GenresStorePort {
  upsert(rows: GenreRow[]): Promise<GenresUpsertOutcome>
}

/** Normaliza a lista de generos; descarta itens sem id numerico ou nome. */
export function normalizeGenres(mediaType: 'movie' | 'tv', payload: unknown): GenreRow[] {
  if (payload == null || typeof payload !== 'object') return []
  const genres = (payload as TmdbGenreList).genres
  if (!Array.isArray(genres)) return []
  const rows: GenreRow[] = []
  for (const g of genres) {
    if (g && typeof g.id === 'number' && typeof g.name === 'string' && g.name.trim() !== '') {
      rows.push({ mediaType, tmdbId: g.id, name: g.name })
    }
  }
  return rows
}
