/**
 * endpoints.ts — Endpoints tipados do TMDB usados pela ingestao da Fase 2.
 *
 * Cada funcao monta o path + params e delega ao `TmdbHttpClient` (que aplica
 * throttle/retry/breaker). O retorno e tipado pelo subset em `types.ts`; os
 * normalizers tratam campos ausentes defensivamente.
 */

import type { TmdbConfig } from './config.js'
import type { TmdbHttpClient } from './http.js'
import type {
  TmdbMovieDetail,
  TmdbPersonDetail,
  TmdbSeasonDetail,
  TmdbTvDetail,
} from './types.js'

/** `append_to_response` para entidades-raiz: IDs externos + creditos. */
const ENTITY_APPEND = 'external_ids,credits'

/** Conjunto de chamadas TMDB que a ingestao precisa. */
export interface TmdbEndpoints {
  getMovie(tmdbId: number): Promise<TmdbMovieDetail>
  getTvShow(tmdbId: number): Promise<TmdbTvDetail>
  getTvSeason(tvTmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetail>
  getPerson(tmdbId: number): Promise<TmdbPersonDetail>
}

/** Cria os endpoints tipados sobre um `TmdbHttpClient` ja configurado. */
export function createTmdbEndpoints(client: TmdbHttpClient, config: TmdbConfig): TmdbEndpoints {
  const language = config.defaultLanguage
  return {
    async getMovie(tmdbId) {
      const data = await client.request(`/movie/${tmdbId}`, {
        language,
        append_to_response: ENTITY_APPEND,
      })
      return data as TmdbMovieDetail
    },
    async getTvShow(tmdbId) {
      const data = await client.request(`/tv/${tmdbId}`, {
        language,
        append_to_response: ENTITY_APPEND,
      })
      return data as TmdbTvDetail
    },
    async getTvSeason(tvTmdbId, seasonNumber) {
      const data = await client.request(`/tv/${tvTmdbId}/season/${seasonNumber}`, { language })
      return data as TmdbSeasonDetail
    },
    async getPerson(tmdbId) {
      const data = await client.request(`/person/${tmdbId}`, {
        language,
        append_to_response: 'external_ids',
      })
      return data as TmdbPersonDetail
    },
  }
}
