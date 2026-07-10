/**
 * args.ts — Parser PURO dos argumentos do CLI de disponibilidade. Sem IO.
 *
 * FAIL-LOUD: aceita `--flag=valor` e `--flag valor`; valor faltante, flag
 * desconhecida ou valor invalido geram ERRO explicito — nunca default silencioso.
 *
 * Booleans: `--sample`, `--apply`, `--dry-run` (default implicito).
 * Valor: `--kind` (movie|tv), `--country` (default BR), `--limit` (int > 0),
 *        `--tmdb-id` (int > 0), `--imdb-id` (tt\d+), `--report` (string).
 */

import {
  isImdbId,
  isStreamingKind,
  STREAMING_AVAILABILITY_DEFAULT_COUNTRY,
  type StreamingAvailabilityKind,
} from '@screena/streaming-availability-client'

/** Argumentos parseados. */
export interface StreamingArgs {
  readonly apply: boolean
  readonly sample: boolean
  readonly kind: StreamingAvailabilityKind
  /** ISO 3166-1 alpha-2 MAIUSCULO. */
  readonly country: string
  readonly limit: number | null
  readonly tmdbId: number | null
  readonly imdbId: string | null
  readonly report: string | null
}

/** Resultado do parse. */
export type StreamingArgsResult =
  | { readonly ok: true; readonly args: StreamingArgs }
  | { readonly ok: false; readonly error: string }

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['sample', 'apply', 'dry-run'])
const STRING_FLAGS: ReadonlySet<string> = new Set(['kind', 'country', 'imdb-id', 'report'])
const INT_FLAGS: ReadonlySet<string> = new Set(['limit', 'tmdb-id'])

function fail(error: string): StreamingArgsResult {
  return { ok: false, error }
}

/** Faz o parse fail-loud dos argumentos. */
export function parseStreamingArgs(argv: readonly string[]): StreamingArgsResult {
  let apply = false
  let sample = false
  let kind: StreamingAvailabilityKind | null = null
  let country = STREAMING_AVAILABILITY_DEFAULT_COUNTRY
  let limit: number | null = null
  let tmdbId: number | null = null
  let imdbId: string | null = null
  let report: string | null = null

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue

    if (!token.startsWith('--')) {
      return fail(`argumento inesperado: "${token}" (use --flag=valor ou --flag valor).`)
    }

    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)

    if (BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) return fail(`a flag "--${name}" e booleana e nao aceita valor.`)
      if (name === 'apply') apply = true
      if (name === 'sample') sample = true
      continue
    }

    if (!STRING_FLAGS.has(name) && !INT_FLAGS.has(name)) {
      return fail(`flag desconhecida: "--${name}".`)
    }

    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        return fail(`a flag "--${name}" exige um valor (use --${name}=valor ou --${name} valor).`)
      }
      value = next
      i += 1
    }

    if (value.trim() === '') return fail(`a flag "--${name}" recebeu valor vazio.`)

    switch (name) {
      case 'kind': {
        const candidate = value.trim()
        if (!isStreamingKind(candidate)) {
          return fail(`--kind invalido: "${candidate}". Use "movie" ou "tv".`)
        }
        kind = candidate
        break
      }
      case 'country': {
        const candidate = value.trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(candidate)) {
          return fail(`--country invalido: "${value}". Use ISO 3166-1 alpha-2 (ex.: BR).`)
        }
        country = candidate
        break
      }
      case 'imdb-id': {
        const candidate = value.trim()
        if (!isImdbId(candidate)) {
          return fail(`--imdb-id invalido: "${candidate}". Use o formato "tt0111161".`)
        }
        imdbId = candidate
        break
      }
      case 'report': {
        report = value
        break
      }
      default: {
        const parsed = Number.parseInt(value, 10)
        if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
          return fail(`--${name} invalido: "${value}". Use um inteiro > 0.`)
        }
        if (name === 'limit') limit = parsed
        else tmdbId = parsed
      }
    }
  }

  if (kind === null) {
    return fail('--kind e obrigatorio (use --kind=movie ou --kind=tv).')
  }
  if (tmdbId !== null && imdbId !== null) {
    return fail('--tmdb-id e --imdb-id sao mutuamente exclusivos.')
  }

  return { ok: true, args: { apply, sample, kind, country, limit, tmdbId, imdbId, report } }
}
