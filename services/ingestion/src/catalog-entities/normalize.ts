/**
 * normalize.ts — Normalizadores PUROS das entidades de referencia do catalogo
 * (colecoes, produtoras, redes, keywords, titulos alternativos) — Backend A §6.
 *
 * Duas familias:
 *  - `normalize*Detail`: consomem o GET dedicado (/collection/{id}, /company/{id},
 *    /network/{id}, /keyword/{id}).
 *  - `extract*`: colhem as MESMAS entidades de dentro do detalhe de movie/tv (que
 *    ja traz belongs_to_collection / production_companies / networks / keywords /
 *    alternative_titles via append_to_response) — evita N+1 de requisicoes.
 *
 * Defensivos: payload cru e `unknown`; qualquer item sem id/nome util e DESCARTADO
 * (nunca inventa fato). Puro: sem rede, DB ou IO.
 */

import { foldText } from '../search/fold.js'

/** Linha normalizada de colecao. */
export interface CollectionRow {
  readonly tmdbId: number
  readonly name: string
  readonly overview: string | null
  readonly posterPath: string | null
  readonly backdropPath: string | null
}

/** Linha normalizada de produtora. */
export interface CompanyRow {
  readonly tmdbId: number
  readonly name: string
  readonly logoPath: string | null
  readonly originCountry: string | null
  readonly headquarters: string | null
  readonly homepage: string | null
}

/** Linha normalizada de rede (TV network). */
export type NetworkRow = CompanyRow

/** Linha normalizada de keyword. */
export interface KeywordRow {
  readonly tmdbId: number
  readonly name: string
}

/** Linha normalizada de titulo alternativo. `normalized` alimenta o alias da busca. */
export interface AlternativeTitleRow {
  readonly countryCode: string | null
  readonly title: string
  readonly normalized: string
  readonly type: string | null
}

