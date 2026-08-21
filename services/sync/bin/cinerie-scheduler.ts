#!/usr/bin/env node
/**
 * bin/cinerie-scheduler.ts — O RELOGIO da ingestao. Servico de longa duracao.
 *
 * ============================================================================
 * ONDE O RELOGIO MORA, E POR QUE AQUI
 * ============================================================================
 * Um servico proprio no EasyPanel (`screen-cron`), no MESMO projeto do
 * `screen-app` e do `screen-db`. Os quatro criterios que o dono listou, e o que
 * cada um decidiu:
 *
 *  - SOBREVIVER A REDEPLOY: nenhum estado de progresso vive neste processo. O
 *    "quando cada fila rodou" e lido de `api_sync_logs` a cada tick, e o
 *    trabalho de catalogo e uma linha em `catalog_jobs`. Matar e subir de novo
 *    retoma do banco.
 *  - NAO RODAR DUAS VEZES COM DUAS REPLICAS: `pg_try_advisory_lock` por fila
 *    (ver `src/scheduler/lock.ts`). Quem nao pegou a trava desiste e LOGA.
 *  - ENXERGAR O `screen-db` PELA REDE INTERNA: servico no mesmo projeto fala com
 *    o banco pelo hostname interno. Um workflow agendado do GitHub Actions
 *    precisaria do banco exposto na internet — trocar a trava por um buraco de
 *    firewall e um pessimo negocio. E um agendador dentro do `screen-app`
 *    amarraria o relogio ao ciclo de vida do site: todo deploy do front mataria
 *    um lote no meio, e escalar o front para duas replicas duplicaria o relogio.
 *  - O DONO VER SEM ABRIR TERMINAL: `/status` (HTML), `/readyz` (JSON) e uma
 *    linha de log `error` por fila parada, que aparece no painel de logs.
 *
 * ============================================================================
 * DRY-RUN E O DEFAULT
 * ============================================================================
 * Sem `CINERIE_SCHEDULER_APPLY=true` o ciclo roda inteiro — avalia, seleciona,
 * conta e loga — e NAO enfileira nem chama fornecedor. Subir a imagem por engano
 * num projeto errado nao pode virar ingestao. Em producao, porem, dry-run eterno
 * seria um servico verde que nao faz nada: por isso `/readyz` RECUSA producao
 * sem `APPLY` (ver `evaluateSchedulerReadiness`).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { createTmdbClient, createTmdbCatalogEndpoints } from '@screena/tmdb-client'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'
import { createCatalogServices } from '@screena/ingestion/runtime'
import {
  OMDB_DAILY_LIMIT,
  ON_DEMAND_RESERVE,
  PROVIDER_QUOTAS,
  resolveProviderQuota,
} from '@screena/config'

import {
  buildStatusReport,
  classifyRun,
  describeRun,
  detectStalledQueues,
  emitBacklogAlerts,
  emitStallAlerts,
  evaluateBacklog,
  evaluateSchedule,
  evaluateSchedulerReadiness,
  findRhythm,
  resolveSchedulerConfig,
  RHYTHMS,
  SchedulerConfigError,
  selectDueQueues,
  withLostRecord,
  withQueueLock,
  type QuotaSnapshot,
  type SchedulerConfig,
  type SchedulerQueue,
} from '../src/scheduler/index.js'
import { createAdvisoryLockPort, createLockClient } from '../src/scheduler/runtime/advisory-lock.js'
import {
  readJobBacklog,
  readLastRuns,
  readSpentToday,
  recordRun,
} from '../src/scheduler/runtime/facts.js'
import { startSchedulerHttp } from '../src/scheduler/runtime/http.js'
import { QUEUE_RUNNERS, resolveRepoRoot, type RunnerDeps } from '../src/scheduler/runtime/runners.js'

/** Logger estruturado: uma linha JSON por evento. Nunca imprime segredo. */
function createLogger(workerId: string) {
  return {
    log(
      level: 'debug' | 'info' | 'warn' | 'error',
      event: string,
      fields?: Record<string, unknown>,
    ): void {
      process.stdout.write(
        `${JSON.stringify({ level, event, workerId, ...fields, ts: new Date().toISOString() })}\n`,
      )
    },
  }
}

