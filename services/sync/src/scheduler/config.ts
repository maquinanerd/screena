/**
 * scheduler/config.ts — Configuracao PURA do agendador.
 *
 * Le um `Record<string, string|undefined>` (nunca `process.env` direto) para
 * poder ser testada. FAIL-LOUD: valor presente porem invalido e ERRO, nunca
 * fallback silencioso — um `CINERIE_SCHEDULER_TICK_MS=cinco` que virasse `5000`
 * esconderia um erro de deploy para sempre.
 *
 * NENHUM segredo e guardado aqui: a config carrega apenas a PRESENCA das
 * credenciais (booleano). A connection string e o token seguem sendo lidos pelos
 * seus proprios modulos, e nunca sao ecoados.
 */

/** Config resolvida do agendador. */
export interface SchedulerConfig {
  readonly healthPort: number
  /** Intervalo entre avaliacoes do relogio. */
  readonly tickMs: number
  /** Teto de itens por ciclo de cada fila. */
  readonly batchLimit: number
  readonly locale: string
  readonly workerId: string
  readonly isProduction: boolean
  /**
   * O agendador pode ESCREVER de verdade.
   *
   * Sem isto ele roda o ciclo inteiro em dry-run: avalia, seleciona, loga e
   * NAO enfileira nem chama fornecedor. E o equivalente ao `--dry-run` da CLI, e
   * o default e o seguro — subir a imagem por engano num projeto errado nao pode
   * virar ingestao.
   */
  readonly apply: boolean
  readonly hasDatabaseUrl: boolean
  readonly hasTmdbCredential: boolean
  /** Filas desligadas por configuracao. Vazio = todas ligadas. */
  readonly disabledQueues: readonly string[]
}

/** Erro de configuracao. A mensagem nunca cita valor de segredo. */
export class SchedulerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchedulerConfigError'
  }
}

type Env = Readonly<Record<string, string | undefined>>

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new SchedulerConfigError(`${name} deve ser um inteiro (recebido: nao-inteiro).`)
  }
  if (parsed < min || parsed > max) {
    throw new SchedulerConfigError(`${name} fora da faixa permitida [${min}, ${max}].`)
  }
  return parsed
}

/** `true`/`false` explicitos. Qualquer outra coisa e erro (nunca "quase true"). */
function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new SchedulerConfigError(`${name} aceita apenas "true" ou "false".`)
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

/** Resolve a config do agendador. */
export function resolveSchedulerConfig(env: Env): SchedulerConfig {
  const disabledRaw = env.CINERIE_SCHEDULER_DISABLED_QUEUES ?? ''
  const disabledQueues = disabledRaw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return {
    healthPort: readInt(env, 'CINERIE_SCHEDULER_HEALTH_PORT', 3005, 1, 65_535),
    // 5 min: o menor intervalo da tabela e 6h, entao acordar mais rapido so
    // gastaria consulta. Menos que isso tambem atrasaria a primeira execucao
    // depois de uma subida.
    tickMs: readInt(env, 'CINERIE_SCHEDULER_TICK_MS', 5 * 60_000, 10_000, 60 * 60_000),
    batchLimit: readInt(env, 'CINERIE_SCHEDULER_BATCH_LIMIT', 200, 1, 10_000),
    locale: env.CINERIE_SCHEDULER_LOCALE?.trim() || 'pt-BR',
    workerId: env.CINERIE_SCHEDULER_WORKER_ID?.trim() || `scheduler-${process.pid}`,
    isProduction: (env.NODE_ENV ?? '').trim() === 'production',
    apply: readBool(env, 'CINERIE_SCHEDULER_APPLY', false),
    hasDatabaseUrl: present(env.DATABASE_URL),
    hasTmdbCredential: present(env.TMDB_READ_ACCESS_TOKEN) || present(env.TMDB_API_KEY),
    disabledQueues,
  }
}

/** Um check nomeado de readiness. */
export interface SchedulerCheck {
  readonly name: string
  readonly status: 'ok' | 'blocked' | 'down'
  readonly detail: string
}

/** Fatos coletados pelo adapter, ja reduzidos a booleanos e contagens. */
export interface SchedulerReadinessFacts {
  readonly hasDatabaseUrl: boolean
  readonly hasTmdbCredential: boolean
  /** O `SELECT 1` respondeu. `null` = ainda nao foi tentado. */
  readonly databaseReachable: boolean | null
  /** Filas em alerta. INFORMATIVO: nao bloqueia readiness (ver runtime/http.ts). */
  readonly stalledQueues: number
  readonly apply: boolean
  readonly isProduction: boolean
}

/**
 * Avalia a readiness a partir dos fatos. PURA.
 *
 * O que BLOQUEIA: falta de `DATABASE_URL`, falta de credencial TMDB, banco
 * inalcancavel, e producao sem `CINERIE_SCHEDULER_APPLY=true` (um agendador que
 * roda em producia em dry-run para sempre e um servico verde que nao faz nada —
 * a pior falha silenciosa possivel num agendador).
 *
 * O que NAO bloqueia: fila parada. Ela e informativa aqui e alerta no `/status`
 * e no log.
 */
export function evaluateSchedulerReadiness(facts: SchedulerReadinessFacts): {
  readonly ready: boolean
  readonly checks: readonly SchedulerCheck[]
} {
  const checks: SchedulerCheck[] = []

  checks.push(
    facts.hasDatabaseUrl
      ? { name: 'database_url', status: 'ok', detail: 'presente' }
      : { name: 'database_url', status: 'blocked', detail: 'DATABASE_URL ausente' },
  )
  checks.push(
    facts.hasTmdbCredential
      ? { name: 'tmdb_credential', status: 'ok', detail: 'presente' }
      : {
          name: 'tmdb_credential',
          status: 'blocked',
          detail: 'TMDB_READ_ACCESS_TOKEN (ou TMDB_API_KEY) ausente',
        },
  )
  checks.push(
    facts.databaseReachable === true
      ? { name: 'database', status: 'ok', detail: 'SELECT 1 respondeu' }
      : {
          name: 'database',
          status: 'down',
          detail: facts.databaseReachable === null ? 'nao verificado' : 'inalcancavel',
        },
  )
  checks.push(
    !facts.isProduction || facts.apply
      ? {
          name: 'write_authorization',
          status: 'ok',
          detail: facts.apply ? 'escrita autorizada' : 'dry-run (fora de producao)',
        }
      : {
          name: 'write_authorization',
          status: 'blocked',
          detail:
            'NODE_ENV=production sem CINERIE_SCHEDULER_APPLY=true: o agendador rodaria ' +
            'em dry-run eterno, verde e sem efeito',
        },
  )
  checks.push({
    name: 'stalled_queues',
    // Sempre `ok`: informativo por decisao (ver runtime/http.ts). O NUMERO e o
    // que interessa a quem monitora por JSON.
    status: 'ok',
    detail: `${facts.stalledQueues} fila(s) em alerta`,
  })

  const ready = checks.every((check) => check.status === 'ok' || check.name === 'stalled_queues')
  return { ready, checks }
}
