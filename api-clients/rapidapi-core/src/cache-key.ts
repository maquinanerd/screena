/**
 * cache-key.ts — Chave deterministica de cache para `api_cache`.
 *
 * Unique de `api_cache`: (provider_api, request_key, params_hash). `requestKey`
 * e o endpoint + querystring ordenada; `paramsHash` e o SHA-256 da querystring
 * ordenada. A ordem das chaves nao afeta a chave (determinismo).
 *
 * SEGREDO: `params` NUNCA deve conter a chave da API — ela viaja so em header.
 * Se algum dia contivesse, ela acabaria persistida em `api_cache.request_key`.
 */

import { sha256Hex } from './hash.js'

/** Valores de parametro de query (`undefined` e omitido). */
export type CacheQueryParams = Record<string, string | number | undefined>

/** Chave de cache deterministica. */
export interface CacheKey {
  readonly requestKey: string
  readonly paramsHash: string
}

/** Querystring ordenada por chave, omitindo `undefined`. */
function sortedQuery(params: CacheQueryParams): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => [key, String(value)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
}

/** Constroi `requestKey` + `paramsHash` deterministas para um endpoint. */
export function buildCacheKey(endpoint: string, params: CacheQueryParams = {}): CacheKey {
  const query = sortedQuery(params)
  return {
    requestKey: query === '' ? endpoint : `${endpoint}?${query}`,
    paramsHash: sha256Hex(query),
  }
}
