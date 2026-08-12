#!/usr/bin/env node
/**
 * bin/catalog-worker-service.ts — Servico de longa duracao do espelho TMDB.
 *
 * PAPEL: e o VEICULO DE EXECUCAO que faltava. A maquina do catalogo (fila
 * duravel `catalog_jobs` com dead-letter, Daily ID Exports, `/changes`
 * incremental com checkpoint, filtro fail-closed de adulto, `api_cache`,
 * `api_sync_logs`) ja existia e e reusada INTEGRALMENTE aqui — este arquivo nao
 * reimplementa nenhuma dela. Ele so mantem tres coisas rodando dentro de um
 * container:
 *
 *   1. o LOOP da fila (`runCatalogWorker`, o mesmo de `catalog worker`);
 *   2. o ENFILEIRADOR periodico de descoberta (Daily ID Exports);
 *   3. o ENFILEIRADOR periodico de `/changes` incremental;
 *
 *   + `/healthz` (liveness) e `/readyz` (readiness) para o orquestrador.
 *
 * FILA DURAVEL, RETOMADA POR CONSTRUCAO: nada de estado de progresso vive neste
 * processo. Cada etapa e uma linha em `catalog_jobs` com retry e dead-letter
 * proprios, e o `/changes` avanca um checkpoint transacional. Matar o container
 * no meio e recomecar retoma de onde parou — os jobs `running` orfaos voltam
 * para `pending` pelo `reclaimOrphans`, que roda na subida e periodicamente.
 *
 * ESCRITA EM PRODUCAO E AUTORIZACAO EXPLICITA: sob `NODE_ENV=production` o
 * servico exige `CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED=true`. E o
 * equivalente, no container, ao `--force` da CLI — pelo mesmo motivo: o servico
 * escreve no MESMO banco que serve o site, e subir a imagem por engano num
 * projeto errado nao pode virar ingestao.
 *
 * O QUE ESTE SERVICO NAO FAZ: nao baixa imagem (so referencia `poster_path` /
 * `backdrop_path` / `profile_path`; os bytes ficam no TMDB), nao publica, nao
 * decide indexacao sozinho e nao chama Gemini.
 */

import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'

import { createTmdbClient, createTmdbCatalogEndpoints } from '@screena/tmdb-client'
import { disconnectPrisma } from '@screena/db/server'

import { createCatalogHandlerRegistry } from '../src/catalog-jobs/handlers/index.js'
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { runCatalogWorker } from '../src/catalog-jobs/worker.js'
import { createStructuredLogMetricsSink } from '../src/metrics/index.js'
import { createCatalogServices } from '../src/persistence/catalog-services.js'
import { redactSecrets } from '../src/cli/index.js'
import {
  CatalogWorkerConfigError,
  resolveCatalogWorkerServiceConfig,
  type CatalogWorkerServiceConfig,
} from '../src/worker-service/config.js'
import { startCatalogHealthServer } from '../src/worker-service/health-server.js'
import { evaluateCatalogReadiness } from '../src/worker-service/readiness.js'

import type { StructuredLogger, LogLevel } from '../src/catalog-jobs/handler.js'
import type { CatalogServices } from '../src/persistence/catalog-services.js'

/** Logger estruturado (uma linha JSON por evento; nunca imprime segredo). */
function createServiceLogger(): StructuredLogger {
  return {
    log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) {
      const line = JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() })
      process.stdout.write(`${redactSecrets(line)}\n`)
    },
  }
}

/** Baixa o texto de um Daily ID Export (arquivo publico, sem token nem cota). */
async function fetchExportText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`export HTTP ${response.status}`)
  // Os exports sao `.json.gz` SERVIDOS COMO CORPO BINARIO — nao ha
  // `content-encoding: gzip`, entao `fetch` NAO descompacta e `response.text()`
  // devolveria bytes gzip lidos como UTF-8. O parser descartaria toda linha como
  // JSON invalido e a descoberta reportaria "0 ids" com sucesso.
  const buffer = Buffer.from(await response.arrayBuffer())
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
  return isGzip ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8')
}

/**
 * Enfileira UMA descoberta por tipo (Daily ID Exports).
 *
 * A chave de idempotencia inclui o DIA: dentro do mesmo dia o job e o mesmo
 * trabalho (reenfileirar e noop), e no dia seguinte ha um export novo. Sem o
 * dia, a segunda execucao colidiria na mesma chave e o espelho congelaria no
 * primeiro snapshot — silenciosamente, para sempre.
 */
