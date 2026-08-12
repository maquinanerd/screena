/**
 * args.ts — Parser PURO dos argumentos do worker OMDb. Sem IO.
 *
 * FAIL-LOUD: aceita `--flag=valor` e `--flag valor`; valor faltante, flag
 * desconhecida ou valor invalido geram ERRO explicito — nunca fallback
 * silencioso. Sob `--apply` isso e critico.
 *
 * `--type` aqui e `movie|tv` (o vocabulario do BANCO), e nao `film|show` (o
 * vocabulario do provedor anterior): a OMDb nao tem esse eixo, entao traduzir
 * de um vocabulario de provedor para outro so acrescentaria uma chance de erro.
 */

import { isImdbId } from '@screena/omdb-client'

import type { RatingsEntityType } from './types.js'

/** Argumentos parseados (null = nao informado -> o CLI aplica o default). */
export interface OmdbArgs {
  /** `true` so quando `--apply` foi passado explicitamente. */
  readonly apply: boolean
  /** `true` quando `--sample`: busca payload real e salva sample sanitizado. */
  readonly sample: boolean
  readonly type: RatingsEntityType | null
  /** IMDb id explicito (`tt<digitos>`); `null` = modo candidatos. */
  readonly id: string | null
  readonly limit: number | null
  readonly report: string | null
  /** `--ignore-freshness`: reconsulta mesmo quem foi visto ha pouco. */
  readonly ignoreFreshness: boolean
}

/** Resultado do parse: sucesso com args, ou falha com mensagem clara. */
export type OmdbArgsResult =
  | { readonly ok: true; readonly args: OmdbArgs }
  | { readonly ok: false; readonly error: string }

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'sample',
  'apply',
  'dry-run',
  'ignore-freshness',
])
const STRING_FLAGS: ReadonlySet<string> = new Set(['type', 'id', 'report'])
const INT_FLAGS: ReadonlySet<string> = new Set(['limit'])

const ENTITY_TYPES: ReadonlySet<string> = new Set(['movie', 'tv'])

function fail(error: string): OmdbArgsResult {
  return { ok: false, error }
}

/** Faz o parse fail-loud dos argumentos. */
export function parseOmdbArgs(argv: readonly string[]): OmdbArgsResult {
  let apply = false
  let sample = false
  let type: RatingsEntityType | null = null
  let id: string | null = null
  let limit: number | null = null
  let report: string | null = null
  let ignoreFreshness = false

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
      if (value !== undefined) {
        return fail(`a flag "--${name}" e booleana e nao aceita valor.`)
      }
      if (name === 'apply') apply = true
      if (name === 'sample') sample = true
      if (name === 'ignore-freshness') ignoreFreshness = true
      // `--dry-run` e o default: aceito explicitamente, sem efeito colateral.
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

    if (value.trim() === '') {
      return fail(`a flag "--${name}" recebeu valor vazio.`)
    }

    if (name === 'type') {
      const candidate = value.trim()
      if (!ENTITY_TYPES.has(candidate)) {
        return fail(`--type invalido: "${candidate}". Use "movie" ou "tv".`)
      }
      type = candidate as RatingsEntityType
      continue
    }

    if (name === 'id') {
      const candidate = value.trim()
      if (!isImdbId(candidate)) {
        return fail(`--id invalido: "${candidate}". Use um IMDb id no formato tt<digitos>.`)
      }
      id = candidate
      continue
    }

    if (name === 'report') {
      report = value
      continue
    }

    // INT_FLAGS
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
      return fail(`--${name} invalido: "${value}". Use um inteiro > 0.`)
    }
    limit = parsed
  }

  if (apply && type === null) {
    // Sem `--type` nao sabemos se um id e filme ou serie. Atribuir nota a
    // entidade errada e pior que nao gravar: exigimos o tipo explicito.
    return fail('--apply exige --type=movie|tv (o tipo define a entidade na atribuicao).')
  }

  if (sample && id === null && type === null) {
    return fail(
      '--sample sem --id exige --type=movie|tv (a selecao de candidatos locais precisa do tipo).',
    )
  }

  if (ignoreFreshness && id !== null) {
    // `--id` ja ignora frescor por construcao. Aceitar a flag junto sugeriria
    // que ela faz algo aqui — e nao faz.
    return fail('--ignore-freshness nao se aplica com --id (um id explicito ja e sempre consultado).')
  }

  return { ok: true, args: { apply, sample, type, id, limit, report, ignoreFreshness } }
}
