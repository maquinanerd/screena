/**
 * args.ts — Parsers PUROS dos CLIs de revisao e promocao. Sem IO.
 *
 * FAIL-LOUD: aceita `--flag=valor` e `--flag valor`; flag desconhecida, valor
 * faltante ou invalido geram ERRO explicito — nunca default silencioso. Nenhum
 * default perigoso: a promocao exige `--ids` explicito e `--confirm` para
 * mutar; sem `--confirm` e sempre dry-run.
 */

import { STREAMING_AVAILABILITY_DEFAULT_COUNTRY } from '@screena/streaming-availability-client'

/** `movie` | `tv` (nunca season/episode/person). */
export type ReviewKind = 'movie' | 'tv'

/** Limite default de listagem da revisao. */
export const REVIEW_DEFAULT_LIMIT = 50

/** Argumentos do CLI de revisao. */
export interface ReviewArgs {
  /** Filtro por tipo; `null` = filme e serie. */
  readonly kind: ReviewKind | null
  /** ISO 3166-1 alpha-2 MAIUSCULO. */
  readonly country: string
  readonly entityId: number | null
  readonly limit: number
  /** Escreve o relatorio markdown em disco (`.data/`). */
  readonly report: boolean
}

/** Argumentos do CLI de promocao/reversao. */
export interface PromoteArgs {
  /** Ids explicitos (inteiros > 0, deduplicados, ordem preservada). */
  readonly ids: readonly number[]
  /** ISO 3166-1 alpha-2 MAIUSCULO. */
  readonly country: string
  /** Sem `--confirm` a execucao e dry-run (nao muta o banco). */
  readonly confirm: boolean
  /** `--revoke` volta `display_allowed` para `false`. */
  readonly revoke: boolean
  readonly report: boolean
}

export type ReviewArgsResult =
  | { readonly ok: true; readonly args: ReviewArgs }
  | { readonly ok: false; readonly error: string }

export type PromoteArgsResult =
  | { readonly ok: true; readonly args: PromoteArgs }
  | { readonly ok: false; readonly error: string }

/** Token cru: `{ name, value }`. `value` e `undefined` para flag booleana. */
interface Token {
  readonly name: string
  readonly value: string | undefined
}

/**
 * Tokeniza `argv` em `--flag` / `--flag=valor` / `--flag valor`, dado o conjunto
 * de flags que EXIGEM valor. Retorna erro em posicional solto ou valor faltante.
 */
function tokenize(
  argv: readonly string[],
  valueFlags: ReadonlySet<string>,
): { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly error: string } {
  const tokens: Token[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue
    if (!token.startsWith('--')) {
      return { ok: false, error: `argumento inesperado: "${token}" (use --flag=valor ou --flag valor).` }
    }

    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)

    if (valueFlags.has(name) && value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, error: `a flag "--${name}" exige um valor (use --${name}=valor ou --${name} valor).` }
      }
      value = next
      i += 1
    }
    tokens.push({ name, value })
  }
  return { ok: true, tokens }
}

/** Inteiro > 0 estrito (rejeita "1.5", "01", "abc", "-2"). */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim()
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== trimmed) return null
  return parsed
}

/** Normaliza e valida um pais ISO 3166-1 alpha-2. */
function normalizeCountry(raw: string): string | null {
  const candidate = raw.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(candidate) ? candidate : null
}

const REVIEW_VALUE_FLAGS: ReadonlySet<string> = new Set(['kind', 'country', 'entity-id', 'limit'])
const REVIEW_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['report'])

