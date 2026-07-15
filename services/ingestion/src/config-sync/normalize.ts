/**
 * normalize.ts — Normalizacao PURA do payload `/configuration` do TMDB para a
 * linha canonica de `tmdb_image_config`.
 *
 * Puro e testavel (sem rede/DB). So extrai o que tem destino normalizado real
 * (base URLs + buckets de tamanho de imagem); o payload bruto integral e
 * preservado no `api_cache` pelo worker. Retorna `null` se o envelope for
 * invalido (sem `images.secure_base_url`) — nunca inventa base URL.
 */

import { validateTmdbConfiguration } from '@screena/tmdb-client'

/** Linha normalizada de `tmdb_image_config` (subset com destino real). */
export interface ImageConfigRow {
  readonly baseUrl: string
  readonly secureBaseUrl: string
  readonly posterSizes: string[]
  readonly backdropSizes: string[]
  readonly stillSizes: string[]
  readonly profileSizes: string[]
  readonly logoSizes: string[]
  readonly changeKeys: string[] | null
}

/** Extrai um array de strings de um valor desconhecido (defensivo). */
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/**
 * Normaliza o payload de `/configuration`. Retorna `null` quando invalido
 * (envelope sem `images.secure_base_url`).
 */
export function normalizeImageConfig(payload: unknown): ImageConfigRow | null {
  if (!validateTmdbConfiguration(payload).ok) return null

  const record = payload as { images?: Record<string, unknown>; change_keys?: unknown }
  const images = record.images ?? {}
  const secureBaseUrl = typeof images.secure_base_url === 'string' ? images.secure_base_url : ''
  if (secureBaseUrl === '') return null

  const baseUrl = typeof images.base_url === 'string' ? images.base_url : secureBaseUrl
  const changeKeysArr = stringArray(record.change_keys)

  return {
    baseUrl,
    secureBaseUrl,
    posterSizes: stringArray(images.poster_sizes),
    backdropSizes: stringArray(images.backdrop_sizes),
    stillSizes: stringArray(images.still_sizes),
    profileSizes: stringArray(images.profile_sizes),
    logoSizes: stringArray(images.logo_sizes),
    changeKeys: changeKeysArr.length > 0 ? changeKeysArr : null,
  }
}

/**
 * Igualdade estrutural entre duas linhas normalizadas — base da idempotencia:
 * se nada mudou, o store nao reescreve (nao bumpa `updated_at`).
 */
export function imageConfigEquals(a: ImageConfigRow, b: ImageConfigRow): boolean {
  const sameArr = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])
  const sameChangeKeys =
    (a.changeKeys === null && b.changeKeys === null) ||
    (a.changeKeys !== null && b.changeKeys !== null && sameArr(a.changeKeys, b.changeKeys))
  return (
    a.baseUrl === b.baseUrl &&
    a.secureBaseUrl === b.secureBaseUrl &&
    sameArr(a.posterSizes, b.posterSizes) &&
    sameArr(a.backdropSizes, b.backdropSizes) &&
    sameArr(a.stillSizes, b.stillSizes) &&
    sameArr(a.profileSizes, b.profileSizes) &&
    sameArr(a.logoSizes, b.logoSizes) &&
    sameChangeKeys
  )
}
