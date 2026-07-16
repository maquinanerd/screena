#!/usr/bin/env node
/**
 * bin/catalog.ts — CLI unificada do catalogo. Worker-only/offline — NUNCA no
 * render. EXCLUIDO do typecheck (toca Prisma + client TMDB).
 *
 * Entrada UNICA para operar o catalogo: bootstrap, enqueue, worker, sync,
 * changes, discovery, media, episodes, search-reindex, search-status, status,
 * audit-database e dead-letter. Todos os comandos usam os MESMOS handlers da
 * fila — nao ha caminho paralelo "so do CLI" que possa divergir do que o worker
 * executa em producao.
 *
 * O nucleo PURO (parser, ajuda, exit codes, gate) vive em ../src/cli/* e e
 * testado sem banco. Aqui fica so o IO: env, Prisma, TMDB, sinais, saida.
 *
 * Uso (a partir da raiz):
 *   pnpm catalog --help
 *   pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply
 *   pnpm catalog worker --concurrency 4 --max-jobs 0
 *   pnpm catalog status --json
 *
 * Se `pnpm catalog` falhar com "tsx not found" neste layout pnpm, use o cli
 * RESOLVIDO do tsx, como os demais bins do repo:
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/catalog.ts --help
 */

import { createTmdbClient } from '@screena/tmdb-client'
import { createTmdbCatalogEndpoints } from '@screena/tmdb-client'
import { disconnectPrisma } from '@screena/db/server'
import {
  EXIT_CODES,
  evaluateCatalogGate,
  parseCatalogArgs,
  redactSecrets,
  renderHelp,
  isReadOnlyCommand,
} from '../src/cli/index.js'
import { createCatalogHandlerRegistry } from '../src/catalog-jobs/handlers/index.js'
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { runCatalogWorker } from '../src/catalog-jobs/worker.js'
import { CATALOG_JOB_TYPES } from '../src/catalog-jobs/types.js'
import { createStructuredLogMetricsSink, createInMemoryMetricsSink } from '../src/metrics/index.js'
import { reindexAll } from '../src/search-projection/index.js'
import { evaluateAuditGate, formatAuditReport, runDatabaseAudit } from '../src/audit/index.js'
import { createCatalogServices } from '../src/persistence/catalog-services.js'
import { createPrismaAuditReader } from '../src/persistence/audit-reader.js'

const DEFAULT_LOCALE = 'pt-BR'

/** Logger estruturado (uma linha JSON por evento; nunca imprime segredo). */
function createCliLogger(verbose) {
  return {
    log(level, event, fields) {
      if (!verbose && level === 'debug') return
      const line = JSON.stringify({ level, event, ...fields })
      process.stderr.write(`${redactSecrets(line)}\n`)
    },
  }
}

/** Escreve o resultado no formato pedido. */
function emit(flags, payload, humanLines) {
  if (flags.json) {
    process.stdout.write(`${redactSecrets(JSON.stringify(payload, jsonSafe, 2))}\n`)
    return
  }
  for (const line of humanLines) process.stdout.write(`${redactSecrets(line)}\n`)
}

/** `JSON.stringify` lanca em BigInt: os PKs do schema sao BigInt. */
function jsonSafe(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value
}

/** Lista separada por virgula -> array limpo. */
function splitList(value) {
  if (value === null) return null
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Le ids de um arquivo (um por linha), ignorando vazios/comentarios. */
async function readIdsFile(file) {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(file, 'utf8')
  const ids = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`--ids-file: linha invalida "${trimmed}" (esperado inteiro por linha).`)
    }
    ids.push(Number(trimmed))
  }
  return ids
}

/**
 * Executa UM job em processo (sem passar pela fila).
 *
 * Usado pelos comandos diretos (sync/media/episodes/discovery/changes): o
 * operador quer o resultado AGORA, mas o codigo executado e exatamente o mesmo
 * handler que o worker roda — sem caminho paralelo que possa divergir.
 */
