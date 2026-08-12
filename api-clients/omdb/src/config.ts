/**
 * config.ts — Configuracao do client OMDb.
 *
 * PURO: recebe o ambiente como argumento (default `process.env`) e nao faz IO.
 * Falha explicita (`RapidApiConfigError`) quando a chave esta ausente — nunca
 * chama a rede sem auth, e nunca imprime o segredo (a mensagem cita so o NOME
 * da variavel).
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
  OMDB_API_KEY_QUERY_PARAM,
  OMDB_DEFAULT_BASE_URL,
  OMDB_DEFAULT_CACHE_TTL_MS,
  OMDB_DEFAULT_HOST,
  OMDB_PROVIDER_API,
} from './provider.js'

/** Nome da env var que guarda a chave da OMDb. */
export const OMDB_KEY_ENV = 'OMDB_API_KEY'
/** Nome da env var de base URL (override opcional). */
export const OMDB_BASE_URL_ENV = 'OMDB_BASE_URL'

/**
 * Autorizacao explicita do provedor em producao, no MESMO padrao do provedor
 * anterior (`CINERIE_RATINGS_PROVIDER_AUTHORIZED`). Nao ha variavel nova de
 * autorizacao: a decisao de licenca e uma so, por eixo de produto (ratings), e
 * duplicar o interruptor criaria dois estados que podem divergir.
 */
export const OMDB_PROVIDER_AUTHORIZED_ENV = 'CINERIE_RATINGS_PROVIDER_AUTHORIZED'

/**
 * Resolve a configuracao do client a partir do ambiente.
 *
 * Obrigatorio: `OMDB_API_KEY`.
 * Opcionais (com default): `OMDB_BASE_URL`, `OMDB_MAX_RPS`, `OMDB_MAX_RETRIES`,
 * `OMDB_BREAKER_THRESHOLD`, `OMDB_BREAKER_COOLDOWN_MS`, `OMDB_TIMEOUT_MS`,
 * `OMDB_CACHE_TTL_MS`.
 *
 * `maxRps` default 1: o plano gratuito tem teto DIARIO (1.000), nao por
 * segundo. Sem documentacao de limite instantaneo, 1 rps e o valor que nao
 * arrisca um 429 por rajada — a protecao real de cota e o `--limit` do worker.
 *
 * @throws {RapidApiConfigError} Se a chave estiver ausente.
 */
export function loadOmdbConfig(env: RapidApiEnv = process.env): RapidApiClientConfig {
  return {
    providerApi: OMDB_PROVIDER_API,
    apiKey: requireSecret(env, OMDB_KEY_ENV),
    host: OMDB_DEFAULT_HOST,
    baseUrl: normalizeBaseUrl(readNonEmpty(env[OMDB_BASE_URL_ENV]) ?? OMDB_DEFAULT_BASE_URL),
    maxRps: readPositiveInt(env.OMDB_MAX_RPS, 1),
    maxRetries: readNonNegativeInt(env.OMDB_MAX_RETRIES, 3),
    breakerThreshold: readPositiveInt(env.OMDB_BREAKER_THRESHOLD, 5),
    breakerCooldownMs: readPositiveInt(env.OMDB_BREAKER_COOLDOWN_MS, 30_000),
    timeoutMs: readPositiveInt(env.OMDB_TIMEOUT_MS, 15_000),
    cacheTtlMs: readPositiveInt(env.OMDB_CACHE_TTL_MS, OMDB_DEFAULT_CACHE_TTL_MS),
    // A OMDb nao aceita a chave em header: `?apikey=` e o unico mecanismo.
    auth: { kind: 'query-param', param: OMDB_API_KEY_QUERY_PARAM },
  }
}