/** Um filme membro de uma colecao (parts[] do /collection/{id}). */
export interface CollectionPartRow {
  readonly tmdbId: number
  readonly position: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Inteiro positivo ou null (ids TMDB). */
function posInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** String nao-vazia aparada, ou null. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

// ---------------------------------------------------------------------------
// Detalhes dedicados
// ---------------------------------------------------------------------------

/** Normaliza `GET /collection/{id}`. Sem id/nome => null (descartado). */
export function normalizeCollectionDetail(payload: unknown): CollectionRow | null {
  const raw = asRecord(payload)
  if (raw === null) return null
  const tmdbId = posInt(raw.id)
  const name = str(raw.name)
  if (tmdbId === null || name === null) return null
  return {
    tmdbId,
    name,
    overview: str(raw.overview),
    posterPath: str(raw.poster_path),
    backdropPath: str(raw.backdrop_path),
  }
}

/** Membros de uma colecao (`parts[]`), na ordem do payload. */
export function normalizeCollectionParts(payload: unknown): CollectionPartRow[] {
  const raw = asRecord(payload)
  if (raw === null) return []
  const parts: CollectionPartRow[] = []
  asArray(raw.parts).forEach((item) => {
    const part = asRecord(item)
    const tmdbId = part === null ? null : posInt(part.id)
    if (tmdbId === null) return
    parts.push({ tmdbId, position: parts.length })
  })
  return parts
}

/** Normaliza `GET /company/{id}`. */
export function normalizeCompanyDetail(payload: unknown): CompanyRow | null {
  const raw = asRecord(payload)
  if (raw === null) return null
  const tmdbId = posInt(raw.id)
  const name = str(raw.name)
  if (tmdbId === null || name === null) return null
  return {
    tmdbId,
    name,
    logoPath: str(raw.logo_path),
    originCountry: str(raw.origin_country),
    headquarters: str(raw.headquarters),
    homepage: str(raw.homepage),
  }
}

/** Normaliza `GET /network/{id}` (mesma forma de company). */
export function normalizeNetworkDetail(payload: unknown): NetworkRow | null {
  return normalizeCompanyDetail(payload)
}

/** Normaliza `GET /keyword/{id}`. */
export function normalizeKeywordDetail(payload: unknown): KeywordRow | null {
  const raw = asRecord(payload)
  if (raw === null) return null
  const tmdbId = posInt(raw.id)
  const name = str(raw.name)
  if (tmdbId === null || name === null) return null
  return { tmdbId, name }
}

// ---------------------------------------------------------------------------
// Extracao a partir do detalhe de movie/tv (append_to_response)
// ---------------------------------------------------------------------------

/** `belongs_to_collection` do detalhe de filme (sem overview: o GET dedicado traz). */
export function extractCollectionRef(detail: unknown): CollectionRow | null {
  const raw = asRecord(detail)
  if (raw === null) return null
  const ref = asRecord(raw.belongs_to_collection)
  if (ref === null) return null
  const tmdbId = posInt(ref.id)
  const name = str(ref.name)
  if (tmdbId === null || name === null) return null
  return {
    tmdbId,
    name,
    overview: null,
    posterPath: str(ref.poster_path),
    backdropPath: str(ref.backdrop_path),
  }
}

/** Deduplica linhas por tmdbId preservando a primeira ocorrencia. */
function dedupeByTmdbId<T extends { tmdbId: number }>(rows: T[]): T[] {
  const seen = new Set<number>()
  return rows.filter((row) => {
    if (seen.has(row.tmdbId)) return false
    seen.add(row.tmdbId)
    return true
  })
}

/** `production_companies[]` do detalhe de movie/tv. */
export function extractProductionCompanies(detail: unknown): CompanyRow[] {
  const raw = asRecord(detail)
  if (raw === null) return []
  const rows: CompanyRow[] = []
  for (const item of asArray(raw.production_companies)) {
    const c = asRecord(item)
    if (c === null) continue
    const tmdbId = posInt(c.id)
    const name = str(c.name)
    if (tmdbId === null || name === null) continue
    rows.push({
      tmdbId,
      name,
      logoPath: str(c.logo_path),
      originCountry: str(c.origin_country),
      headquarters: null,
      homepage: null,
    })
  }
  return dedupeByTmdbId(rows)
}

/** `networks[]` do detalhe de tv. */
export function extractNetworks(detail: unknown): NetworkRow[] {
  const raw = asRecord(detail)
  if (raw === null) return []
  const rows: NetworkRow[] = []
  for (const item of asArray(raw.networks)) {
    const n = asRecord(item)
    if (n === null) continue
    const tmdbId = posInt(n.id)
    const name = str(n.name)
    if (tmdbId === null || name === null) continue
    rows.push({
      tmdbId,
      name,
      logoPath: str(n.logo_path),
      originCountry: str(n.origin_country),
      headquarters: null,
      homepage: null,
    })
  }
  return dedupeByTmdbId(rows)
}

/**
 * `keywords` do append. Movie usa `{ keywords: [...] }`; TV usa `{ results: [...] }`
 * — aceita as duas formas.
 */
export function extractKeywords(detail: unknown): KeywordRow[] {
  const raw = asRecord(detail)
  if (raw === null) return []
  const block = asRecord(raw.keywords)
  if (block === null) return []
  const items = [...asArray(block.keywords), ...asArray(block.results)]
  const rows: KeywordRow[] = []
  for (const item of items) {
    const k = asRecord(item)
    if (k === null) continue
    const tmdbId = posInt(k.id)
    const name = str(k.name)
    if (tmdbId === null || name === null) continue
    rows.push({ tmdbId, name })
  }
  return dedupeByTmdbId(rows)
}

/**
 * `alternative_titles` do append. Movie usa `{ titles: [...] }`; TV usa
 * `{ results: [...] }`. `normalized` usa a MESMA dobra da busca (alias exato).
 */
export function extractAlternativeTitles(detail: unknown): AlternativeTitleRow[] {
  const raw = asRecord(detail)
  if (raw === null) return []
  const block = asRecord(raw.alternative_titles)
  if (block === null) return []
  const items = [...asArray(block.titles), ...asArray(block.results)]
  const rows: AlternativeTitleRow[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const t = asRecord(item)
    if (t === null) continue
    const title = str(t.title)
    if (title === null) continue
    const countryCode = str(t.iso_3166_1)
    const key = `${countryCode ?? '-'}|${foldText(title)}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      countryCode,
      title,
      normalized: foldText(title),
      type: str(t.type),
    })
  }
  return rows
}
