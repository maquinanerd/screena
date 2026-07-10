/**
 * args.ts — Parser PURO dos argumentos do CLI de ratings. Sem IO.
 *
 * FAIL-LOUD (mesma licao do raw sync P0-00d): aceita `--flag=valor` e
 * `--flag valor`; valor faltante, flag desconhecida ou valor invalido geram ERRO
 * explicito — nunca fallback silencioso. Sob `--apply` isso e critico.
 *
 * Booleans: `--sample`, `--apply`, `--dry-run` (default implicito).
 * Valor: `--type` (film|show), `--limit` (inteiro > 0), `--report` (string).
 */

import {
  isImdbId,
  isPopularType,
  type FilmShowRatingsPopularType,
} from '@screena/film-show-ratings-client'

/** Argumentos parseados (null = nao informado -> o CLI aplica o default). */
export interface FilmShowRatingsArgs {
  /** `true` so quando `--apply` foi passado explicitamente. */
  readonly apply: boolean
  /** `true` quando `--sample`: busca payload real e salva sample sanitizado. */
  readonly sample: boolean
  readonly type: FilmShowRatingsPopularType | null
  /**
   * IMDb id explicito (`tt<digitos>`) para enriquecer UM item via `/item/`.
   * `null` = modo candidatos (seleciona entidades locais por `--type`/`--limit`).
   */
  readonly id: string | null
  readonly limit: number | null
  readonly report: string | null
}

/** Resultado do parse: sucesso com args, ou falha com mensagem clara. */
export type FilmShowRatingsArgsResult =
  | { readonly ok: true; readonly args: FilmShowRatingsArgs }
  | { readonly ok: false; readonly error: string }

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['sample', 'apply', 'dry-run'])
const STRING_FLAGS: ReadonlySet<string> = new Set(['type', 'id', 'report'])
const INT_FLAGS: ReadonlySet<string> = new Set(['limit'])

function fail(error: string): FilmShowRatingsArgsResult {
  return { ok: false, error }
}

/** Faz o parse fail-loud dos argumentos. */
export function parseFilmShowRatingsArgs(argv: readonly string[]): FilmShowRatingsArgsResult {
  let apply = false
  let sample = false
  let type: FilmShowRatingsPopularType | null = null
  let id: string | null = null
  let limit: number | null = null
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
      if (value !== undefined) {
        return fail(`a flag "--${name}" e booleana e nao aceita valor.`)
      }
      if (name === 'apply') apply = true
      if (name === 'sample') sample = true
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
      if (!isPopularType(candidate)) {
        return fail(`--type invalido: "${candidate}". Use "film" ou "show".`)
      }
      type = candidate
      continue
    }

    if (name === 'id') {
      const candidate = value.trim()
      // Por enquanto so IMDb id (`tt<digitos>`) — o `/item/` foi validado com
      // `id=tt9603208`. TMDB id no request fica como TODO (nao chutamos formato).
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
    // Sem `--type` nao sabemos se um item e filme ou serie. Atribuir nota a
    // entidade errada e pior que nao gravar: exigimos o tipo explicito.
    return fail('--apply exige --type=film|show (o tipo define movie vs tv na atribuicao).')
  }

  if (sample && id === null && type === null) {
    // Modo candidatos (sem `--id`): a selecao de entidades locais precisa saber
    // a tabela (movies vs tv_shows). `--sample --id=tt...` dispensa `--type`.
    return fail(
      '--sample sem --id exige --type=film|show (a selecao de candidatos locais precisa do tipo).',
    )
  }

  return { ok: true, args: { apply, sample, type, id, limit, report } }
}
