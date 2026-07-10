/**
 * config.ts — Configuracao do client Film/Show Ratings (RapidAPI).
 *
 * PURO: recebe o ambiente como argumento (default `process.env`) e nao faz IO.
 * Falha explicita (`RapidApiConfigError`) quando a chave esta ausente — nunca
 * chama a rede sem auth, e nunca imprime o segredo.
 */

import {
  normalizeBaseUrl,
  readNonEmpty,
  readNonNegativeInt,
  readPositiveInt,
  requireSecret,
  type RapidApiClientConfig,
  type RapidApiEnv,
} from '@screena/rapidapi-core'

import {
  FILM_SHOW_RATINGS_DEFAULT_BASE_URL,
  FILM_SHOW_RATINGS_DEFAULT_CACHE_TTL_MS,
  FILM_SHOW_RATINGS_DEFAULT_HOST,
  FILM_SHOW_RATINGS_PROVIDER_API,
} from './provider.js'

/** Nome da env var que guarda a chave RapidAPI deste provider. */
export const FILM_SHOW_RATINGS_KEY_ENV = 'RAPIDAPI_FILM_SHOW_RATINGS_KEY'
/** Nome da env var de host (override opcional). */
export const FILM_SHOW_RATINGS_HOST_ENV = 'RAPIDAPI_FILM_SHOW_RATINGS_HOST'
/** Nome da env var de base URL (override opcional). */
export const FILM_SHOW_RATINGS_BASE_URL_ENV = 'RAPIDAPI_FILM_SHOW_RATINGS_BASE_URL'

/**
 * Resolve a configuracao do client a partir do ambiente.
 *
 * Obrigatorio: `RAPIDAPI_FILM_SHOW_RATINGS_KEY`.
 * Opcionais (com default): `..._HOST`, `..._BASE_URL`, `..._MAX_RPS`,
 * `..._MAX_RETRIES`, `..._BREAKER_THRESHOLD`, `..._BREAKER_COOLDOWN_MS`,
 * `..._TIMEOUT_MS`, `..._CACHE_TTL_MS`.
 *
 * @throws {RapidApiConfigError} Se a chave estiver ausente (mensagem cita so o
 *   NOME da variavel, nunca o valor).
 */
export function loadFilmShowRatingsConfig(env: RapidApiEnv = process.env): RapidApiClientConfig {
  return {
    providerApi: FILM_SHOW_RATINGS_PROVIDER_API,
    apiKey: requireSecret(env, FILM_SHOW_RATINGS_KEY_ENV),
    host: readNonEmpty(env[FILM_SHOW_RATINGS_HOST_ENV]) ?? FILM_SHOW_RATINGS_DEFAULT_HOST,
    baseUrl: normalizeBaseUrl(
      readNonEmpty(env[FILM_SHOW_RATINGS_BASE_URL_ENV]) ?? FILM_SHOW_RATINGS_DEFAULT_BASE_URL,
    ),
    maxRps: readPositiveInt(env.RAPIDAPI_FILM_SHOW_RATINGS_MAX_RPS, 2),
    maxRetries: readNonNegativeInt(env.RAPIDAPI_FILM_SHOW_RATINGS_MAX_RETRIES, 3),
    breakerThreshold: readPositiveInt(env.RAPIDAPI_FILM_SHOW_RATINGS_BREAKER_THRESHOLD, 5),
    breakerCooldownMs: readPositiveInt(env.RAPIDAPI_FILM_SHOW_RATINGS_BREAKER_COOLDOWN_MS, 30_000),
    timeoutMs: readPositiveInt(env.RAPIDAPI_FILM_SHOW_RATINGS_TIMEOUT_MS, 15_000),
    cacheTtlMs: readPositiveInt(
      env.RAPIDAPI_FILM_SHOW_RATINGS_CACHE_TTL_MS,
      FILM_SHOW_RATINGS_DEFAULT_CACHE_TTL_MS,
    ),
  }
}
