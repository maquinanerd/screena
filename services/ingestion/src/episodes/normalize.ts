/**
 * normalize.ts — Normalizadores PUROS do caminho de episodio (Backend A §7):
 * elenco, guest stars, equipe, ids externos e stills.
 *
 * Consomem tanto o item de `/tv/{id}/season/{n}` (episodes[]) quanto o detalhe
 * `/tv/{id}/season/{n}/episode/{e}` — a forma dos blocos e a mesma.
 *
 * Defensivos: o payload cru e `unknown`; qualquer entrada sem id de pessoa
 * inteiro positivo ou sem nome util e DESCARTADA (a ingestao nunca inventa
 * fato nem cria pessoa). Puro: sem rede, DB ou IO.
 */

/** Credito de elenco de episodio. `isGuest` separa guest star do elenco regular. */
export interface EpisodeCreditRow {
  readonly personTmdbId: number
  readonly name: string
  readonly character: string | null
  readonly billingOrder: number | null
  readonly creditId: string | null
  readonly isGuest: boolean
}

/** Credito de equipe (crew) de episodio. */
export interface EpisodeCrewRow {
  readonly personTmdbId: number
  readonly name: string
  readonly department: string | null
  readonly job: string | null
  readonly creditId: string | null
}

/** Id externo de episodio. IMDb aqui e SO identificador, NUNCA fonte de rating. */
export interface EpisodeExternalIdRow {
  readonly source: string
  readonly externalId: string
}

/** Still (frame) de episodio. Nasce sem licenca de exibicao (invariante 6). */
export interface EpisodeStillRow {
  readonly filePath: string
  readonly languageCode: string | null
  readonly width: number | null
  readonly height: number | null
  readonly aspectRatio: number | null
  readonly voteAverage: number | null
  readonly voteCount: number | null
}

/** imdb_id de episodio ('ttNNNN'). Fora desta forma, o id e descartado. */
const IMDB_ID_PATTERN = /^tt\d+$/

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

/** Inteiro qualquer ou null. Aceita 0 (ex.: `order` do topo do elenco). */
function intOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/** Numero finito ou null. */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** String nao-vazia aparada, ou null. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Bloco `credits` do payload, quando existir. */
function creditsBlock(payload: unknown): Record<string, unknown> | null {
  const raw = asRecord(payload)
  if (raw === null) return null
  return asRecord(raw.credits)
}

function toCreditRow(item: unknown, isGuest: boolean): EpisodeCreditRow | null {
  const raw = asRecord(item)
  if (raw === null) return null
  const personTmdbId = posInt(raw.id)
  const name = str(raw.name)
  if (personTmdbId === null || name === null) return null
  return {
    personTmdbId,
    name,
    character: str(raw.character),
    billingOrder: intOrNull(raw.order),
    creditId: str(raw.credit_id),
    isGuest,
  }
}

function toCrewRow(item: unknown): EpisodeCrewRow | null {
  const raw = asRecord(item)
  if (raw === null) return null
  const personTmdbId = posInt(raw.id)
  const name = str(raw.name)
  if (personTmdbId === null || name === null) return null
  return {
    personTmdbId,
    name,
    department: str(raw.department),
    job: str(raw.job),
    creditId: str(raw.credit_id),
  }
}

