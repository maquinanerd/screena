/**
 * detail-facts.ts — Normaliza os FATOS DA FICHA que o detalhe do TMDB ja
 * entregava e o pipeline descartava: orcamento, paises de origem e o recorte
 * BR de classificacao indicativa/estreia regional.
 *
 * Quarta ocorrencia do mesmo padrao (dado baixado e jogado fora), depois de
 * `watch/providers` (#181), biografia (#190) e `recommendations` (#191). Desde
 * a #191 o descarte e DECLARADO no manifest de append
 * (`api-clients/tmdb/src/append-consumption.ts`); esta unidade move
 * `release_dates`/`content_ratings` de "adiado" para "consumido".
 *
 * PURO: sem rede, sem banco, sem `Date`.
 */

import type { TitleCountryLink } from '../types.js'

/** Resultado com a semantica de PRESENCA (a licao do apagao de creditos). */
export interface NormalizedTitleCountries {
  readonly links: TitleCountryLink[]
  /**
   * A fonte trouxe o ARRAY (mesmo vazio)? `false` = "o payload nao falou de
   * pais", nunca "este titulo nao tem pais" — e decide se a escrita pode
   * substituir os vinculos existentes.
   */
  readonly present: boolean
}

const ISO_ALPHA2 = /^[A-Z]{2}$/

function pushCountry(
  links: TitleCountryLink[],
  vistos: Set<string>,
  raw: unknown,
): void {
  if (typeof raw !== 'string') return
  const code = raw.trim().toUpperCase()
  if (!ISO_ALPHA2.test(code)) return
  if (vistos.has(code)) return
  vistos.add(code)
  links.push({ countryCode: code, position: links.length })
}

/**
 * `production_countries` do detalhe de FILME: `[{ iso_3166_1, name }]`.
 * Preserva a ordem do payload; item sem codigo valido e descartado sem deixar
 * buraco na posicao.
 */
export function normalizeMovieProductionCountries(raw: unknown): NormalizedTitleCountries {
  if (!Array.isArray(raw)) return { links: [], present: false }
  const links: TitleCountryLink[] = []
  const vistos = new Set<string>()
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    pushCountry(links, vistos, (item as { iso_3166_1?: unknown }).iso_3166_1)
  }
  return { links, present: true }
}

/** `origin_country` do detalhe de SERIE: `["BR", "US"]`. */
export function normalizeTvOriginCountries(raw: unknown): NormalizedTitleCountries {
  if (!Array.isArray(raw)) return { links: [], present: false }
  const links: TitleCountryLink[] = []
  const vistos = new Set<string>()
  for (const item of raw) pushCountry(links, vistos, item)
  return { links, present: true }
}

/**
 * `budget` do detalhe de FILME.
 *
 * A API publica o valor como INTEIRO em dolar (convencao documentada da TMDB;
 * nao ha campo de moeda por titulo). `0` significa "nao informado" e vira
 * `null` — nunca um orcamento de zero. Valor nao-inteiro/negativo idem.
 */
export function normalizeBudget(raw: unknown): bigint | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return null
  return BigInt(raw)
}

/** O recorte BR de `release_dates` (filme). */
export interface BrReleaseFacts {
  /**
   * Classificacao indicativa BRASILEIRA. So a do recorte BR e persistida:
   * classificacao de outro pais NUNCA entra sem rotulo de pais — e a coluna
   * nao tem rotulo, entao so a BR entra (regra da ficha, 20/08/2026).
   */
  readonly certification: string | null
  /** Estreia regional BR (`YYYY-MM-DD`), preferindo a de cinema (type 3). */
  readonly releaseDateBr: string | null
  /** O append veio no payload? (`false` = nao falou; nada e substituido.) */
  readonly present: boolean
}

interface RawReleaseEntry {
  readonly certification: string | null
  readonly releaseDate: string | null
  readonly type: number | null
}

function readReleaseEntries(country: unknown): RawReleaseEntry[] {
  if (country === null || typeof country !== 'object') return []
  const list = (country as { release_dates?: unknown }).release_dates
  if (!Array.isArray(list)) return []
  const out: RawReleaseEntry[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const cert = (item as { certification?: unknown }).certification
    const date = (item as { release_date?: unknown }).release_date
    const type = (item as { type?: unknown }).type
    out.push({
      certification: typeof cert === 'string' && cert.trim() !== '' ? cert.trim() : null,
      releaseDate:
        typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null,
      type: typeof type === 'number' && Number.isInteger(type) ? type : null,
    })
  }
  return out
}

/**
 * Extrai o recorte BR de `release_dates` (`{ results: [{ iso_3166_1,
 * release_dates: [...] }] }`).
 *
 * Preferencias, e por que:
 *  - CLASSIFICACAO: a primeira nao-vazia na ordem de tipo (3=cinema, 4=digital,
 *    depois o resto na ordem do payload). O cinema e o recorte que o orgao
 *    brasileiro classifica primeiro.
 *  - ESTREIA: a data do lancamento de CINEMA (type 3); sem cinema, a MENOR data
 *    valida do recorte BR (a primeira vez que o titulo esteve disponivel no
 *    Brasil) — nunca uma media nem a de outro pais.
 */
export function normalizeBrReleaseFacts(raw: unknown): BrReleaseFacts {
  if (raw === null || typeof raw !== 'object') {
    return { certification: null, releaseDateBr: null, present: false }
  }
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results)) {
    return { certification: null, releaseDateBr: null, present: false }
  }

  const br = results.find(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      (item as { iso_3166_1?: unknown }).iso_3166_1 === 'BR',
  )
  const entries = readReleaseEntries(br)
  if (entries.length === 0) {
    return { certification: null, releaseDateBr: null, present: true }
  }

  const byTypePreference = [...entries].sort((a, b) => {
    const rank = (t: number | null): number => (t === 3 ? 0 : t === 4 ? 1 : 2)
    return rank(a.type) - rank(b.type)
  })
  const certification = byTypePreference.find((e) => e.certification !== null)?.certification ?? null

  const theatrical = entries.find((e) => e.type === 3 && e.releaseDate !== null)
  const earliest = entries
    .map((e) => e.releaseDate)
    .filter((d): d is string => d !== null)
    .sort()[0]
  const releaseDateBr = theatrical?.releaseDate ?? earliest ?? null

  return { certification, releaseDateBr, present: true }
}

/** O recorte BR de `content_ratings` (serie): `{ results: [{ iso_3166_1, rating }] }`. */
export interface BrContentRating {
  readonly certification: string | null
  readonly present: boolean
}

export function normalizeBrContentRating(raw: unknown): BrContentRating {
  if (raw === null || typeof raw !== 'object') return { certification: null, present: false }
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results)) return { certification: null, present: false }
  for (const item of results) {
    if (item === null || typeof item !== 'object') continue
    if ((item as { iso_3166_1?: unknown }).iso_3166_1 !== 'BR') continue
    const rating = (item as { rating?: unknown }).rating
    if (typeof rating === 'string' && rating.trim() !== '') {
      return { certification: rating.trim(), present: true }
    }
  }
  return { certification: null, present: true }
}
