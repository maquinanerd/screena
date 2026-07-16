/**
 * search.ts — Contrato de busca publica (Backend A, §12).
 *
 * SearchResult espelha a saida do adapter de busca PostgreSQL. A pagina de
 * resultados e SEMPRE noindex (`SearchPayload.index === false`): busca nunca vira
 * superficie indexavel.
 */

import {
  isRecord,
  optionalString,
  requireArray,
  requireEnum,
  requireNumberOrNull,
  requireString,
  fail,
  ok,
  type ValidationResult,
} from './validation.js'
import { mediaAssetErrors, type PublicMediaAsset } from './primitives.js'

/** Tipos que a busca pode retornar (inclui collection quando ativa). */
export type SearchResultType = 'movie' | 'tv' | 'person' | 'collection'

const SEARCH_RESULT_TYPES: readonly SearchResultType[] = ['movie', 'tv', 'person', 'collection']

/** Motivo do casamento (espelha matchReasonFromTier do worker de busca). */
export type SearchMatchReason = 'exact' | 'alias' | 'prefix' | 'fuzzy'

const SEARCH_MATCH_REASONS: readonly SearchMatchReason[] = ['exact', 'alias', 'prefix', 'fuzzy']

/** Um resultado de busca. */
export interface SearchResult {
  readonly entityId: string
  readonly type: SearchResultType
  readonly title: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly image: PublicMediaAsset | null
  readonly canonicalUrl: string
  readonly matchReason: SearchMatchReason
  readonly score: number
}

/** Payload de uma pagina/endpoint de busca. Sempre noindex. */
export interface SearchPayload {
  readonly query: string
  readonly locale: string
  readonly results: readonly SearchResult[]
  readonly total: number
  readonly limit: number
  readonly offset: number
  /** Invariante de busca: paginas de resultado nunca indexam. */
  readonly index: false
}

/** Erros de um SearchResult. */
export function searchResultErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  const errors = [
    ...requireString(value.entityId, `${label}.entityId`),
    ...requireEnum(value.type, `${label}.type`, SEARCH_RESULT_TYPES),
    ...requireString(value.title, `${label}.title`),
    ...optionalString(value.subtitle, `${label}.subtitle`),
    ...requireNumberOrNull(value.year, `${label}.year`),
    ...requireString(value.canonicalUrl, `${label}.canonicalUrl`),
    ...requireEnum(value.matchReason, `${label}.matchReason`, SEARCH_MATCH_REASONS),
  ]
  if (typeof value.score !== 'number' || !Number.isFinite(value.score)) {
    errors.push(`${label}.score: esperado number finito`)
  }
  if (value.image !== null) errors.push(...mediaAssetErrors(value.image, `${label}.image`))
  return errors
}

/** Valida um SearchResult isolado. */
export function validateSearchResult(input: unknown): ValidationResult<SearchResult> {
  const errors = searchResultErrors(input, 'result')
  return errors.length === 0 ? ok(input as SearchResult) : fail(errors)
}

/** Valida um SearchPayload. */
export function validateSearchPayload(input: unknown): ValidationResult<SearchPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...requireString(input.locale, 'locale'),
    ...requireArray(input.results, 'results', (item, i) =>
      searchResultErrors(item, `results[${i}]`),
    ),
  ]
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (typeof input.query !== 'string') errors.push('query: esperado string')
  if (!num(input.total)) errors.push('total: esperado number finito')
  if (!num(input.limit)) errors.push('limit: esperado number finito')
  if (!num(input.offset)) errors.push('offset: esperado number finito')
  if (input.index !== false)
    errors.push('index: paginas de busca devem ser noindex (index === false)')
  return errors.length === 0 ? ok(input as unknown as SearchPayload) : fail(errors)
}