async function enqueueDiscovery(
  services: CatalogServices,
  config: CatalogWorkerServiceConfig,
  log: StructuredLogger,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  for (const kind of config.discoveryKinds) {
    try {
      await services.store.enqueue({
        jobType: 'discover_ids',
        entityType: kind,
        externalId: null,
        idempotencyKey: buildIdempotencyKey({
          jobType: 'discover_ids',
          entityType: kind,
          externalId: `daily-exports:${day}`,
        }),
        payload: {
          strategy: 'daily-exports',
          entityType: kind,
          locale: config.locale,
          country: null,
          limit: config.discoveryLimit,
          maxPages: null,
          ids: null,
          // A descoberta so vale se cascatear: sem `enqueueDetails` ela
          // descobriria ids e nao sincronizaria nada.
          enqueueDetails: true,
        },
      })
      log.log('info', 'catalog_service_discovery_enqueued', { kind, day, limit: config.discoveryLimit })
    } catch (error) {
      // Enfileirar e best-effort: uma falha de um tipo nao pode derrubar o
      // servico nem impedir os outros tipos.
      log.log('warn', 'catalog_service_discovery_enqueue_failed', { kind, error: String(error) })
    }
  }
}

/**
 * Enfileira UM ciclo de `/changes` incremental.
 *
 * `resume: true` faz o handler ler o checkpoint e continuar de onde parou; o
 * checkpoint so avanca APOS o commit, entao um ciclo interrompido e refeito, e
 * nunca pulado.
 */
async function enqueueChanges(
  services: CatalogServices,
  config: CatalogWorkerServiceConfig,
  log: StructuredLogger,
): Promise<void> {
  // A janela e horaria: dois ciclos no mesmo dia sao trabalhos DIFERENTES.
  const slot = new Date().toISOString().slice(0, 13)
  try {
    await services.store.enqueue({
      jobType: 'sync_changes',
      entityType: null,
      externalId: null,
      idempotencyKey: buildIdempotencyKey({
        jobType: 'sync_changes',
        entityType: null,
        externalId: `incremental:${slot}`,
      }),
      payload: {
        kinds: config.discoveryKinds,
        from: null,
        to: null,
        maxPages: null,
        resume: true,
      },
    })
    log.log('info', 'catalog_service_changes_enqueued', { slot, kinds: config.discoveryKinds })
  } catch (error) {
    log.log('warn', 'catalog_service_changes_enqueue_failed', { error: String(error) })
  }
}