/** Deduplica creditos por `credit_id` quando houver; senao pelo id da pessoa. */
function dedupeCredits(rows: readonly EpisodeCreditRow[]): EpisodeCreditRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = row.creditId !== null ? `credit:${row.creditId}` : `person:${row.personTmdbId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Deduplica guest stars pelo id da pessoa (guest_stars[] e credits.guest_stars[] se sobrepoem). */
function dedupeByPerson(rows: readonly EpisodeCreditRow[]): EpisodeCreditRow[] {
  const seen = new Set<number>()
  return rows.filter((row) => {
    if (seen.has(row.personTmdbId)) return false
    seen.add(row.personTmdbId)
    return true
  })
}

/**
 * Deduplica equipe por `credit_id` quando houver; senao por pessoa+departamento+
 * funcao — uma mesma pessoa pode acumular funcoes (ex.: Director e Writer) e
 * essas linhas NAO podem colapsar em uma so.
 */
function dedupeCrew(rows: readonly EpisodeCrewRow[]): EpisodeCrewRow[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key =
      row.creditId !== null
        ? `credit:${row.creditId}`
        : `person:${row.personTmdbId}|${row.department ?? '-'}|${row.job ?? '-'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Elenco regular do episodio (`credits.cast`). Sempre `isGuest=false`. */
export function extractEpisodeCast(payload: unknown): EpisodeCreditRow[] {
  const credits = creditsBlock(payload)
  if (credits === null) return []
  const rows: EpisodeCreditRow[] = []
  for (const item of asArray(credits.cast)) {
    const row = toCreditRow(item, false)
    if (row !== null) rows.push(row)
  }
  return dedupeCredits(rows)
}

/**
 * Guest stars do episodio. O TMDB expoe `guest_stars` no topo (lista da temporada)
 * e/ou em `credits.guest_stars` (detalhe do episodio) — as duas formas sao lidas e
 * deduplicadas por pessoa. Sempre `isGuest=true`.
 */
export function extractEpisodeGuestStars(payload: unknown): EpisodeCreditRow[] {
  const raw = asRecord(payload)
  if (raw === null) return []
  const credits = asRecord(raw.credits)
  const items = [...asArray(raw.guest_stars), ...asArray(credits?.guest_stars)]
  const rows: EpisodeCreditRow[] = []
  for (const item of items) {
    const row = toCreditRow(item, true)
    if (row !== null) rows.push(row)
  }
  return dedupeByPerson(rows)
}

/** Equipe do episodio (`credits.crew`). */
export function extractEpisodeCrew(payload: unknown): EpisodeCrewRow[] {
  const credits = creditsBlock(payload)
  if (credits === null) return []
  const rows: EpisodeCrewRow[] = []
  for (const item of asArray(credits.crew)) {
    const row = toCrewRow(item)
    if (row !== null) rows.push(row)
  }
  return dedupeCrew(rows)
}

/**
 * Ids externos do episodio (`external_ids`). So grava `imdb` quando o id casa com
 * 'ttNNNN' e `tvdb` quando ha inteiro positivo. IMDb aqui e SO identificador/
 * referencia, NUNCA fonte de rating (invariantes 1/2).
 */
export function extractEpisodeExternalIds(payload: unknown): EpisodeExternalIdRow[] {
  const raw = asRecord(payload)
  if (raw === null) return []
  const block = asRecord(raw.external_ids)
  if (block === null) return []
  const rows: EpisodeExternalIdRow[] = []
  const imdbId = str(block.imdb_id)
  if (imdbId !== null && IMDB_ID_PATTERN.test(imdbId)) {
    rows.push({ source: 'imdb', externalId: imdbId })
  }
  const tvdbId = posInt(block.tvdb_id)
  if (tvdbId !== null) {
    rows.push({ source: 'tvdb', externalId: String(tvdbId) })
  }
  return rows
}

/** Stills do episodio (`images.stills`). Item sem `file_path` e descartado. */
export function extractEpisodeStills(payload: unknown): EpisodeStillRow[] {
  const raw = asRecord(payload)
  if (raw === null) return []
  const images = asRecord(raw.images)
  if (images === null) return []
  const rows: EpisodeStillRow[] = []
  const seen = new Set<string>()
  for (const item of asArray(images.stills)) {
    const still = asRecord(item)
    if (still === null) continue
    const filePath = str(still.file_path)
    if (filePath === null || seen.has(filePath)) continue
    seen.add(filePath)
    rows.push({
      filePath,
      languageCode: str(still.iso_639_1),
      width: intOrNull(still.width),
      height: intOrNull(still.height),
      aspectRatio: numOrNull(still.aspect_ratio),
      voteAverage: numOrNull(still.vote_average),
      voteCount: intOrNull(still.vote_count),
    })
  }
  return rows
}
