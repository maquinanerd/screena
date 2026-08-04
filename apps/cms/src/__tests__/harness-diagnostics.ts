/**
 * harness-diagnostics.ts — Diagnostico do harness de integracao. PURO.
 *
 * POR QUE ISTO EXISTE. A guarda do harness fazia UMA pergunta ("o Payload esta
 * no banco que eu migrei?") e devolvia UMA mensagem para tres falhas que nao tem
 * nada a ver entre si:
 *
 *  1. o PostgreSQL efemero CAIU no meio da suite (a conexao morreu);
 *  2. a Local API do Payload esta apontando para OUTRO banco;
 *  3. o banco e o certo, mas as MIGRATIONS nao chegaram nele.
 *
 * As tres saiam com o texto "a Local API do Payload NAO esta no banco que o
 * harness migrou", que descreve so o caso (2). Quem investigava o caso (3) —
 * de longe o mais comum — perdia tempo procurando divergencia de banco/porta
 * que nunca existiu, porque banco e porta batiam.
 *
 * Aqui a observacao e SEPARADA do veredito, e o veredito e separado da
 * mensagem. Nada disto toca rede, banco ou processo: da para testar as tres
 * conclusoes sem subir nada.
 */

/** O que o harness espera encontrar do outro lado da conexao. */
export interface SchemaExpectation {
  readonly database: string
  readonly port: number
}

/** O que a conexao do Payload de fato reportou. */
export interface SchemaObservation {
  readonly database: string
  readonly port: number
  /** `to_regclass('public.editorial_users')` devolveu algo? */
  readonly editorialUsersPresent: boolean
}

/**
 * Resultado da sondagem.
 *
 * `unreachable` NAO e um caso de schema: e a ausencia de resposta. Tratar os
 * dois como a mesma coisa foi exatamente o defeito que este modulo desfaz.
 */
export type SchemaProbe =
  | { readonly kind: 'observed'; readonly observation: SchemaObservation }
  | { readonly kind: 'unreachable'; readonly detail: string }

export type SchemaDiagnosis =
  | 'ok'
  /** O banco nao respondeu: caiu, foi derrubado ou a conexao morreu. */
  | 'database_gone'
  /** Respondeu, mas e outro banco/porta — configuracao, nao migration. */
  | 'wrong_database'
  /** Banco certo, migration ausente. */
  | 'missing_migrations'

/**
 * Precedencia deliberada: "nao respondeu" vence tudo.
 *
 * Sem essa ordem, um banco morto produz `database=''` e `port=0`, que se parece
 * com "banco errado" — e manda o investigador para o lugar errado de novo.
 */
export function diagnoseSchema(
  expected: SchemaExpectation,
  probe: SchemaProbe,
): SchemaDiagnosis {
  if (probe.kind === 'unreachable') return 'database_gone'

  const { observation } = probe
  if (observation.database !== expected.database || observation.port !== expected.port) {
    return 'wrong_database'
  }
  if (!observation.editorialUsersPresent) return 'missing_migrations'
  return 'ok'
}

/**
 * Erros que significam "o servidor sumiu", nao "a consulta estava errada".
 *
 * `57P01` e o codigo que o PostgreSQL devolve quando o postmaster manda o
 * backend embora (`pg_ctl stop -m fast`) — e o que o `embedded-postgres` faz no
 * seu gancho de saida de processo. Os codigos de socket cobrem o caso de o
 * processo do banco ja ter morrido antes da consulta sair.
 */
const DATABASE_GONE_SQLSTATES: ReadonlySet<string> = new Set([
  '57P01', // admin_shutdown — desligamento solicitado
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now — em recuperacao/subindo
  '08006', // connection_failure
  '08003', // connection_does_not_exist
])

const DATABASE_GONE_SYSCALLS: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENOTFOUND',
  'ETIMEDOUT',
])

const DATABASE_GONE_MESSAGES: readonly string[] = [
  'terminating connection due to administrator command',
  'connection terminated',
  'server closed the connection',
  'client has encountered a connection error',
  'connection ended unexpectedly',
]

export function isDatabaseGoneError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') {
    if (DATABASE_GONE_SQLSTATES.has(code)) return true
    if (DATABASE_GONE_SYSCALLS.has(code)) return true
  }

  const message = (error as { message?: unknown }).message
  if (typeof message === 'string') {
    const lowered = message.toLowerCase()
    if (DATABASE_GONE_MESSAGES.some((needle) => lowered.includes(needle))) return true
  }

  return false
}

/**
 * Descreve um erro de conexao em UMA linha util.
 *
 * O `code` entra sempre que existe: sem ele, "Connection terminated
 * unexpectedly" nao distingue "derrubaram o banco" de "a rede caiu".
 */