/** Parser fail-loud do CLI de revisao. */
export function parseReviewArgs(argv: readonly string[]): ReviewArgsResult {
  const tokenized = tokenize(argv, REVIEW_VALUE_FLAGS)
  if (!tokenized.ok) return { ok: false, error: tokenized.error }

  let kind: ReviewKind | null = null
  let country = STREAMING_AVAILABILITY_DEFAULT_COUNTRY
  let entityId: number | null = null
  let limit = REVIEW_DEFAULT_LIMIT
  let report = false

  for (const token of tokenized.tokens) {
    const { name, value } = token

    if (REVIEW_BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) return { ok: false, error: `a flag "--${name}" e booleana e nao aceita valor.` }
      report = true
      continue
    }
    if (!REVIEW_VALUE_FLAGS.has(name)) return { ok: false, error: `flag desconhecida: "--${name}".` }
    if (value === undefined || value.trim() === '') {
      return { ok: false, error: `a flag "--${name}" recebeu valor vazio.` }
    }

    switch (name) {
      case 'kind': {
        const candidate = value.trim().toLowerCase()
        if (candidate !== 'movie' && candidate !== 'tv') {
          return { ok: false, error: `--kind invalido: "${value}". Use "movie" ou "tv".` }
        }
        kind = candidate
        break
      }
      case 'country': {
        const normalized = normalizeCountry(value)
        if (normalized === null) {
          return { ok: false, error: `--country invalido: "${value}". Use ISO 3166-1 alpha-2 (ex.: BR).` }
        }
        country = normalized
        break
      }
      case 'entity-id': {
        const parsed = parsePositiveInt(value)
        if (parsed === null) return { ok: false, error: `--entity-id invalido: "${value}". Use um inteiro > 0.` }
        entityId = parsed
        break
      }
      case 'limit': {
        const parsed = parsePositiveInt(value)
        if (parsed === null) return { ok: false, error: `--limit invalido: "${value}". Use um inteiro > 0.` }
        limit = parsed
        break
      }
    }
  }

  return { ok: true, args: { kind, country, entityId, limit, report } }
}

const PROMOTE_VALUE_FLAGS: ReadonlySet<string> = new Set(['ids', 'country'])
const PROMOTE_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['confirm', 'revoke', 'report'])

/** Faz o parse de `--ids=1,2,3`: inteiros > 0, deduplicados, ordem preservada. */
function parseIds(raw: string): { readonly ok: true; readonly ids: readonly number[] } | { readonly ok: false; readonly error: string } {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return { ok: false, error: '--ids nao pode ser vazio (use --ids=1,2,3).' }

  const ids: number[] = []
  const seen = new Set<number>()
  for (const part of parts) {
    const parsed = parsePositiveInt(part)
    if (parsed === null) return { ok: false, error: `--ids contem um id invalido: "${part}". Use inteiros > 0 separados por virgula.` }
    if (!seen.has(parsed)) {
      seen.add(parsed)
      ids.push(parsed)
    }
  }
  return { ok: true, ids }
}

/** Parser fail-loud do CLI de promocao/reversao. `--ids` e obrigatorio. */
export function parsePromoteArgs(argv: readonly string[]): PromoteArgsResult {
  const tokenized = tokenize(argv, PROMOTE_VALUE_FLAGS)
  if (!tokenized.ok) return { ok: false, error: tokenized.error }

  let ids: readonly number[] | null = null
  let country = STREAMING_AVAILABILITY_DEFAULT_COUNTRY
  let confirm = false
  let revoke = false
  let report = false

  for (const token of tokenized.tokens) {
    const { name, value } = token

    if (PROMOTE_BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) return { ok: false, error: `a flag "--${name}" e booleana e nao aceita valor.` }
      if (name === 'confirm') confirm = true
      if (name === 'revoke') revoke = true
      if (name === 'report') report = true
      continue
    }
    if (!PROMOTE_VALUE_FLAGS.has(name)) return { ok: false, error: `flag desconhecida: "--${name}".` }
    if (value === undefined || value.trim() === '') {
      return { ok: false, error: `a flag "--${name}" recebeu valor vazio.` }
    }

    switch (name) {
      case 'ids': {
        const parsed = parseIds(value)
        if (!parsed.ok) return { ok: false, error: parsed.error }
        ids = parsed.ids
        break
      }
      case 'country': {
        const normalized = normalizeCountry(value)
        if (normalized === null) {
          return { ok: false, error: `--country invalido: "${value}". Use ISO 3166-1 alpha-2 (ex.: BR).` }
        }
        country = normalized
        break
      }
    }
  }

  if (ids === null) {
    return { ok: false, error: '--ids e obrigatorio (selecao explicita): use --ids=1,2,3.' }
  }

  return { ok: true, args: { ids, country, confirm, revoke, report } }
}
