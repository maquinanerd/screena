/**
 * args.ts — Parser PURO dos argumentos do CLI de raw sync (P0-00d). Sem IO.
 *
 * Aceita AMBOS os formatos por flag de valor: `--flag=valor` e `--flag valor`.
 *
 * FAIL-LOUD (achado do smoke P0-00d): a versao anterior so aceitava `--flag=valor`
 * e IGNORAVA silenciosamente `--flag valor`, caindo em default/fila-mais-recente.
 * Sob `--apply` isso e perigoso (alguem pensa que passou uma fila especifica e o
 * worker usa outra). Aqui, valor faltante, flag desconhecida ou valor invalido
 * geram ERRO explicito — nunca fallback silencioso que mascare queue/limits.
 *
 * Boolean: `--apply`. Flags de valor: `--queue`, `--report` (string);
 * `--limit-movies`, `--limit-tv`, `--limit-people`, `--concurrency` (inteiro > 0).
 * Um valor que comece com `--` so pode ser passado via `=` (a forma separada
 * trata o proximo `--token` como outra flag, nao como valor).
 */

/** Flags de valor string. */
const STRING_FLAGS: ReadonlySet<string> = new Set(['queue', 'report'])

/** Flags de valor inteiro positivo. */
const INT_FLAGS: ReadonlySet<string> = new Set([
  'limit-movies',
  'limit-tv',
  'limit-people',
  'concurrency',
])

/** Argumentos parseados (null = nao informado -> o CLI aplica o default). */
export interface RawSyncArgs {
  readonly apply: boolean
  readonly queue: string | null
  readonly report: string | null
  readonly limitMovies: number | null
  readonly limitTv: number | null
  readonly limitPeople: number | null
  readonly concurrency: number | null
}

/** Resultado do parse: sucesso com args, ou falha com mensagem clara. */
export type RawSyncArgsResult =
  | { readonly ok: true; readonly args: RawSyncArgs }
  | { readonly ok: false; readonly error: string }

function fail(error: string): RawSyncArgsResult {
  return { ok: false, error }
}

/** Faz o parse fail-loud dos argumentos (aceita `--flag=valor` e `--flag valor`). */
export function parseRawSyncArgs(argv: readonly string[]): RawSyncArgsResult {
  let apply = false
  let queue: string | null = null
  let report: string | null = null
  const ints: Record<string, number> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue // inalcancavel; satisfaz noUncheckedIndexedAccess

    if (token === '--apply') {
      apply = true
      continue
    }
    if (!token.startsWith('--')) {
      return fail(`argumento inesperado: "${token}" (use --flag=valor ou --flag valor).`)
    }

    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)

    const isString = STRING_FLAGS.has(name)
    const isInt = INT_FLAGS.has(name)
    if (!isString && !isInt) {
      return fail(`flag desconhecida: --${name}.`)
    }

    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        return fail(`--${name} exige um valor (use --${name}=<valor> ou --${name} <valor>).`)
      }
      value = next
      i += 1 // consome o proximo token como valor
    }
    if (value === '') {
      return fail(`--${name} recebeu valor vazio.`)
    }

    if (isString) {
      if (name === 'queue') queue = value
      else report = value
    } else {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return fail(`--${name} deve ser inteiro positivo (recebido "${value}").`)
      }
      ints[name] = parsed
    }
  }

  return {
    ok: true,
    args: {
      apply,
      queue,
      report,
      limitMovies: ints['limit-movies'] ?? null,
      limitTv: ints['limit-tv'] ?? null,
      limitPeople: ints['limit-people'] ?? null,
      concurrency: ints['concurrency'] ?? null,
    },
  }
}
