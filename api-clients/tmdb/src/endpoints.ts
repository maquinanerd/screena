/**
 * endpoints.ts — Endpoints tipados do TMDB usados pela ingestao.
 *
 * Cada funcao monta o path + params e delega ao `TmdbHttpClient` (que aplica
 * throttle/retry/breaker). O detalhe de cada tipo suportado busca o
 * `append_to_response` MAXIMO derivado da doc oficial (ver `append-to-response.ts`),
 * incluindo `translations` (todos os idiomas num request). Quando o conjunto
 * excede o teto de sub-requests, `requestWithAppend` particiona em multiplas
 * chamadas e mescla os sub-recursos na resposta base.
 *
 * O retorno e tipado pelo subset em `types.ts`; sub-recursos extras vem no
 * payload bruto (destinado a `tmdb_raw`) e sao ignorados pelo subset — os
 * normalizers tratam campos ausentes defensivamente.
 */

import {
  MOVIE_APPEND,
  PERSON_APPEND,
  TV_APPEND,
  TV_EPISODE_APPEND,
  TV_SEASON_APPEND,
  partitionAppend,
} from './append-to-response.js'
import type { TmdbConfig } from './config.js'
import type { TmdbHttpClient, TmdbQueryParams } from './http.js'
import type {
  TmdbEpisodeDetail,
  TmdbMovieDetail,
  TmdbMoviePage,
  TmdbPersonDetail,
  TmdbSeasonDetail,
  TmdbTvDetail,
} from './types.js'

/** Regiao default para listas de lancamento (datas de estreia locais). */
const DEFAULT_LIST_REGION = 'BR'

/** Parametros da lista de filmes upcoming (todos opcionais). */
export interface UpcomingMoviesParams {
  /** Idioma (default: `config.defaultLanguage`, tipicamente pt-BR). */
  language?: string
  /** Regiao das datas de estreia (default: BR). */
  region?: string
  /** Pagina (1-based; default: 1). */
  page?: number
}

/** Conjunto de chamadas TMDB que a ingestao precisa. */
export interface TmdbEndpoints {
  getMovie(tmdbId: number): Promise<TmdbMovieDetail>
  getTvShow(tmdbId: number): Promise<TmdbTvDetail>
  getTvSeason(tvTmdbId: number, seasonNumber: number): Promise<TmdbSeasonDetail>
  getTvEpisode(
    tvTmdbId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<TmdbEpisodeDetail>
  getPerson(tmdbId: number): Promise<TmdbPersonDetail>
  /**
   * Lista de filmes com estreia futura (`GET /movie/upcoming`). Endpoint de
   * CATALOGO (descoberta de ids para "Em breve"), consumido apenas offline pela
   * ingestao — nunca no render. Nao traz nota/critica; nada editorial.
   */
  getUpcomingMovies(params?: UpcomingMoviesParams): Promise<TmdbMoviePage>
}

/**
 * Busca `path` com `append_to_response` completo. Particiona os valores em blocos
 * que respeitam o teto de sub-requests: com ate um bloco faz uma unica chamada;
 * com mais de um, chama por bloco e mescla os sub-recursos na resposta base
 * (os campos base sao identicos entre blocos, so os sub-recursos diferem). Sem
 * valores, faz a chamada simples.
 */
async function requestWithAppend(
  client: TmdbHttpClient,
  path: string,
  baseParams: TmdbQueryParams,
  appendValues: readonly string[],
): Promise<unknown> {
  const chunks = partitionAppend(appendValues)

  if (chunks.length <= 1) {
    const params: TmdbQueryParams =
      chunks.length === 1 ? { ...baseParams, append_to_response: chunks[0] } : baseParams
    return client.request(path, params)
  }

  const merged: Record<string, unknown> = {}
  for (const chunk of chunks) {
    const data = await client.request(path, { ...baseParams, append_to_response: chunk })
    Object.assign(merged, data as Record<string, unknown>)
  }
  return merged
}

/** Cria os endpoints tipados sobre um `TmdbHttpClient` ja configurado. */
export function createTmdbEndpoints(client: TmdbHttpClient, config: TmdbConfig): TmdbEndpoints {
  const language = config.defaultLanguage
  return {
    async getMovie(tmdbId) {
      const data = await requestWithAppend(client, `/movie/${tmdbId}`, { language }, MOVIE_APPEND)
      return data as TmdbMovieDetail
    },
    async getTvShow(tmdbId) {
      const data = await requestWithAppend(client, `/tv/${tmdbId}`, { language }, TV_APPEND)
      return data as TmdbTvDetail
    },
    async getTvSeason(tvTmdbId, seasonNumber) {
      const data = await requestWithAppend(
        client,
        `/tv/${tvTmdbId}/season/${seasonNumber}`,
        { language },
        TV_SEASON_APPEND,
      )
      return data as TmdbSeasonDetail
    },
    async getTvEpisode(tvTmdbId, seasonNumber, episodeNumber) {
      const data = await requestWithAppend(
        client,
        `/tv/${tvTmdbId}/season/${seasonNumber}/episode/${episodeNumber}`,
        { language },
        TV_EPISODE_APPEND,
      )
      return data as TmdbEpisodeDetail
    },
    async getPerson(tmdbId) {
      const data = await requestWithAppend(client, `/person/${tmdbId}`, { language }, PERSON_APPEND)
      return data as TmdbPersonDetail
    },
    async getUpcomingMovies(params = {}) {
      const data = await client.request('/movie/upcoming', {
        language: params.language ?? language,
        region: params.region ?? DEFAULT_LIST_REGION,
        page: params.page ?? 1,
      })
      return data as TmdbMoviePage
    },
  }
}