async function main(): Promise<number> {
  const log = createServiceLogger()

  let config: CatalogWorkerServiceConfig
  try {
    config = resolveCatalogWorkerServiceConfig(process.env)
  } catch (error) {
    if (error instanceof CatalogWorkerConfigError) {
      // FAIL-LOUD e ANTES da porta abrir: um servico que sobe com config
      // invalida e responde 200 no healthcheck e pior que um que nao sobe.
      process.stderr.write(`config invalida: ${error.message}\n`)
      return 2
    }
    throw error
  }

  // Gate de autorizacao ANTES de qualquer conexao. Recusar aqui (e nao no
  // primeiro job) e o que faz o operador ver o motivo no log de subida.
  if (config.isProduction && !config.productionWriteAuthorized) {
    process.stderr.write(
      'bloqueado: NODE_ENV=production sem CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED=true.\n' +
        'Escrita em producao exige autorizacao explicita (equivalente ao --force da CLI).\n',
    )
    return 3
  }
  if (!config.hasDatabaseUrl) {
    process.stderr.write('bloqueado: DATABASE_URL ausente.\n')
    return 3
  }
  if (!config.hasTmdbCredential) {
    process.stderr.write('bloqueado: TMDB_READ_ACCESS_TOKEN (ou TMDB_API_KEY) ausente.\n')
    return 3
  }

  const client = createTmdbClient()
  const catalogEndpoints = createTmdbCatalogEndpoints(client.http, client.config)
  const services = createCatalogServices({
    tmdb: client.endpoints,
    catalogEndpoints,
    cacheTtlMs: client.config.cacheTtlMs,
    fetchText: fetchExportText,
  })
  const registry = createCatalogHandlerRegistry(services)
  const metrics = createStructuredLogMetricsSink((line) => {
    process.stdout.write(
      `${JSON.stringify({ metric: line.metric, value: line.value, labels: line.labels })}\n`,
    )
  })

  const controller = new AbortController()
  let alive = true
  let shuttingDown = false

  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      log.log('warn', 'catalog_service_force_exit', { signal })
      process.exit(1)
    }
    shuttingDown = true
    alive = false
    log.log('info', 'catalog_service_draining', { signal })
    controller.abort()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  // ---- Readiness -----------------------------------------------------------
  const checkReadiness = async () => {
    let databaseReachable: boolean | null = null
    let queueSchemaPresent: boolean | null = null
    let deadLetterCount: number | null = null
    try {
      await services.prisma.$queryRaw`SELECT 1`
      databaseReachable = true
      const rows = await services.prisma.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'catalog_jobs'
        ) AS present
      `
      queueSchemaPresent = rows[0]?.present === true
      if (queueSchemaPresent) {
        const counted = await services.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count FROM catalog_jobs WHERE status = 'dead_letter'
        `
        deadLetterCount = Number(counted[0]?.count ?? 0n)
      }
    } catch {
      // Nao propaga: banco fora do ar e "nao pronto", nunca 500 com stack (que
      // poderia ecoar a connection string vinda do driver).
      databaseReachable = databaseReachable ?? false
    }
    return evaluateCatalogReadiness({
      isProduction: config.isProduction,
      productionWriteAuthorized: config.productionWriteAuthorized,
      hasDatabaseUrl: config.hasDatabaseUrl,
      hasTmdbCredential: config.hasTmdbCredential,
      databaseReachable,
      queueSchemaPresent,
      deadLetterCount,
    })
  }

  const health = await startCatalogHealthServer({
    port: config.healthPort,
    isAlive: () => alive,
    checkReadiness,
    workerId: config.workerId,
  })

  log.log('info', 'catalog_service_started', {
    workerId: config.workerId,
    healthPort: health.port,
    concurrency: config.concurrency,
    discoveryKinds: config.discoveryKinds,
    discoveryLimit: config.discoveryLimit,
    discoveryIntervalMs: config.discoveryIntervalMs,
    changesIntervalMs: config.changesIntervalMs,
    production: config.isProduction,
  })

  // ---- Reclaim de orfaos ---------------------------------------------------
  // Um worker morto por SIGKILL/OOM deixa linhas em `running`; `claimNext` so
  // seleciona pending|retry_wait, entao sem este tick elas ficariam perdidas.
  // Roda na subida (recupera o que o processo anterior deixou) e periodicamente.
  const orphanTimeoutMs = Math.max(config.jobTimeoutMs * 2, 60_000)
  const reclaimOnce = async (): Promise<void> => {
    try {
      const result = await services.store.reclaimOrphans(orphanTimeoutMs)
      if (result.requeued > 0 || result.deadLettered > 0) {
        log.log('warn', 'catalog_service_reclaimed_orphans', {
          requeued: result.requeued,
          deadLettered: result.deadLettered,
        })
      }
    } catch (error) {
      log.log('warn', 'catalog_service_reclaim_failed', { error: String(error) })
    }
  }
  await reclaimOnce()

  // ---- Enfileiradores periodicos ------------------------------------------
  // Enfileiram na subida e depois no intervalo. Enfileirar e barato e
  // idempotente (a chave inclui o dia/hora), entao repetir nao duplica trabalho.
  await enqueueDiscovery(services, config, log)
  await enqueueChanges(services, config, log)

  const timers: NodeJS.Timeout[] = [
    setInterval(() => void reclaimOnce(), Math.max(orphanTimeoutMs / 2, 30_000)),
    setInterval(() => void enqueueDiscovery(services, config, log), config.discoveryIntervalMs),
    setInterval(() => void enqueueChanges(services, config, log), config.changesIntervalMs),
  ]
  for (const timer of timers) timer.unref()

  // ---- Loop da fila --------------------------------------------------------
  // `drain: false` + `maxJobs: undefined` = servico: fica pollando ate o
  // shutdown. O mesmo `runCatalogWorker` que a CLI usa — nao ha caminho
  // paralelo "so do container" que possa divergir do que o operador testa.
  const report = await runCatalogWorker(
    { store: services.store, registry, metrics, log, shutdownSignal: controller.signal },
    {
      concurrency: config.concurrency,
      jobTimeoutMs: config.jobTimeoutMs,
      idleSleepMs: config.pollIntervalMs,
      drain: false,
      runId: `${config.workerId}-${randomUUID()}`,
    },
  )

  for (const timer of timers) clearInterval(timer)
  await health.close()

  log.log('info', 'catalog_service_stopped', {
    claimed: report.claimed,
    succeeded: report.succeeded,
    retried: report.retried,
    deadLettered: report.deadLettered,
  })
  return 0
}

main()
  .then(async (code) => {
    await disconnectPrisma()
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${redactSecrets(String(error))}\n`)
    await disconnectPrisma().catch(() => undefined)
    process.exit(1)
  })
