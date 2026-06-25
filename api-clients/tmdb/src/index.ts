/**
 * @screena/tmdb-client — Client TMDB worker-only (Fase 2).
 *
 * Superficie publica: constantes/identidade do provider, tipos do subset TMDB,
 * configuracao por env, executor HTTP resiliente e endpoints tipados.
 *
 * INVARIANTES: TMDB e `provider_api` (kind=data), nunca `rating_source`;
 * chaves so em env vars; este modulo e WORKER-ONLY e NUNCA pode ser importado
 * pelo bundle de render (apps/web).
 */

export * from './provider.js'
export * from './types.js'
export * from './config.js'
export * from './http.js'
export * from './endpoints.js'

import { loadTmdbConfig, type TmdbConfig, type TmdbEnv } from './config.js'
import { createTmdbEndpoints, type TmdbEndpoints } from './endpoints.js'
import { TmdbHttpClient, createFetchTransport, type TmdbHttpDeps } from './http.js'

/** Client TMDB montado: config resolvida + executor HTTP + endpoints. */
export interface TmdbClient {
  readonly config: TmdbConfig
  readonly http: TmdbHttpClient
  readonly endpoints: TmdbEndpoints
}

/** Opcoes de montagem do client. */
export interface CreateTmdbClientOptions {
  /** Ambiente de onde ler a config (default `process.env`). */
  readonly env?: TmdbEnv
  /** Dependencias de transporte/relogio (default: fetch global). */
  readonly deps?: TmdbHttpDeps
}

/**
 * Monta um `TmdbClient` pronto para uso. Em producao, omita `deps` para usar o
 * `fetch` global; em teste, injete um transporte fake (sem rede).
 */
export function createTmdbClient(options: CreateTmdbClientOptions = {}): TmdbClient {
  const config = loadTmdbConfig(options.env)
  const deps = options.deps ?? { transport: createFetchTransport() }
  const http = new TmdbHttpClient(config, deps)
  const endpoints = createTmdbEndpoints(http, config)
  return { config, http, endpoints }
}