function loadRepoEnv(repoRoot: string): void {
  const envPath = path.resolve(repoRoot, '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

/** Os fornecedores que aparecem no painel de cota. */
const QUOTA_PROVIDERS = ['omdb', 'tmdb'] as const

async function collectQuotas(
  prisma: ReturnType<typeof getPrismaClient>,
  now: Date,
): Promise<readonly QuotaSnapshot[]> {
  const out: QuotaSnapshot[] = []
  for (const providerApi of QUOTA_PROVIDERS) {
    const quota = resolveProviderQuota(providerApi)
    if (quota === null) continue
    out.push({
      providerApi,
      dailyLimit: quota.perDay,
      spentToday: await readSpentToday(prisma, providerApi, now),
      // A reserva do leitor existe SO na OMDb: e o unico fornecedor com teto
      // diario apertado o bastante para que a fila de fundo possa deixar o
      // leitor sem resposta.
      reservedForReader: providerApi === 'omdb' ? ON_DEMAND_RESERVE : 0,
      basis: quota.basis,
    })
  }
  return out
}

async function main(): Promise<number> {
  const repoRoot = resolveRepoRoot()
  loadRepoEnv(repoRoot)

  let config: SchedulerConfig
  try {
    config = resolveSchedulerConfig(process.env)
  } catch (error) {
    if (error instanceof SchedulerConfigError) {
      // FAIL-LOUD e ANTES da porta abrir: um servico que sobe com config
      // invalida e responde 200 no healthcheck e pior que um que nao sobe.
      process.stderr.write(`config invalida: ${error.message}\n`)
      return 2
    }
    throw error
  }

  const log = createLogger(config.workerId)

  if (!config.hasDatabaseUrl) {
    process.stderr.write('bloqueado: DATABASE_URL ausente.\n')
    return 3
  }
  if (!config.hasTmdbCredential) {
    process.stderr.write('bloqueado: TMDB_READ_ACCESS_TOKEN (ou TMDB_API_KEY) ausente.\n')
    return 3
  }
  if (config.isProduction && !config.apply) {
    process.stderr.write(
      'bloqueado: NODE_ENV=production sem CINERIE_SCHEDULER_APPLY=true.\n' +
        'Um agendador em dry-run eterno e um servico verde que nao faz nada.\n',
    )
    return 3
  }

  const prisma = getPrismaClient()
  const lockClient = createLockClient(process.env.DATABASE_URL as string)
  const lock = createAdvisoryLockPort(lockClient)

  const tmdb = createTmdbClient()
  const catalogEndpoints = createTmdbCatalogEndpoints(tmdb.http, tmdb.config)
  const services = createCatalogServices({
    tmdb: tmdb.endpoints,
    catalogEndpoints,
    cacheTtlMs: tmdb.config.cacheTtlMs,
  })

  const startedAt = new Date()
  let alive = true
  let shuttingDown = false
  let lastAlertCount = 0

  // O sinal que atravessa ate os processos filhos. Abortar e o que faz o
  // desligamento caber na janela de carencia do orquestrador — ver
  // `runScript` em `runtime/runners.ts`.
  const shutdown = new AbortController()

  const runnerDeps: RunnerDeps = {
    prisma,
    services: services as never,
    catalogEndpoints,
    now: () => new Date(),
    log,
    locale: config.locale,
    batchLimit: config.batchLimit,
    discoveryLimit: config.discoveryLimit,
    repoRoot,
    apply: config.apply,
    shutdownSignal: shutdown.signal,
  }

  const gatherStatus = async () => {
    const now = new Date()
    const lastRuns = await readLastRuns(prisma)
    const schedules = evaluateSchedule({ now, lastRuns })
    const alerts = detectStalledQueues(schedules, { now, startedAt })
    const quotas = await collectQuotas(prisma, now)
    // O estado de `catalog_jobs`. E a unica das quatro leituras do painel que
    // fala do TRABALHO; as outras tres falam do agendador. Ver `backlog.ts`.
    const backlog = evaluateBacklog(await readJobBacklog(prisma), now)
    return { now, schedules, alerts, quotas, backlog }
  }

  const http = await startSchedulerHttp({
    port: config.healthPort,
    workerId: config.workerId,
    isAlive: () => alive,
    checkReadiness: async () => {
      let databaseReachable: boolean | null = null
      try {
        await prisma.$queryRaw`SELECT 1`
        databaseReachable = true
      } catch {
        databaseReachable = false
      }
      return evaluateSchedulerReadiness({
        hasDatabaseUrl: config.hasDatabaseUrl,
        hasTmdbCredential: config.hasTmdbCredential,
        databaseReachable,
        stalledQueues: lastAlertCount,
        apply: config.apply,
        isProduction: config.isProduction,
      })
    },
    buildStatus: async () => {
      const { now, schedules, alerts, quotas, backlog } = await gatherStatus()
      return buildStatusReport({
        now,
        startedAt,
        schedules,
        alerts,
        quotas,
        backlog,
        workerId: config.workerId,
      })
    },
  })

  log.log('info', 'scheduler_started', {
    healthPort: http.port,
    tickMs: config.tickMs,
    batchLimit: config.batchLimit,
    // No log de subida: um teto errado tem de aparecer ANTES do primeiro ciclo,
    // nao depois de 6,3 milhoes de jobs.
    discoveryLimit: config.discoveryLimit,
    apply: config.apply,
    production: config.isProduction,
    queues: RHYTHMS.length,
    disabledQueues: config.disabledQueues,
    omdbDailyLimit: OMDB_DAILY_LIMIT,
    omdbReaderReserve: ON_DEMAND_RESERVE,
    quotaBasis: Object.fromEntries(
      Object.values(PROVIDER_QUOTAS).map((q) => [q.providerApi, q.basis]),
    ),
  })

  /** UM ciclo: avalia, roda o que venceu, alerta. */
  const tick = async (): Promise<void> => {
    const { now, schedules, alerts, backlog } = await gatherStatus()

    // O ALERTA SAI SEMPRE, mesmo que nada esteja vencido. Emiti-lo so dentro do
    // laco de execucao faria uma fila parada por falta de trabalho nunca acusar.
    emitStallAlerts(alerts, log)

    // O MESMO vale para a fila represada, e com mais forca: o agendador nao a
    // conserta ciclo nenhum. Enfileirar de novo nao drena o que ja esta la — so
    // quem tem consumidor drena. Se este alerta nao sair, o agendador segue
    // empilhando trabalho sobre trabalho parado, exatamente como fez ate aqui.
    const backlogAlertas = emitBacklogAlerts(backlog, log)

    // Os DOIS contam para a readiness. Contar so `alerts` faria `/readyz`
    // reportar zero problemas com a fila represada — a mesma cegueira do painel,
    // um andar abaixo.
    lastAlertCount = alerts.length + backlogAlertas

    const due = selectDueQueues({ now, lastRuns: schedules.map((s) => ({
      queue: s.queue,
      lastSuccessAt: s.lastSuccessAt,
      lastAttemptAt: s.lastSuccessAt,
    })) })

    for (const entry of due) {
      if (shuttingDown) return
      if (config.disabledQueues.includes(entry.queue)) {
        log.log('info', 'scheduler_queue_disabled', { queue: entry.queue })
        continue
      }

      const queue: SchedulerQueue = entry.queue
      const runner = QUEUE_RUNNERS[queue]
      const rhythm = findRhythm(queue)

      const result = await withQueueLock(lock, queue, async () => {
        const started = new Date()
        try {
          return classifyRun(await runner(runnerDeps))
        } catch (error) {
          // Excecao NAO vira silencio: vira desfecho `failure` com motivo, e o
          // carimbo de ultimo sucesso NAO avanca.
          return classifyRun({
            queue,
            startedAt: started,
            finishedAt: new Date(),
            planned: 1,
            processed: 0,
            failed: 1,
            skipped: 0,
            reasons: [{ code: 'runner_threw', detail: String(error), count: 1 }],
          })
        }
      })

      if (!result.ran) {
        // Pular em SILENCIO faria duas replicas parecerem uma so.
        log.log('info', 'scheduler_queue_held_elsewhere', {
          queue,
          lockKey: result.key.toString(),
        })
        continue
      }

      // O REGISTRO VEM ANTES DA LINHA DE DESFECHO, e a ordem e a regra.
      //
      // Ate aqui era o contrario: o ciclo anunciava `success` e SO DEPOIS tentava
      // gravar `api_sync_logs`; quando o INSERT morria, saia um `warn` ao lado de
      // um sucesso ja publicado. Sucesso reportado sobre registro perdido — e, no
      // caso da `discovery`, sobre uma FK que quebrava em TODA execucao.
      //
      // Para fila que consome fornecedor, essa linha e a unica evidencia duravel
      // do ciclo: dela saem o ultimo sucesso e o gasto de cota. Sem ela, para
      // todo consumidor do sistema a execucao nao aconteceu. Por isso o registro
      // perdido nao vira observacao ao lado do desfecho: vira o desfecho.
      //
      // Filas derivadas (`providerApi === null`) nao gravam aqui — elas medem o
      // proprio artefato (ver `runtime/facts.ts`) — e em dry-run nada e gravado.
      let outcome = result.value
      if (rhythm?.providerApi !== null && rhythm?.providerApi !== undefined && config.apply) {
        try {
          await recordRun(prisma, outcome, rhythm.providerApi)
        } catch (error) {
          // `error`, nao `warn`: o painel de logs do dono mostra `error`, e esta
          // e a unica linha que nomeia a CAUSA. O alerta de fila parada tambem
          // acusa, mas acusa como "NUNCA rodou" — que manda o operador procurar
          // uma fila que nao roda, quando ela roda e nao consegue se registrar.
          log.log('error', 'scheduler_run_log_failed', {
            queue,
            providerApi: rhythm.providerApi,
            error: String(error),
          })
          outcome = withLostRecord(
            outcome,
            `o registro em api_sync_logs NAO foi gravado para provider_api=${rhythm.providerApi}: ${String(error)}`,
          )
        }
      }

      // Tres niveis, nao dois. `partial` continua em `warn`: lote incompleto e
      // desfecho legitimo e frequente, e promove-lo a `error` diluiria o nivel
      // que o painel do dono usa para "fila parada". `failure` — inclusive o
      // registro perdido — sobe para `error`, porque e a linha que precisa ser
      // vista no mesmo tick em que acontece.
      const level = outcome.status === 'success' ? 'info' : outcome.status === 'partial' ? 'warn' : 'error'
      log.log(level, 'scheduler_queue_finished', {
        queue,
        status: outcome.status,
        planned: outcome.planned,
        processed: outcome.processed,
        failed: outcome.failed,
        skipped: outcome.skipped,
        durationMs: outcome.durationMs,
        summary: describeRun(outcome),
      })
    }
  }

  /**
   * O SONO ENTRE CICLOS TEM DE SER INTERROMPIVEL.
   *
   * Com um `setTimeout` cru, um SIGTERM chegado logo depois de um ciclo ficaria
   * esperando o tick INTEIRO (5 minutos, no default) antes de o laco reavaliar
   * `shuttingDown` — e o orquestrador, que costuma dar 10 a 30 segundos de
   * carencia, mandaria SIGKILL. O processo NUNCA drenaria limpo, e o operador
   * veria "exit 137" em todo deploy sem entender por que.
   *
   * Nada se perde num SIGKILL (o estado vive no banco), mas um desligamento que
   * sempre precisa de forca esconde o dia em que ele demorar por outro motivo.
   * Detectado por `scripts/prove-scheduler-service.ts`, que mede o codigo de
   * saida depois do SIGTERM.
   */
  let wakeUp: (() => void) | null = null
  const sleepUntilNextTick = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wakeUp = null
        resolve()
      }, ms)
      wakeUp = () => {
        clearTimeout(timer)
        wakeUp = null
        resolve()
      }
    })
  }

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      log.log('warn', 'scheduler_force_exit', { signal })
      process.exit(1)
    }
    shuttingDown = true
    alive = false
    log.log('info', 'scheduler_draining', { signal })
    // Duas coisas, e as duas sao necessarias: acordar o laco (que pode estar
    // dormindo ate um tick inteiro) e abortar o trabalho em voo (que pode ser
    // uma CLI filha rodando ha minutos).
    shutdown.abort()
    wakeUp?.()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  // Primeiro ciclo IMEDIATO: esperar um tick inteiro depois de subir atrasaria
  // toda fila vencida sem nenhum ganho.
  while (!shuttingDown) {
    try {
      await tick()
    } catch (error) {
      log.log('error', 'scheduler_tick_failed', { error: String(error) })
    }
    if (shuttingDown) break
    await sleepUntilNextTick(config.tickMs)
  }

  await http.close()
  await lockClient.$disconnect().catch(() => undefined)
  log.log('info', 'scheduler_stopped', {})
  return 0
}

main()
  .then(async (code) => {
    await disconnectPrisma().catch(() => undefined)
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    await disconnectPrisma().catch(() => undefined)
    process.exit(1)
  })