export function describeDatabaseFailure(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return typeof error === 'string' && error !== '' ? error : 'erro desconhecido'
  }
  const message = (error as { message?: unknown }).message
  const code = (error as { code?: unknown }).code
  const text = typeof message === 'string' && message !== '' ? message : 'erro sem mensagem'
  return typeof code === 'string' && code !== '' ? `${text} (code=${code})` : text
}

/* ------------------------------------------------------------------ */
/* Politica de migration                                              */
/* ------------------------------------------------------------------ */

/** O que se observou de UMA execucao de `payload migrate`. */
export interface MigrationAttemptOutcome {
  /** 1-based. */
  readonly attempt: number
  readonly maxAttempts: number
  /** `null` quando o processo nao chegou a sair normalmente. */
  readonly exitStatus: number | null
  /** O schema apareceu no banco DEPOIS desta execucao? */
  readonly schemaPresent: boolean
}

export type MigrationDecision =
  /** Deu certo: o banco tem o schema. */
  | 'accept'
  /** O CLI reportou falha. Insistir so esconderia a mensagem dele. */
  | 'fail_reported'
  /** Saiu 0 e nao aplicou nada — tenta de novo. */
  | 'retry'
  /** Saiu 0 e nao aplicou nada, e as tentativas acabaram. */
  | 'fail_silent'

/**
 * Decide o que fazer depois de uma execucao do `payload migrate`.
 *
 * A regra que importa: **o veredito e o estado do BANCO, nao o codigo de saida
 * do processo.** O `bin.js` do Payload dispara o corpo do CLI com
 * `void start()` — sem await, sem catch e sem propagar nada para o exit code —,
 * entao "saiu 0" e compativel com "nao fez nada". Foi assim que a suite
 * seguiu por ~2 minutos de `next build` contra um banco vazio.
 *
 * Saida NAO-ZERO nao e retentada: ali o CLI de fato falou, e a mensagem dele e
 * mais util do que uma segunda tentativa.
 */
export function decideMigrationOutcome(outcome: MigrationAttemptOutcome): MigrationDecision {
  if (outcome.exitStatus !== 0) return 'fail_reported'
  if (outcome.schemaPresent) return 'accept'
  return outcome.attempt < outcome.maxAttempts ? 'retry' : 'fail_silent'
}

export interface SchemaFailureContext {
  readonly expected: SchemaExpectation
  readonly probe: SchemaProbe
  /** Saida acumulada de `payload migrate`, ja concatenada (stdout + stderr). */
  readonly migrationOutput: string
}

function formatMigrationOutput(migrationOutput: string): string {
  const trimmed = migrationOutput.trim()
  if (trimmed !== '') return `saida de 'payload migrate':\n${trimmed}`
  // Saida vazia NAO e detalhe decorativo: e a assinatura do CLI do Payload ter
  // saido sem executar nada. Dizer isso aqui poupa a proxima investigacao.
  return "saida de 'payload migrate': (vazia — o CLI nao chegou a registrar nada)"
}

/** Monta a mensagem do veredito. Uma causa, um texto. */
export function describeSchemaDiagnosis(
  diagnosis: Exclude<SchemaDiagnosis, 'ok'>,
  context: SchemaFailureContext,
): string {
  const { expected, probe } = context
  const expectedLine = `esperado: db=${expected.database} porta=${String(expected.port)}`

  if (diagnosis === 'database_gone') {
    return [
      'harness do CMS: o PostgreSQL efemero NAO respondeu — ele caiu durante o teste.',
      'Isto NAO e problema de schema nem de migration: a conexao morreu antes da resposta.',
      `detalhe: ${probe.kind === 'unreachable' ? probe.detail : 'sem detalhe'}`,
      expectedLine,
    ].join('\n')
  }

  const observation = probe.kind === 'observed' ? probe.observation : null
  const observedLine =
    observation === null
      ? 'obtido:   (sem observacao)'
      : `obtido:   db=${observation.database} porta=${String(observation.port)}`

  if (diagnosis === 'wrong_database') {
    return [
      'harness do CMS: a Local API do Payload esta em OUTRO banco.',
      'O harness migrou um banco e o Payload conectou noutro — problema de configuracao,',
      'nao de migration.',
      expectedLine,
      observedLine,
      formatMigrationOutput(context.migrationOutput),
    ].join('\n')
  }

  return [
    'harness do CMS: as migrations NAO chegaram a este banco.',
    `O banco e a porta estao CERTOS (${expectedLine.replace('esperado: ', '')}), mas a tabela`,
    "'editorial_users' nao existe.",
    "Causa conhecida: `payload migrate` pode sair com codigo 0 sem ter aplicado nada — o",
    '`bin.js` do Payload dispara o proprio corpo com `void start()`, sem await e sem catch,',
    'entao o codigo de saida do processo NAO prova que a migration rodou.',
    formatMigrationOutput(context.migrationOutput),
  ].join('\n')
}