async function runHandlerInline(registry, jobType, payload, deps) {
  const handler = registry.get(jobType)
  if (handler === undefined) throw new Error(`sem handler para ${jobType}`)
  const input = handler.validateInput(payload)

  const controller = new AbortController()
  const context = {
    jobId: `inline:${jobType}`,
    requestId: deps.requestId,
    attempt: 1,
    signal: controller.signal,
    heartbeat: async () => {},
    log: deps.log,
    metrics: deps.metrics,
  }
  return handler.execute(context, input)
}

/** Monta runtime (TMDB + Prisma + servicos + registry). */
function createRuntime() {
  const client = createTmdbClient()
  const catalogEndpoints = createTmdbCatalogEndpoints(client.http, client.config)
  const services = createCatalogServices({
    tmdb: client.endpoints,
    catalogEndpoints,
    cacheTtlMs: client.config.cacheTtlMs,
    fetchText: async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`export HTTP ${response.status}`)
      // Os exports sao .json.gz; `fetch` descompacta via content-encoding.
      return response.text()
    },
  })
  const registry = createCatalogHandlerRegistry(services)
  return { client, catalogEndpoints, services, registry }
}

/** main. */
async function main() {
  const parsed = parseCatalogArgs(process.argv.slice(2))

  if (!parsed.ok) {
    process.stderr.write(`erro: ${parsed.error}\n`)
    return EXIT_CODES.usage
  }
  if (parsed.help) {
    process.stdout.write(`${renderHelp(parsed.command)}\n`)
    return EXIT_CODES.ok
  }

  const { command, subcommand, flags } = parsed.invocation
  const mutates = flags.apply && !isReadOnlyCommand(command)

  const gate = evaluateCatalogGate({
    env: process.env,
    mutates,
    confirmProductionRead: flags.confirmProductionRead,
    force: flags.force,
  })
  if (!gate.ok) {
    process.stderr.write(`bloqueado (${gate.reason}): ${gate.message}\n`)
    return EXIT_CODES.blocked
  }

  const log = createCliLogger(false)
  const metrics = flags.json ? createInMemoryMetricsSink() : createStructuredLogMetricsSink((line) => {
    process.stderr.write(`${JSON.stringify({ metric: line.metric, value: line.value, labels: line.labels })}\n`)
  })
  const requestId = flags.requestId ?? `cli-${command}`
  const locale = flags.locale ?? DEFAULT_LOCALE

  // Dry-run NAO monta o runtime: nao abre Prisma, nao cria client TMDB, nao
  // gasta cota. "Dry-run nao toca nada" e garantido por construcao, nao por
  // disciplina espalhada em cada comando.
  if (flags.dryRun) {
    const plan = describePlan(command, subcommand, flags, locale)
    emit(flags, { dryRun: true, command, subcommand, plan }, [
      `[dry-run] ${command}${subcommand ? ` ${subcommand}` : ''}`,
      ...plan.map((line) => `  - ${line}`),
      '',
      'Nada foi tocado (sem Prisma, sem TMDB, sem cota). Use --apply para executar.',
    ])
    return EXIT_CODES.ok
  }

  const { services, registry } = createRuntime()
  const inlineDeps = { requestId, log, metrics }

  try {
    switch (command) {
      case 'bootstrap':
        return await cmdBootstrap(registry, flags, locale, inlineDeps)
      case 'enqueue':
        return await cmdEnqueue(services, flags, locale)
      case 'worker':
        return await cmdWorker(services, registry, flags, log, metrics, requestId)
      case 'sync':
        return await cmdSync(registry, flags, locale, inlineDeps)
      case 'changes':
        return await cmdChanges(registry, flags, inlineDeps)
      case 'discovery':
        return await cmdDiscovery(registry, flags, locale, inlineDeps)
      case 'media':
        return await cmdMedia(registry, flags, locale, inlineDeps)
      case 'episodes':
        return await cmdEpisodes(registry, flags, locale, inlineDeps)
      case 'search-reindex':
        return await cmdSearchReindex(services, flags, locale, log)
      case 'search-status':
        return await cmdSearchStatus(services, flags, locale)
      case 'status':
        return await cmdStatus(services, flags)
      case 'audit-database':
        return await cmdAuditDatabase(services, flags)
      case 'dead-letter':
        return await cmdDeadLetter(services, subcommand, flags)
      default:
        process.stderr.write(`comando nao implementado: ${command}\n`)
        return EXIT_CODES.usage
    }
  } finally {
    await disconnectPrisma()
  }
}

