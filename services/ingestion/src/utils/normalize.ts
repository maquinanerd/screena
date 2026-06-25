/**
 * normalize.ts — Normalizacoes puras de campos TMDB.
 *
 * Sem rede/DB. A ingestao NAO inventa dado: campos ausentes/invalidos viram
 * `null`. Em especial, `original_language` so e mantido quando o codigo existe
 * em `languages` (R1 do plano da Fase 2); caso contrario, `null` — nunca cria
 * idioma fora do seed (a FK `movies.original_language -> languages.code` exige).
 */

import { LANGUAGE_SEED } from '@screena/db'

/** Codigos de idioma conhecidos (espelha o seed `languages`). */
const KNOWN_LANGUAGE_CODES: ReadonlySet<string> = new Set(LANGUAGE_SEED.map((lang) => lang.code))

/** String nao-vazia (trimada) ou null. */
export function nullableString(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/** Numero finito ou null. */
export function nullableNumber(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** imdb_id valido (nao-vazio) ou null. Respeita o CHECK `imdb_id <> ''`. */
export function normalizeImdbId(raw: string | null | undefined): string | null {
  return nullableString(raw)
}

/** Data TMDB ('YYYY-MM-DD') validada por forma, ou null. Nao tenta corrigir. */
export function normalizeDate(raw: string | null | undefined): string | null {
  const value = nullableString(raw)
  if (value === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/** original_language: mantido so se existir em `languages`; senao null (R1). */
export function normalizeOriginalLanguage(raw: string | null | undefined): string | null {
  const code = nullableString(raw)
  if (code === null) return null
  return KNOWN_LANGUAGE_CODES.has(code) ? code : null
}

/** True se o codigo de idioma e conhecido (existe no seed `languages`). */
export function isKnownLanguage(code: string): boolean {
  return KNOWN_LANGUAGE_CODES.has(code)
}
