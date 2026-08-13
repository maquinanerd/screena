/**
 * args.ts — Parser PURO dos argumentos do promotor de premiacao. Sem IO.
 *
 * FAIL-LOUD, como os irmaos: `--flag=valor` e `--flag valor`; flag desconhecida,
 * valor faltante ou invalido geram ERRO — nunca default silencioso.
 *
 * SEM `--`. Medido neste repositorio: no pnpm 9.15.4 o separador `--` chega
 * LITERAL como argumento nos dois niveis de encaminhamento, e este parser o
 * recusaria como posicional solto. Os comandos documentados nao o usam.
 */

/** `movie` | `tv`. */
export type AwardsEntityTypeArg = 'movie' | 'tv'

export interface AwardsArgs {
  /** `true` so com `--apply`; sem ele a execucao e dry-run e nao escreve. */
  readonly apply: boolean
  /** Restringe a um tipo; `null` = filme e serie. */
  readonly type: AwardsEntityTypeArg | null
  readonly limit: number | null
  /** Escreve o relatorio markdown em `.data/` (gitignored). */
  readonly report: boolean
}

export type AwardsArgsResult =
  | { readonly ok: true; readonly args: AwardsArgs }
  | { readonly ok: false; readonly error: string }

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['apply', 'dry-run', 'report'])
const STRING_FLAGS: ReadonlySet<string> = new Set(['type'])
const INT_FLAGS: ReadonlySet<string> = new Set(['limit'])
const ENTITY_TYPES: ReadonlySet<string> = new Set(['movie', 'tv'])

function fail(error: string): AwardsArgsResult {
  return { ok: false, error }
}

export function parseAwardsArgs(argv: readonly string[]): AwardsArgsResult {
  let apply = false
  let type: AwardsEntityTypeArg | null = null
  let limit: number | null = null
  let report = false

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
      if (name === 'report') report = true
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
    if (value.trim() === '') return fail(`a flag "--${name}" recebeu valor vazio.`)

    if (name === 'type') {
      const candidate = value.trim()
      if (!ENTITY_TYPES.has(candidate)) {
        return fail(`--type invalido: "${candidate}". Use "movie" ou "tv".`)
      }
      type = candidate as AwardsEntityTypeArg
      continue
    }

    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
      return fail(`--${name} invalido: "${value}". Use um inteiro > 0.`)
    }
    limit = parsed
  }

  return { ok: true, args: { apply, type, limit, report } }
}

/**
 * Gate FAIL-CLOSED da promocao. Modulo puro; o bin deriva os booleans do
 * ambiente.
 *
 * NAO reusa `CINERIE_RATINGS_PROVIDER_AUTHORIZED`: aquela variavel autoriza
 * CONSULTAR a OMDb, e esta execucao nao consulta ninguem. Emprestar o
 * interruptor de coleta para autorizar escrita local faria os dois estados
 * divergirem no primeiro dia em que a coleta fosse desligada.
 */
export interface AwardsGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly hasDb: boolean
  /**
   * `CINERIE_AWARDS_PROMOTION_AUTHORIZED=true`. OPCIONAL de proposito: um
   * chamador que nao conheca o campo passa `undefined`, que NAO e `true`.
   */
  readonly promotionAuthorized?: boolean
}

export type AwardsGateReason = 'production-unauthorized' | 'no-database-url'

export interface AwardsGateResult {
  readonly allowed: boolean
  readonly reason: AwardsGateReason | null
}

export function evaluateAwardsGate(input: AwardsGateInput): AwardsGateResult {
  if (!input.hasDb) return { allowed: false, reason: 'no-database-url' }
  // `!== true`, nunca `!`: omissao bloqueia igual a `false`.
  if (input.isProd && input.apply && input.promotionAuthorized !== true) {
    return { allowed: false, reason: 'production-unauthorized' }
  }
  return { allowed: true, reason: null }
}

export function describeAwardsGateReason(reason: AwardsGateReason): string {
  switch (reason) {
    case 'production-unauthorized':
      return (
        'Bloqueado: promover premiacao em producao exige ' +
        'CINERIE_AWARDS_PROMOTION_AUTHORIZED=true. Sem a variavel a execucao segue ' +
        'valida em dry-run (sem --apply), que le tudo e nao escreve nada.'
      )
    case 'no-database-url':
      return (
        'Bloqueado: a promocao le api_cache e escreve entity_awards no PostgreSQL. ' +
        'Defina DATABASE_URL. (Nenhuma chamada externa acontece: o dado ja esta no banco.)'
      )
  }
}