/** Descreve o plano de um comando, sem tocar em nada (dry-run). */
function describePlan(command, subcommand, flags, locale) {
  const entity = splitList(flags.entity)
  switch (command) {
    case 'bootstrap':
      return [
        `estrategia: ${flags.strategy ?? 'daily-exports'}`,
        `tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`,
        `locale: ${locale}${flags.country ? ` · pais: ${flags.country}` : ''}`,
        `limite por tipo: ${flags.limit ?? 'sem teto'}`,
        `enfileiraria: 1 discover_ids por tipo + snapshots de lista por movie/tv`,
        `request-id: ${flags.requestId ?? '(gerado)'} — reusar o mesmo retoma sem duplicar`,
      ]
    case 'sync':
      return [
        `entidade: ${flags.entity}`,
        flags.id !== null ? `tmdb id: ${flags.id}` : `ids de: ${flags.idsFile}`,
        `sincronizaria o detalhe e enfileiraria sync_media (+sync_seasons se tv)`,
      ]
    case 'changes':
      return [
        `tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`,
        `janela: ${flags.from ?? '(to - 1 dia)'} .. ${flags.to ?? '(hoje)'}`,
        `resume: ${flags.resume ? 'sim' : 'nao'} · checkpoint so avanca apos commit`,
      ]
    case 'discovery':
      return [
        `lista: ${flags.list} · entidade: ${flags.entity}`,
        `paginas: ate ${flags.maxPages ?? 5} · locale: ${locale}`,
        `gravaria snapshot (hash-noop se a lista nao mudou)`,
      ]
    case 'media':
      return [`entidade: ${flags.entity} ${flags.id}`, 'sincronizaria imagens/videos (display_allowed=false)']
    case 'episodes':
      return [
        `serie: ${flags.id}${flags.season !== null ? ` · temporada ${flags.season}` : ' · todas as temporadas'}`,
        'sincronizaria creditos, guest stars, ids externos e stills',
      ]
    case 'search-reindex':
      return [`tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`, `locale: ${locale}`]
    case 'enqueue':
      return [`enfileiraria o job "${flags.positionals[0]}"`]
    case 'dead-letter':
      return [`${subcommand} de dead-letters${flags.limit !== null ? ` (limite ${flags.limit})` : ''}`]
    default:
      return [`${command}: sem efeito colateral`]
  }
}

/** bootstrap. */
async function cmdBootstrap(registry, flags, locale, deps) {
  const report = await runHandlerInline(
    registry,
    'bootstrap',
    {
      strategy: flags.strategy ?? 'daily-exports',
      entityTypes: splitList(flags.entity),
      locale,
      country: flags.country,
      limit: flags.limit,
      mode: flags.mode ?? 'enqueue-only',
    },
    deps,
  )
  emit(flags, report, [
    `bootstrap ${report.requestId} · estrategia ${report.strategy}`,
    `  planejado: ${report.planned} · enfileirado: ${report.enqueued} · ja existia: ${report.alreadyQueued}`,
    ...report.stages.map((s) => `  etapa ${s.stage}: +${s.enqueued} (${s.alreadyQueued} ja existiam)`),
    '',
    'Jobs enfileirados != catalogo preenchido. Rode "pnpm catalog worker" para processar.',
  ])
  return EXIT_CODES.ok
}

/** enqueue. */
async function cmdEnqueue(services, flags, locale) {
  const jobType = flags.positionals[0]
  if (!CATALOG_JOB_TYPES.includes(jobType)) {
    process.stderr.write(`erro: job desconhecido "${jobType}". Use um de: ${CATALOG_JOB_TYPES.join(', ')}.\n`)
    return EXIT_CODES.usage
  }
  const externalId = flags.id === null ? null : String(flags.id)
  const result = await services.store.enqueue({
    jobType,
    entityType: flags.entity,
    externalId,
    idempotencyKey: buildIdempotencyKey({
      jobType,
      entityType: flags.entity,
      externalId,
      discriminator: flags.season !== null ? `s${flags.season}:${locale}` : locale,
    }),
    payload: {
      entityType: flags.entity,
      tmdbId: flags.id,
      seasonNumber: flags.season,
      locale,
    },
    runId: flags.requestId ?? 'cli-enqueue',
  })
  emit(flags, result, [
    result.created
      ? `job ${jobType} enfileirado (id ${result.id}).`
      : `job ${jobType} JA estava na fila (noop idempotente).`,
  ])
  return EXIT_CODES.ok
}

