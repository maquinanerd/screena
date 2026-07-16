/**
 * exit.ts — Exit codes e gate de producao da CLI (PURO).
 *
 * Codes estaveis: script de operacao decide por eles. Trocar o significado de um
 * code quebra automacao silenciosamente, entao eles sao contrato.
 */

/** Exit codes da CLI. */
export const EXIT_CODES = {
  /** Sucesso. */
  ok: 0,
  /** Uso invalido: comando/flag/combinacao (culpa do chamador). */
  usage: 2,
  /** Bloqueado por gate (producao sem confirmacao, sem DATABASE_URL). */
  blocked: 3,
  /** O trabalho rodou mas terminou com falha (job em dead-letter, sync failed). */
  failed: 4,
  /** Erro inesperado. */
  error: 1,
} as const

/** Um exit code valido. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]

/** Ambiente lido pelo gate (subconjunto; nunca guarda o valor do segredo). */
export interface CatalogEnv {
  readonly NODE_ENV?: string | undefined
  readonly DATABASE_URL?: string | undefined
}

/** Motivo de bloqueio do gate. */
export type GateReason = 'production-write' | 'production-read' | 'no-database-url'

/** Resultado do gate. */
export type GateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: GateReason; readonly message: string }

/** True quando o ambiente e producao. */
export function isProduction(env: CatalogEnv): boolean {
  return env.NODE_ENV === 'production'
}

/**
 * Gate de execucao.
 *
 * Tres regras:
 *  - sem DATABASE_URL nada roda (nem leitura): o comando nao tem contra o que
 *    falar;
 *  - leitura em producao exige `--confirm-production-read` — mesmo SELECT em
 *    producao e ato deliberado, e o operador deve dizer que sabe onde esta;
 *  - escrita em producao exige `--force` explicito, porque um `--apply` copiado
 *    de um runbook de staging nao pode virar mutacao em producao por descuido.
 */
export function evaluateCatalogGate(input: {
  readonly env: CatalogEnv
  readonly mutates: boolean
  readonly confirmProductionRead: boolean
  readonly force: boolean
}): GateResult {
  const url = input.env.DATABASE_URL
  if (url === undefined || url.trim().length === 0) {
    return {
      ok: false,
      reason: 'no-database-url',
      message: 'DATABASE_URL ausente: defina o banco alvo (nunca commite a URL).',
    }
  }

  if (!isProduction(input.env)) return { ok: true }

  if (input.mutates && !input.force) {
    return {
      ok: false,
      reason: 'production-write',
      message:
        'escrita em producao exige --force explicito (um --apply de runbook de staging nao muta producao por descuido).',
    }
  }
  if (!input.mutates && !input.confirmProductionRead) {
    return {
      ok: false,
      reason: 'production-read',
      message: 'leitura em producao exige --confirm-production-read.',
    }
  }
  return { ok: true }
}

/**
 * Remove segredo de um texto antes de imprimir.
 *
 * Cobre a `DATABASE_URL` inteira e a senha embutida numa URL de conexao. Motivo:
 * mensagem de erro de driver costuma ecoar a connection string — e log de CI e
 * publico.
 */
export function redactSecrets(text: string, env: CatalogEnv = process.env): string {
  let out = text
  const url = env.DATABASE_URL
  if (url !== undefined && url.trim().length > 0) {
    out = out.split(url).join('<DATABASE_URL:redacted>')
  }
  // postgres://user:senha@host -> postgres://user:<redacted>@host
  out = out.replace(/(\b[a-z+]+:\/\/[^:/\s]+:)([^@\s]+)(@)/gi, '$1<redacted>$3')
  return out
}
