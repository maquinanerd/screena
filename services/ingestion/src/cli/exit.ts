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
  /**
   * FREIO DE MUDANCA EM MASSA: a execucao calculou tudo, viu que mudaria index
   * <-> noindex em mais paginas que o teto e gravou ZERO linhas.
   *
   * Code PROPRIO, e nao `failed`/`blocked`, porque o ciclo horario precisa saber
   * distinguir "o produtor quebrou" (falha, alerta vermelho) de "o produtor se
   * recusou de proposito e esta esperando um humano" (aviso). Ver o tratamento
   * em `scripts/catalog/catalog-cycle-with-alert.sh`.
   */
  massChangeBlocked: 5,
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
 * Padroes que nunca podem sair num texto redigido.
 *
 * Deliberadamente largos: falso positivo custa uma palavra mascarada num
 * diagnostico; falso negativo custa um segredo em log — ou, desde que
 * `toSafeError` passou a redigir, uma coluna do banco.
 *
 * IRMAO: `services/sync/src/scheduler/runtime/child-failure.ts` tem a mesma
 * lista, criada na #218 para o `stderr` de processo filho. Nao foram unificadas
 * porque sao workspaces distintos e a dependencia cruzada custaria mais que a
 * repeticao; mexer numa pede conferir a outra.
 */
const SEGREDOS: readonly RegExp[] = [
  // atribuicao de chave/segredo/token/senha em qualquer formato comum
  /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|SALT|CREDENTIAL)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi,
  // cabecalho Authorization / Bearer.
  //
  // O `(?:bearer\s+)?` no meio nao e decoracao: sem ele,
  // `authorization: Bearer abc.def` casa so ate a palavra "Bearer" e o TOKEN
  // sobra no texto — foi assim que o teste equivalente reprovou na #218.
  /\b(authorization|proxy-authorization|bearer)\b\s*[:=]?\s*(?:bearer\s+)?\S+/gi,
]

/**
 * Remove segredo de um texto antes de imprimir OU de gravar no banco.
 *
 * Cobre a `DATABASE_URL` inteira, a senha embutida numa URL de conexao,
 * atribuicoes nomeadas (`*_KEY=`, `*_TOKEN=`, `*_SECRET=`...) e cabecalho
 * `Authorization`/`Bearer`. Motivo: mensagem de erro de driver costuma ecoar a
 * connection string — e log de CI e publico.
 *
 * As duas ultimas regras entraram quando `toSafeError` passou a redigir o texto
 * que vai para `last_error_safe`: a partir dali a cadeia de `cause` inteira
 * chega ao banco, e nela cabe token de API alem da URL do Prisma.
 *
 * Idempotente: aplicar duas vezes nao muda nada alem do que a primeira mascarou.
 */
export function redactSecrets(text: string, env: CatalogEnv = process.env): string {
  let out = text
  const url = env.DATABASE_URL
  if (url !== undefined && url.trim().length > 0) {
    out = out.split(url).join('<DATABASE_URL:redacted>')
  }
  // postgres://user:senha@host -> postgres://user:<redacted>@host
  out = out.replace(/(\b[a-z+]+:\/\/[^:/\s]+:)([^@\s]+)(@)/gi, '$1<redacted>$3')
  // atribuicoes nomeadas: preserva o NOME da variavel, mascara o valor.
  out = out.replace(SEGREDOS[0]!, (_m, nome: string) => `${nome}=<redacted>`)
  // Authorization / Bearer.
  out = out.replace(SEGREDOS[1]!, (_m, rotulo: string) => `${rotulo} <redacted>`)
  return out
}