/** worker. */
async function cmdWorker(services, registry, flags, log, metrics, runId) {
  const controller = new AbortController()
  let shuttingDown = false

  // Shutdown gracioso: para de reivindicar e drena o que esta em voo. Um
  // segundo sinal e do operador com pressa — ai sai na hora.
  const onSignal = (signal) => {
    if (shuttingDown) {
      process.stderr.write(`\n${signal} de novo: saindo imediatamente.\n`)
      process.exit(EXIT_CODES.error)
    }
    shuttingDown = true
    process.stderr.write(`\n${signal} recebido: drenando os jobs em voo (repita para forcar).\n`)
    controller.abort()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const maxJobs = flags.maxJobs ?? 0
  const report = await runCatalogWorker(
    { store: services.store, registry, metrics, log, shutdownSignal: controller.signal },
    {
      concurrency: flags.concurrency ?? 4,
      jobTimeoutMs: flags.timeoutMs ?? 120_000,
      idleSleepMs: flags.pollIntervalMs ?? 1_000,
      // maxJobs=0 significa "sem teto": fica pollando (servico). Com teto, drena e sai.
      maxJobs: maxJobs === 0 ? undefined : maxJobs,
      drain: maxJobs !== 0,
      runId,
    },
  )

  emit(flags, report, [
    `worker finalizado: ${report.claimed} reivindicados · ${report.succeeded} ok · ${report.retried} retry · ${report.deadLettered} dead-letter`,
  ])
  return report.deadLettered > 0 ? EXIT_CODES.failed : EXIT_CODES.ok
}

/** sync. */
async function cmdSync(registry, flags, locale, deps) {
  const ids = flags.id !== null ? [flags.id] : await readIdsFile(flags.idsFile)
  const results = []
  let failed = 0

  for (const tmdbId of ids) {
    try {
      results.push(
        await runHandlerInline(
          registry,
          'sync_details',
          { entityType: flags.entity, tmdbId, locale, enqueueDependencies: true },
          deps,
        ),
      )
    } catch (error) {
      failed += 1
      // Um id ruim nao derruba o lote inteiro; o erro fica visivel e contado.
      process.stderr.write(`falha em ${flags.entity} ${tmdbId}: ${redactSecrets(String(error))}\n`)
    }
  }

  emit(flags, { processed: results.length, failed, results }, [
    `sync ${flags.entity}: ${results.length} ok · ${failed} falhou`,
    ...results.map(
      (r) =>
        `  ${r.tmdbId}: ${r.created ? 'criado' : r.updated ? 'atualizado' : 'inalterado'}` +
        `${r.enqueued > 0 ? ` (+${r.enqueued} jobs)` : ''}`,
    ),
  ])
  return failed > 0 ? EXIT_CODES.failed : EXIT_CODES.ok
}

/** changes. */
async function cmdChanges(registry, flags, deps) {
  const report = await runHandlerInline(
    registry,
    'sync_changes',
    {
      kinds: splitList(flags.entity),
      from: flags.from,
      to: flags.to,
      maxPages: flags.maxPages,
      resume: flags.resume,
    },
    deps,
  )
  emit(flags, report, [
    `changes ${report.window.from} .. ${report.window.to} · ${report.totalEnqueued} jobs enfileirados`,
    ...report.kinds.map(
      (k) =>
        `  ${k.kind}: ${k.pages} paginas · ${k.changedIds} ids · +${k.enqueued}` +
        `${k.skipped ? ' (janela ja concluida)' : k.done ? ' (concluida)' : ' (parcial)'}`,
    ),
  ])
  return EXIT_CODES.ok
}

/** discovery. */
async function cmdDiscovery(registry, flags, locale, deps) {
  const report = await runHandlerInline(
    registry,
    'sync_lists',
    {
      listType: flags.list,
      entityType: flags.entity,
      locale,
      country: flags.country,
      window: flags.window,
      maxPages: flags.maxPages,
    },
    deps,
  )
  emit(flags, report, [
    `discovery ${report.listType}/${report.entityType}: ${report.items} itens em ${report.pages} paginas`,
    report.created
      ? `  snapshot ${report.snapshotId} criado (${report.persistedItems} itens persistidos)`
      : '  lista inalterada (hash-noop): nenhum snapshot novo',
  ])
  return EXIT_CODES.ok
}

/** media. */
async function cmdMedia(registry, flags, locale, deps) {
  const report = await runHandlerInline(
    registry,
    'sync_media',
    { entityType: flags.entity, tmdbId: flags.id, seasonNumber: flags.season, locale },
    deps,
  )
  emit(flags, report, [
    `media ${report.entityType} ${report.tmdbId}: ${report.images} imagens · ${report.videos} videos`,
    '  (display_allowed=false: promocao a exibivel e decisao humana)',
  ])
  return EXIT_CODES.ok
}

/** episodes. */
async function cmdEpisodes(registry, flags, locale, deps) {
  const seasons =
    flags.season !== null
      ? [flags.season]
      : (
          await runHandlerInline(
            registry,
            'sync_seasons',
            { tmdbId: flags.id, locale, enqueueEpisodes: false },
            deps,
          )
        ).seasonNumbers ?? []

  const reports = []
  for (const seasonNumber of seasons) {
    reports.push(
      await runHandlerInline(registry, 'sync_episodes', { tmdbId: flags.id, seasonNumber, locale }, deps),
    )
  }

  const total = reports.reduce((sum, r) => sum + r.episodes, 0)
  const skipped = reports.reduce((sum, r) => sum + r.skippedNoTmdbId, 0)
  emit(flags, { seasons: seasons.length, episodes: total, skippedNoTmdbId: skipped, reports }, [
    `episodes serie ${flags.id}: ${seasons.length} temporadas · ${total} episodios`,
    skipped > 0 ? `  ${skipped} episodio(s) sem tmdb id: pulados (sem chave natural)` : '',
  ])
  return EXIT_CODES.ok
}

/** search-reindex. */
async function cmdSearchReindex(services, flags, locale, log) {
  const report = await reindexAll(
    { source: services.searchSource, store: services.searchStore, log },
    { locale, entityTypes: splitList(flags.entity), limit: flags.limit ?? undefined },
  )
  emit(flags, report, [
    `search-reindex: ${report.scanned} varridos · ${report.upserted} gravados · ${report.deleted} removidos · ${report.skipped} pulados`,
  ])
  return EXIT_CODES.ok
}

/** search-status. */
async function cmdSearchStatus(services, flags, locale) {
  const counts = await services.prisma.searchDocument.groupBy({
    by: ['entityType'],
    _count: { _all: true },
    where: { locale },
  })
  const total = counts.reduce((sum, row) => sum + row._count._all, 0)
  const payload = {
    locale,
    total,
    byType: Object.fromEntries(counts.map((row) => [row.entityType, row._count._all])),
  }
  emit(flags, payload, [
    `search-status (${locale}): ${total} documentos`,
    ...counts.map((row) => `  ${row.entityType}: ${row._count._all}`),
  ])
  return EXIT_CODES.ok
}

/** status. */
async function cmdStatus(services, flags) {
  const prisma = services.prisma
  const [byStatus, byType, checkpoints, snapshots, documents, lastSyncs] = await Promise.all([
    prisma.catalogJob.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.catalogJob.groupBy({ by: ['jobType'], _count: { _all: true }, where: { status: 'pending' } }),
    prisma.tmdbSyncCheckpoint.findMany({ take: 20, orderBy: { updatedAt: 'desc' } }),
    prisma.discoverySnapshot.findMany({
      take: 10,
      orderBy: { capturedAt: 'desc' },
      select: { listType: true, entityType: true, locale: true, capturedAt: true, expiresAt: true },
    }),
    prisma.searchDocument.count(),
    prisma.apiSyncLog.findMany({ take: 5, orderBy: { createdAt: 'desc' } }),
  ])

  const now = Date.now()
  const payload = {
    jobs: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    pendingByType: Object.fromEntries(byType.map((r) => [r.jobType, r._count._all])),
    checkpoints: checkpoints.map((c) => ({
      job: c.job,
      lastPage: c.lastPage,
      totalPages: c.totalPages,
      done: c.done,
    })),
    snapshots: snapshots.map((s) => ({
      listType: s.listType,
      entityType: s.entityType,
      locale: s.locale,
      ageSeconds: Math.round((now - s.capturedAt.getTime()) / 1000),
      expired: s.expiresAt.getTime() < now,
    })),
    searchDocuments: documents,
    lastSyncs: lastSyncs.map((l) => ({
      endpoint: l.endpoint,
      status: l.status,
      itemsProcessed: l.itemsProcessed,
      createdAt: l.createdAt.toISOString(),
    })),
  }

  emit(flags, payload, [
    'fila:',
    ...byStatus.map((r) => `  ${r.status}: ${r._count._all}`),
    `documentos de busca: ${documents}`,
    'snapshots recentes:',
    ...payload.snapshots.map(
      (s) => `  ${s.listType}/${s.entityType} (${s.locale}): ${s.ageSeconds}s${s.expired ? ' [expirado]' : ''}`,
    ),
    'checkpoints:',
    ...payload.checkpoints.map((c) => `  ${c.job}: pagina ${c.lastPage}/${c.totalPages ?? '?'}${c.done ? ' [done]' : ''}`),
  ])
  return EXIT_CODES.ok
}

/** audit-database. */
async function cmdAuditDatabase(services, flags) {
  // Gate proprio da auditoria (alem do gate geral da CLI): ler producao e ato
  // consciente mesmo sendo read-only.
  const gate = evaluateAuditGate({
    environment: process.env.NODE_ENV,
    confirmProductionRead: flags.confirmProductionRead,
    hasDatabaseUrl: (process.env.DATABASE_URL ?? '').trim().length > 0,
  })
  if (!gate.allowed) {
    process.stderr.write(`bloqueado: ${gate.reason}\n`)
    return EXIT_CODES.blocked
  }

  const report = await runDatabaseAudit(createPrismaAuditReader(services.prisma), {
    environment: process.env.NODE_ENV ?? 'development',
    now: services.now(),
  })
  emit(flags, report, formatAuditReport(report).split('\n'))
  return EXIT_CODES.ok
}

/** dead-letter. */
async function cmdDeadLetter(services, subcommand, flags) {
  if (subcommand === 'list') {
    const rows = await services.store.listDeadLetter(flags.limit ?? 50)
    emit(flags, rows, [
      `dead-letters: ${rows.length}`,
      ...rows.map((r) => `  ${r.id} ${r.jobType} ${r.entityType ?? '-'}/${r.externalId ?? '-'} · ${r.attempts} tentativas · ${r.lastErrorCode ?? '-'}`),
    ])
    return EXIT_CODES.ok
  }

  const rows = await services.store.listDeadLetter(flags.limit ?? 50)
  const ids = rows.map((r) => r.id)
  // replay([]) e noop por contrato: sem esta guarda, um "replay do nada" viraria
  // replay de TUDO (o adapter trata `undefined` como "todos").
  if (ids.length === 0) {
    emit(flags, { replayed: 0 }, ['nenhum dead-letter para reprocessar.'])
    return EXIT_CODES.ok
  }
  const replayed = await services.store.replayDeadLetter(ids)
  emit(flags, { replayed }, [`${replayed} dead-letter(s) reenfileirado(s).`])
  return EXIT_CODES.ok
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (error) => {
    process.stderr.write(`erro: ${redactSecrets(String(error?.stack ?? error))}\n`)
    process.exitCode = EXIT_CODES.error
    await disconnectPrisma().catch(() => {})
  })
