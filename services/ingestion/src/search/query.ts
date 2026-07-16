/**
 * query.ts — Construtor PURO da consulta de busca PostgreSQL (parametrizado).
 *
 * Gera `{ sql, params }` para uma busca ranqueada em search_documents. NUNCA
 * concatena o termo do usuario no SQL: tudo entra como parametro posicional
 * ($1..$5). O casamento de base usa `normalized_text` (dobrado dos dois lados,
 * deterministico); o ranking refina titulo-vs-alias com `immutable_unaccent`
 * (wrapper IMMUTABLE) sobre `primary_text`.
 *
 * Ordem de ranking (invariante de busca):
 *   1. titulo exato  2. alias exato  3. prefixo (titulo/alias)  4. fuzzy (trgm)
 *   desempate: similaridade -> popularidade -> ano -> id.
 */

import { foldText } from './fold.js'

/** Limites de seguranca da busca. */
export const SEARCH_MAX_LIMIT = 50
export const SEARCH_DEFAULT_LIMIT = 20

/** Opcoes da consulta. */
export interface SearchQueryOptions {
  readonly locale: string
  readonly limit?: number
  readonly offset?: number
}

/** SQL parametrizado + parametros posicionais. */
export interface BuiltSearchQuery {
  readonly sql: string
  readonly params: readonly unknown[]
  /** Termo ja dobrado (vazio => o chamador deve pular a consulta). */
  readonly term: string
}

/** Limita um inteiro ao intervalo [min, max]. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * SQL de busca ranqueada. `$1`=termo dobrado, `$2`=prefixo (termo || '%'),
 * `$3`=locale, `$4`=limit, `$5`=offset. `%` e o operador de similaridade trgm
 * (pg_trgm). Nenhum literal do usuario e interpolado.
 */
const SEARCH_SQL = `
  SELECT
    entity_type,
    entity_id,
    primary_text,
    subtitle,
    year,
    popularity,
    image_path,
    canonical_url,
    CASE
      WHEN immutable_unaccent(lower(primary_text)) = $1 THEN 0
      WHEN normalized_aliases <> '' AND $1 = ANY(string_to_array(normalized_aliases, '|')) THEN 1
      WHEN immutable_unaccent(lower(primary_text)) LIKE $2 THEN 2
      WHEN normalized_text LIKE $2 THEN 3
      WHEN normalized_aliases <> '' AND EXISTS (
        SELECT 1 FROM unnest(string_to_array(normalized_aliases, '|')) AS a(alias) WHERE alias LIKE $2
      ) THEN 3
      ELSE 4
    END AS match_tier,
    similarity(normalized_text, $1) AS sim
  FROM search_documents
  WHERE locale = $3
    AND (
      normalized_text = $1
      OR normalized_text LIKE $2
      OR normalized_text % $1
      OR (normalized_aliases <> '' AND EXISTS (
        SELECT 1 FROM unnest(string_to_array(normalized_aliases, '|')) AS a(alias)
        WHERE alias = $1 OR alias LIKE $2
      ))
    )
  ORDER BY match_tier ASC, sim DESC, popularity DESC NULLS LAST, year DESC NULLS LAST, entity_id ASC
  LIMIT $4 OFFSET $5
`

/**
 * Constroi a consulta parametrizada para `rawTerm`. Retorna tambem o termo
 * dobrado; se vazio (termo so de espacos/acentos), o adapter deve retornar []
 * sem tocar o banco.
 */
export function buildSearchQuery(rawTerm: string, options: SearchQueryOptions): BuiltSearchQuery {
  const term = foldText(rawTerm)
  const limit = clampInt(options.limit, SEARCH_DEFAULT_LIMIT, 1, SEARCH_MAX_LIMIT)
  const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const prefix = `${term}%`
  return {
    sql: SEARCH_SQL,
    params: [term, prefix, options.locale, limit, offset],
    term,
  }
}

/** Rotulo de motivo de casamento a partir do match_tier do SQL. */
export type SearchMatchReason = 'exact' | 'alias' | 'prefix' | 'fuzzy'

/** Traduz o match_tier numerico para o rotulo do contrato. */
export function matchReasonFromTier(tier: number): SearchMatchReason {
  switch (tier) {
    case 0:
      return 'exact'
    case 1:
      return 'alias'
    case 2:
    case 3:
      return 'prefix'
    default:
      return 'fuzzy'
  }
}

/** Score monotonico [0,1] a partir do tier + similaridade (maior = melhor). */
export function scoreFromTier(tier: number, similarity: number): number {
  const sim = Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0
  switch (tier) {
    case 0:
      return 1
    case 1:
      return 0.95
    case 2:
      return 0.9
    case 3:
      return 0.85
    default:
      // fuzzy: puxado pela similaridade trgm, sempre abaixo do prefixo.
      return Math.min(0.8, 0.4 + sim * 0.4)
  }
}
