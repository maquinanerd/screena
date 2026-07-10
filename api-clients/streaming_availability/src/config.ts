/**
 * config.ts — Configuracao do client Streaming Availability (RapidAPI).
 *
 * PURO: recebe o ambiente como argumento (default `process.env`) e nao faz IO.
 * Falha explicita quando a chave esta ausente; nunca imprime o segredo.
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
  STREAMING_AVAILABILITY_DEFAULT_BASE_URL,
  STREAMING_AVAILABILITY_DEFAULT_CACHE_TTL_MS,
  STREAMING_AVAILABILITY_DEFAULT_HOST,
  STREAMING_AVAILABILITY_PROVIDER_API,
} from './provider.js'

/** Nome da env var que guarda a chave RapidAPI deste provider. */
export const STREAMING_AVAILABILITY_KEY_ENV = 'RAPIDAPI_STREAMING_AVAILABILITY_KEY'
/** Nome da env var de host (override opcional). */
export const STREAMING_AVAILABILITY_HOST_ENV = 'RAPIDAPI_STREAMING_AVAILABILITY_HOST'
/** Nome da env var de base URL (override opcional). */
export const STREAMING_AVAILABILITY_BASE_URL_ENV = 'RAPIDAPI_STREAMING_AVAILABILITY_BASE_URL'

/**
 * Resolve a configuracao do client a partir do ambiente.
 *
 * Obrigatorio: `RAPIDAPI_STREAMING_AVAILABILITY_KEY`.
 *
 * @throws {RapidApiConfigError} Se a chave estiver ausente.
 */
export function loadStreamingAvailabilityConfig(
  env: RapidApiEnv = process.env,
): RapidApiClientConfig {
  return {
    providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    apiKey: requireSecret(env, STREAMING_AVAILABILITY_KEY_ENV),
    host: readNonEmpty(env[STREAMING_AVAILABILITY_HOST_ENV]) ?? STREAMING_AVAILABILITY_DEFAULT_HOST,
    baseUrl: normalizeBaseUrl(
      readNonEmpty(env[STREAMING_AVAILABILITY_BASE_URL_ENV]) ??
        STREAMING_AVAILABILITY_DEFAULT_BASE_URL,
    ),
    maxRps: readPositiveInt(env.RAPIDAPI_STREAMING_AVAILABILITY_MAX_RPS, 2),
    maxRetries: readNonNegativeInt(env.RAPIDAPI_STREAMING_AVAILABILITY_MAX_RETRIES, 3),
    breakerThreshold: readPositiveInt(env.RAPIDAPI_STREAMING_AVAILABILITY_BREAKER_THRESHOLD, 5),
    breakerCooldownMs: readPositiveInt(
      env.RAPIDAPI_STREAMING_AVAILABILITY_BREAKER_COOLDOWN_MS,
      30_000,
    ),
    timeoutMs: readPositiveInt(env.RAPIDAPI_STREAMING_AVAILABILITY_TIMEOUT_MS, 15_000),
    cacheTtlMs: readPositiveInt(
      env.RAPIDAPI_STREAMING_AVAILABILITY_CACHE_TTL_MS,
      STREAMING_AVAILABILITY_DEFAULT_CACHE_TTL_MS,
    ),
  }
}
