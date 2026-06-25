/**
 * config.ts — Carregamento e validacao da configuracao do client TMDB.
 *
 * INVARIANTE: chaves vivem SO em env vars (nunca no frontend/bundle/versionadas).
 * `loadTmdbConfig` e PURO: recebe o ambiente como argumento (default
 * `process.env`) e nao faz IO. Falha explicita se nenhuma forma de auth existir.
 */

import { TMDB_DEFAULT_BASE_URL } from './provider.js'

/** Modo de autenticacao do TMDB. v4 (Bearer) e preferido sobre v3 (api_key). */
export type TmdbAuth =
  | { readonly mode: 'v4'; readonly token: string }
  | { readonly mode: 'v3'; readonly apiKey: string }

/** Configuracao resolvida do client TMDB. */
export interface TmdbConfig {
  readonly baseUrl: string
  readonly auth: TmdbAuth
  readonly defaultLanguage: string
  readonly maxRps: number
  readonly maxRetries: number
  readonly breakerThreshold: number
  readonly breakerCooldownMs: number
  readonly cacheTtlMs: number
}

/** Forma minima de ambiente aceita (subset de process.env). */
export type TmdbEnv = Record<string, string | undefined>

/** Erro de configuracao (ex.: auth ausente). */
export class TmdbConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TmdbConfigError'
  }
}

/** Le um inteiro positivo (>= 1) de env; cai no default se ausente/invalido. */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

/** Le um inteiro nao-negativo (>= 0) de env; cai no default se ausente/invalido. */
function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}

/** Le uma string nao-vazia de env (trimada); senao undefined. */
function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Resolve a configuracao do TMDB a partir do ambiente.
 *
 * Auth: usa `TMDB_READ_ACCESS_TOKEN` (v4) se presente; senao `TMDB_API_KEY`
 * (v3). Se nenhum existir, lanca `TmdbConfigError` — nunca chama a rede sem auth.
 */
export function loadTmdbConfig(env: TmdbEnv = process.env): TmdbConfig {
  const v4 = readNonEmpty(env.TMDB_READ_ACCESS_TOKEN)
  const v3 = readNonEmpty(env.TMDB_API_KEY)

  let auth: TmdbAuth
  if (v4 !== undefined) {
    auth = { mode: 'v4', token: v4 }
  } else if (v3 !== undefined) {
    auth = { mode: 'v3', apiKey: v3 }
  } else {
    throw new TmdbConfigError(
      'TMDB sem auth: defina TMDB_READ_ACCESS_TOKEN (v4) ou TMDB_API_KEY (v3) em env vars.',
    )
  }

  return {
    baseUrl: readNonEmpty(env.TMDB_API_BASE_URL) ?? TMDB_DEFAULT_BASE_URL,
    auth,
    defaultLanguage: readNonEmpty(env.TMDB_DEFAULT_LANGUAGE) ?? 'pt-BR',
    maxRps: readPositiveInt(env.TMDB_MAX_RPS, 20),
    maxRetries: readNonNegativeInt(env.TMDB_MAX_RETRIES, 4),
    breakerThreshold: readPositiveInt(env.TMDB_BREAKER_THRESHOLD, 5),
    breakerCooldownMs: readPositiveInt(env.TMDB_BREAKER_COOLDOWN_MS, 30_000),
    cacheTtlMs: readPositiveInt(env.TMDB_CACHE_TTL_MS, 86_400_000),
  }
}
