/**
 * validate-catalog-platform-real-postgres.ts — Validador DESCARTAVEL do Backend
 * A (fila duravel de jobs + busca PostgreSQL) em PostgreSQL 16 real e EFEMERO.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nunca roda no render/build/prod.
 * Motor: `embedded-postgres@16` (PG16 real, binario portatil, efemero). Nenhum
 * segredo/DATABASE_URL persistido; instancia derrubada no `finally`. Sem rede
 * externa: exercita os adapters Prisma reais contra o banco de verdade.
 *
 * Prova (§16): migration do zero; extensoes/funcao de busca; CatalogJob
 * (enqueue idempotente, claim FOR UPDATE SKIP LOCKED, heartbeat, retry->
 * retry_wait, dead-letter, reclaim de orfaos, replay, dead-letter list); busca
 * exact/alias/acento/prefixo/fuzzy + zero-results.
 *
 * Uso: pnpm --filter @screena/ingestion validate:catalog-platform-complete
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'
import { createPrismaCatalogJobStore } from '../src/persistence/catalog-job-store.js'
import { createPrismaSearchStore } from '../src/persistence/search-store.js'
import { createPrismaDiscoverySnapshotStore } from '../src/persistence/discovery-snapshot-store.js'
import { createPrismaChangesCheckpoint } from '../src/persistence/changes-checkpoint-store.js'
import { createPrismaAuditReader } from '../src/persistence/audit-reader.js'
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { planFailure } from '../src/catalog-jobs/transitions.js'
import { buildSearchDocument } from '../src/search/projection.js'
import { createCatalogHandlerRegistry } from '../src/catalog-jobs/handlers/registry.js'
import { ALLOWED_METRIC_LABELS } from '../src/catalog-jobs/handlers/support.js'
import { runCatalogWorker } from '../src/catalog-jobs/worker.js'
import { CATALOG_JOB_TYPES } from '../src/catalog-jobs/types.js'
import { CATALOG_METRIC_NAMES, createInMemoryMetricsSink } from '../src/metrics/index.js'
import { evaluateAuditGate, formatAuditReport, runDatabaseAudit } from '../src/audit/index.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const results: CheckResult[] = []
let counter = 0
function record(name: string, ok: boolean, detail: string): void {
  counter += 1
  results.push({ n: counter, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${counter}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir} (deixado para o SO limpar).`)
}

/** Relogio controlavel: torna heartbeat/backoff/reclaim deterministicos. */
class Clock {
  private current: Date
  constructor(start: Date) {
    this.current = start
  }
  now = (): Date => this.current
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

  try {
    // ---------------------------------------------------------------------
    // Extensoes e funcao de busca
    // ---------------------------------------------------------------------
    const exts = (
      await q<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm')",
      )
    ).map((r) => r.extname)
    record('extensoes unaccent + pg_trgm instaladas', exts.length === 2, exts.join(','))

    const immutable = (
      await q<{ provolatile: string }>(
        "SELECT provolatile FROM pg_proc WHERE proname='immutable_unaccent'",
      )
    )[0]
    record(
      'funcao immutable_unaccent existe e e IMMUTABLE',
      immutable?.provolatile === 'i',
      `provolatile=${immutable?.provolatile}`,
    )

    // ---------------------------------------------------------------------
    // CatalogJob: fila duravel
    // ---------------------------------------------------------------------
    const clock = new Clock(new Date('2026-07-16T12:00:00.000Z'))
    const jobs = createPrismaCatalogJobStore(prisma, { now: clock.now, random: () => 0 })

    // enqueue idempotente
    const key = buildIdempotencyKey({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
    })
    const first = await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
      idempotencyKey: key,
    })
    const dup = await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
      idempotencyKey: key,
    })
    const count1 = Number(
      (
        await q<{ c: bigint }>(
          "SELECT count(*)::int AS c FROM catalog_jobs WHERE idempotency_key = '" + key + "'",
        )
      )[0].c,
    )
    record(
      'enqueue idempotente: mesma chave = noop (1 linha, created=false)',
      first.created === true && dup.created === false && dup.id === first.id && count1 === 1,
      `created1=${first.created}, created2=${dup.created}, linhas=${count1}`,
    )

    // prioridade: menor priority reivindicado primeiro
    await jobs.enqueue({
      jobType: 'sync_credits',
      entityType: 'movie',
      externalId: '900',
      idempotencyKey: 'k-lowprio',
      priority: 200,
    })
    await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'tv',
      externalId: '901',
      idempotencyKey: 'k-highprio',
      priority: 1,
    })
    const claimedHigh = await jobs.claimNext()
    record(
      'claim respeita prioridade (menor priority primeiro)',
      claimedHigh?.externalId === '901',
      `externalId=${claimedHigh?.externalId}`,
    )
    record(
      'claim incrementa attempts e retorna alvo',
      claimedHigh?.attempts === 1 && claimedHigh?.jobType === 'sync_details',
      `attempts=${claimedHigh?.attempts}`,
    )

    // heartbeat atualiza o carimbo
    clock.advanceMs(5_000)
    await jobs.heartbeat(claimedHigh!.id)
    const hb = (
      await q<{ heartbeat_at: Date }>(
        `SELECT heartbeat_at FROM catalog_jobs WHERE id = ${claimedHigh!.id}`,
      )
    )[0]
    record(
      'heartbeat atualiza heartbeat_at',
      hb.heartbeat_at.getTime() === clock.now().getTime(),
      `hb=${hb.heartbeat_at.toISOString()}`,
    )

    // complete
    await jobs.complete(claimedHigh!.id)
    const done = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${claimedHigh!.id}`)
    )[0]
    record('complete marca succeeded', done.status === 'succeeded', `status=${done.status}`)

    // claim avanca: reivindica o resto da fila; ids distintos; depois esgota.
    const drained = new Set<string>()
    let d = await jobs.claimNext()
    while (d) {
      drained.add(d.id)
      d = await jobs.claimNext()
    }
    const afterDrain = await jobs.claimNext()
    record(
      'claim avanca: jobs distintos ate esgotar (SKIP LOCKED nao re-entrega)',
      drained.size >= 2 && afterDrain === null,
      `distintos=${drained.size}, aposEsgotar=${afterDrain === null ? 'null' : 'nao-null'}`,
    )

    // fail -> retry_wait com backoff (job FRESCO, isolado do estado acumulado)
    await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '800',
      idempotencyKey: 'k-retry',
    })
    const toFail = await jobs.claimNext()
    const failPlan = planFailure(
      { attempts: toFail!.attempts, maxAttempts: 5 },
      { code: 'tmdb_5xx', safe: 'upstream 503' },
      0,
    )
    const availableAt =
      failPlan.availableInMs === null
        ? null
        : new Date(clock.now().getTime() + failPlan.availableInMs)
    await jobs.applyFailure(toFail!.id, {
      status: failPlan.status,
      availableAt,
      lastErrorCode: failPlan.lastErrorCode,
      lastErrorSafe: failPlan.lastErrorSafe,
    })
    const retried = (
      await q<{ status: string; available_at: Date }>(
        `SELECT status, available_at FROM catalog_jobs WHERE id = ${toFail!.id}`,
      )
    )[0]
    const notClaimableNow = await jobs.claimNext()
    record(
      'falha com tentativas restantes -> retry_wait + backoff futuro (nao claimavel agora)',
      retried.status === 'retry_wait' &&
        retried.available_at.getTime() > clock.now().getTime() &&
        notClaimableNow === null,
      `status=${retried.status}, claimavelAgora=${notClaimableNow === null ? 'nao' : 'sim'}`,
    )

    // dead-letter: job que esgotou tentativas
    await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'movie',
      externalId: '950',
      idempotencyKey: 'k-dead',
      maxAttempts: 1,
    })
    const claimedDead = await jobs.claimNext() // attempts -> 1 == maxAttempts
    const deadPlan = planFailure(
      { attempts: claimedDead!.attempts, maxAttempts: claimedDead!.maxAttempts },
      { code: 'tmdb_404', safe: 'not found' },
      0,
    )
    await jobs.applyFailure(claimedDead!.id, {
      status: deadPlan.status,
      availableAt: null,
      lastErrorCode: deadPlan.lastErrorCode,
      lastErrorSafe: deadPlan.lastErrorSafe,
    })
    const dl = await jobs.listDeadLetter(10)
    record(
      'esgotar tentativas -> dead_letter + aparece no dead-letter list',
      deadPlan.status === 'dead_letter' && dl.some((j) => j.id === claimedDead!.id),
      `deadLetter=${dl.length}`,
    )

    // replay: dead_letter -> pending, attempts=0, claimavel de novo
    const replayed = await jobs.replayDeadLetter()
    const afterReplay = (
      await q<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM catalog_jobs WHERE id = ${claimedDead!.id}`,
      )
    )[0]
    record(
      'replay: dead_letter -> pending (attempts=0)',
      replayed >= 1 && afterReplay.status === 'pending' && afterReplay.attempts === 0,
      `replayed=${replayed}, status=${afterReplay.status}, attempts=${afterReplay.attempts}`,
    )

    // replay com selecao VAZIA nao pode ressuscitar a fila inteira de poison.
    await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'tv',
      externalId: '951',
      idempotencyKey: 'k-dead2',
      maxAttempts: 1,
    })
    const claimedDead2 = await jobs.claimNext()
    const deadPlan2 = planFailure(
      { attempts: claimedDead2!.attempts, maxAttempts: claimedDead2!.maxAttempts },
      { code: 'x', safe: 'x' },
      0,
    )
    await jobs.applyFailure(claimedDead2!.id, {
      status: deadPlan2.status,
      availableAt: null,
      lastErrorCode: deadPlan2.lastErrorCode,
      lastErrorSafe: deadPlan2.lastErrorSafe,
    })
    const replayedEmpty = await jobs.replayDeadLetter([])
    const stillDead = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${claimedDead2!.id}`)
    )[0]
    record(
      'replay([]) e noop: selecao vazia NAO reprocessa a fila inteira',
      replayedEmpty === 0 && stillDead.status === 'dead_letter',
      `replayed=${replayedEmpty}, status=${stillDead.status}`,
    )

    // reclaim de orfao: job running com heartbeat expirado volta para a fila
    await jobs.enqueue({
      jobType: 'sync_lists',
      entityType: 'movie',
      externalId: '960',
      idempotencyKey: 'k-orphan',
    })
    // limpa a fila reivindicando tudo que estiver pendente ate achar o orfao alvo
    let orphan = await jobs.claimNext()
    while (orphan && orphan.externalId !== '960') orphan = await jobs.claimNext()
    record(
      'setup reclaim: job 960 reivindicado (running)',
      orphan?.externalId === '960',
      `claimed=${orphan?.externalId}`,
    )
    clock.advanceMs(120_000) // heartbeat fica velho
    const reclaim = await jobs.reclaimOrphans(30_000)
    const reclaimed = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${orphan!.id}`)
    )[0]
    record(
      'reclaim de orfao: running com heartbeat expirado -> requeue (retry_wait)',
      reclaim.requeued >= 1 && reclaimed.status === 'retry_wait',
      `requeued=${reclaim.requeued}, status=${reclaimed.status}`,
    )

    // ---------------------------------------------------------------------
    // Busca PostgreSQL
    // ---------------------------------------------------------------------
    const search = createPrismaSearchStore(prisma)
    const docs = [
      buildSearchDocument({
        entityType: 'movie',
        entityId: '603',
        locale: 'pt-BR',
        primaryText: 'Matrix',
        alternativeTitles: ['The Matrix'],
        year: 1999,
        popularity: 80,
      }),
      buildSearchDocument({
        entityType: 'movie',
        entityId: '604',
        locale: 'pt-BR',
        primaryText: 'Matrix Reloaded',
        year: 2003,
        popularity: 60,
      }),
      buildSearchDocument({
        entityType: 'person',
        entityId: '6384',
        locale: 'pt-BR',
        primaryText: 'Keanu Reeves',
        popularity: 90,
      }),
      buildSearchDocument({
        entityType: 'movie',
        entityId: '700',
        locale: 'pt-BR',
        primaryText: 'Amélie Poulain',
        year: 2001,
        popularity: 50,
      }),
      // Titulo LONGO com alias CURTO: a similaridade trgm do alias vs o
      // normalized_text concatenado (>130 chars) fica abaixo do limiar (0.3), entao
      // o casamento exato de alias DEVE vir do recall por normalized_aliases (a
      // regressao do bug: sem isso, buscar o alias exato dava zero resultados).
      buildSearchDocument({
        entityType: 'movie',
        entityId: '120',
        locale: 'pt-BR',
        primaryText: 'The Lord of the Rings The Fellowship of the Ring',
        alternativeTitles: [
          'A Sociedade do Anel',
          'El Senor de los Anillos La Comunidad del Anillo',
          'Le Seigneur des anneaux La Communaute de l Anneau',
        ],
        year: 2001,
        popularity: 70,
      }),
    ]
    for (const doc of docs) await search.upsertDocument(doc)
    // upsert idempotente: reprocessar nao duplica
    await search.upsertDocument(docs[0])
    const docCount = Number(
      (await q<{ c: bigint }>('SELECT count(*)::int AS c FROM search_documents'))[0].c,
    )
    record(
      'busca: upsert idempotente (5 documentos, sem duplicar)',
      docCount === 5,
      `docs=${docCount}`,
    )

    const exact = await search.search('Matrix', { locale: 'pt-BR' })
    record(
      'busca exact: "Matrix" -> titulo exato no topo (matchReason=exact)',
      exact[0]?.entityId === '603' && exact[0]?.matchReason === 'exact',
      `top=${exact[0]?.entityId}/${exact[0]?.matchReason}`,
    )

    const alias = await search.search('The Matrix', { locale: 'pt-BR' })
    record(
      'busca alias: "The Matrix" casa pelo titulo alternativo',
      alias.some(
        (r) => r.entityId === '603' && (r.matchReason === 'alias' || r.matchReason === 'exact'),
      ),
      `results=${alias.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    // Regressao do bug de recall: alias exato de titulo LONGO tem de casar como
    // 'alias' (nao pode ser filtrado pelo trgm do normalized_text concatenado).
    const longAlias = await search.search('A Sociedade do Anel', { locale: 'pt-BR' })
    record(
      'busca alias (titulo longo): "A Sociedade do Anel" casa como alias exato',
      longAlias.some((r) => r.entityId === '120' && r.matchReason === 'alias'),
      `results=${longAlias.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    const accent = await search.search('amelie', { locale: 'pt-BR' })
    record(
      'busca acento-insensivel: "amelie" encontra "Amélie Poulain"',
      accent.some((r) => r.entityId === '700'),
      `results=${accent.map((r) => r.entityId).join(',')}`,
    )

    const prefix = await search.search('Matr', { locale: 'pt-BR' })
    record(
      'busca prefixo: "Matr" retorna Matrix e Matrix Reloaded',
      prefix.some((r) => r.entityId === '603') && prefix.some((r) => r.entityId === '604'),
      `results=${prefix.map((r) => r.entityId).join(',')}`,
    )

    const fuzzy = await search.search('Keanu Reevs', { locale: 'pt-BR' })
    record(
      'busca fuzzy (trgm): "Keanu Reevs" (typo) encontra Keanu Reeves',
      fuzzy.some((r) => r.entityId === '6384'),
      `results=${fuzzy.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    const empty = await search.search('zzzqxwv-nao-existe', { locale: 'pt-BR' })
    record(
      'busca zero-results: termo inexistente retorna []',
      empty.length === 0,
      `results=${empty.length}`,
    )

    const blankTerm = await search.search('   ', { locale: 'pt-BR' })
    record(
      'busca: termo em branco nao toca o banco e retorna []',
      blankTerm.length === 0,
      `results=${blankTerm.length}`,
    )

    await runPipelineChecks(prisma, url)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Checks do PIPELINE OPERACIONAL: registry completo, worker executando handlers
 * REAIS contra o banco real, bootstrap idempotente/resume, changes com commit e
 * rollback transacional, snapshots com hash-noop e auditoria read-only.
 *
 * Nenhum destes toca TMDB/RapidAPI/Gemini: os servicos entram por fakes
 * determinísticos. O que se prova aqui e a fronteira com o PostgreSQL — claim
 * concorrente, transacao, unique, checkpoint — que so o banco real garante.
 */
async function runPipelineChecks(prisma: PrismaClient, url: string): Promise<void> {
  const store = createPrismaCatalogJobStore(prisma)
  const snapshots = createPrismaDiscoverySnapshotStore(prisma)
  const checkpoint = createPrismaChangesCheckpoint(prisma)
  const metrics = createInMemoryMetricsSink()

  console.log('\n--- pipeline operacional (handlers reais) ---')

  // Os checks da fila (1-15) deixam jobs de sonda em `pending`/`retry_wait` — e
  // `retry_wait` E claimable. Sem limpar, o worker deste bloco reivindicaria
  // aquelas sondas (payload de teste) em vez dos jobs do pipeline, e o resultado
  // seria ruido, nao sinal. Banco efemero: truncar aqui e seguro e deixa os
  // checks abaixo determinísticos.
  await prisma.catalogJob.deleteMany({})
  await prisma.discoverySnapshot.deleteMany({})
  await prisma.tmdbSyncCheckpoint.deleteMany({})

  // Servicos fake: determinísticos, sem rede. O alvo do teste e o caminho ate o
  // banco, nao o provider.
  const calls = { detail: 0, media: 0, lists: 0, changes: 0 }
  const deps = {
    store,
    detailSync: {
      async syncDetail({ tmdbId }: { tmdbId: number }) {
        calls.detail += 1
        return {
          created: true,
          updated: false,
          unchanged: false,
          entityId: String(tmdbId),
          skipped: false,
          skipReason: null,
        }
      },
    },
    creditsSync: {
      async syncCredits() {
        return { cast: 1, crew: 1, guestStars: 0, skipped: false, skipReason: null }
      },
    },
    externalIdsSync: {
      async syncExternalIds() {
        return { upserted: 1, changed: 0, skipped: false, skipReason: null }
      },
    },
    mediaSync: {
      async syncMedia() {
        calls.media += 1
        return { images: 2, videos: 1, skipped: false, skipReason: null }
      },
    },
    seasonsSync: {
      async syncSeasons() {
        return { seasons: 1, episodes: 0, seasonNumbers: [1], skipped: false, skipReason: null }
      },
    },
    episodesSync: {
      async syncEpisodes() {
        return {
          episodes: 1,
          cast: 1,
          guestStars: 1,
          crew: 1,
          externalIds: 1,
          stills: 1,
          skippedNoTmdbId: 0,
          skipped: false,
          skipReason: null,
        }
      },
    },
    discovery: {
      async discover() {
        return { discovered: 2, accepted: 2, rejectedAdult: 1, duplicate: 0, ids: [603, 604] }
      },
    },
    reprocessRaw: {
      async reprocess() {
        return { scanned: 0, promoted: 0, unchanged: 0, skipped: 0, failed: 0, dryRun: true }
      },
    },
    listFetch: {
      async fetchPage({ page }: { page: number }) {
        calls.lists += 1
        return page === 1
          ? { results: [{ id: 603, popularity: 9 }, { id: 604, popularity: 8 }], page: 1, total_pages: 1 }
          : { results: [], page, total_pages: 1 }
      },
    },
    snapshots,
    changes: {
      async fetchChanges(_kind: string, params: { page: number }) {
        calls.changes += 1
        return { results: [{ id: 603 }, { id: 604 }], page: params.page, total_pages: 1 }
      },
      checkpoint,
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    },
    search: {
      async reindexEntity() {},
    },
    now: () => new Date('2026-07-16T12:00:00.000Z'),
  }

  const registry = createCatalogHandlerRegistry(deps as never)
  record(
    'registry de producao registra os 11 tipos do enum',
    registry.types().length === 11 && CATALOG_JOB_TYPES.every((t) => registry.has(t)),
    `types=${registry.types().length}`,
  )

  // --- bootstrap: enfileira e retoma sem duplicar -------------------------
  const bootstrapJob = await store.enqueue({
    jobType: 'bootstrap',
    idempotencyKey: buildIdempotencyKey({ jobType: 'bootstrap', discriminator: 'validator' }),
    payload: { strategy: 'daily-exports', entityTypes: ['movie'], locale: 'pt-BR' },
    runId: 'validator-run',
  })
  record('bootstrap enfileirado', bootstrapJob.created, `id=${bootstrapJob.id}`)

  const worker1 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 1, maxJobs: 1, drain: true, runId: 'validator' },
  )
  record(
    'worker executa o bootstrap real (handler, nao no_handler)',
    worker1.succeeded === 1 && worker1.deadLettered === 0,
    `ok=${worker1.succeeded} dead=${worker1.deadLettered}`,
  )

  const afterBootstrap = await prisma.catalogJob.count({ where: { jobType: 'discover_ids' } })
  record(
    'bootstrap enfileirou discover_ids de verdade',
    afterBootstrap === 1,
    `discover_ids=${afterBootstrap}`,
  )

  const listJobs = await prisma.catalogJob.count({ where: { jobType: 'sync_lists' } })
  record('bootstrap enfileirou snapshots de lista', listJobs > 0, `sync_lists=${listJobs}`)

  // Resume: mesmo requestId => tudo vira noop idempotente (nenhuma duplicata).
  const replayBootstrap = await store.enqueue({
    jobType: 'bootstrap',
    idempotencyKey: buildIdempotencyKey({ jobType: 'bootstrap', discriminator: 'validator' }),
    payload: {},
  })
  record(
    'bootstrap idempotente: mesma chave nao duplica',
    !replayBootstrap.created,
    `created=${replayBootstrap.created}`,
  )

  // --- cascata: discover_ids -> sync_details -> sync_media ----------------
  const worker2 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 2, maxJobs: 40, drain: true, runId: 'validator' },
  )
  record(
    'worker drena a cascata sem dead-letter',
    worker2.deadLettered === 0,
    `claimed=${worker2.claimed} ok=${worker2.succeeded} dead=${worker2.deadLettered}`,
  )
  record(
    'discover_ids enfileirou sync_details reais',
    (await prisma.catalogJob.count({ where: { jobType: 'sync_details' } })) === 2,
    `sync_details=${await prisma.catalogJob.count({ where: { jobType: 'sync_details' } })}`,
  )
  record(
    'sync_details chamou o servico e enfileirou sync_media',
    calls.detail === 2 && (await prisma.catalogJob.count({ where: { jobType: 'sync_media' } })) === 2,
    `detail=${calls.detail} media_jobs=${await prisma.catalogJob.count({ where: { jobType: 'sync_media' } })}`,
  )
  record('sync_media executou o servico real', calls.media === 2, `media=${calls.media}`)

  // --- snapshot: criado, e hash-noop na repeticao -------------------------
  const snapshotRows = await prisma.discoverySnapshot.count()
  record('sync_lists persistiu snapshot no banco', snapshotRows > 0, `snapshots=${snapshotRows}`)

  const listsHandler = registry.get('sync_lists')
  const listCtx = {
    jobId: 'inline', requestId: 'validator', attempt: 1,
    signal: new AbortController().signal,
    heartbeat: async () => {}, log: { log: () => {} }, metrics,
  }
  const firstSnap = await listsHandler!.execute(
    listCtx as never,
    listsHandler!.validateInput({ listType: 'popular', entityType: 'movie', locale: 'pt-BR' }) as never,
  )
  const secondSnap = await listsHandler!.execute(
    listCtx as never,
    listsHandler!.validateInput({ listType: 'popular', entityType: 'movie', locale: 'pt-BR' }) as never,
  )
  record(
    'snapshot hash-noop: lista inalterada nao cria snapshot novo',
    (secondSnap as { created: boolean }).created === false,
    `first=${(firstSnap as { created: boolean }).created} second=${(secondSnap as { created: boolean }).created}`,
  )

  // --- changes: commit atomico, checkpoint e retomada ---------------------
  const changesHandler = registry.get('sync_changes')
  const changesCtx = { ...listCtx, jobId: 'inline-changes' }
  const changesReport = (await changesHandler!.execute(
    changesCtx as never,
    changesHandler!.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }) as never,
  )) as { totalEnqueued: number }
  record(
    'changes executa e enfileira re-sync dos ids alterados',
    changesReport.totalEnqueued > 0,
    `enqueued=${changesReport.totalEnqueued}`,
  )

  const cp = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:movie' } })
  record(
    'checkpoint de changes gravado apos o commit',
    cp !== null && cp.done === true,
    `job=${cp?.job} lastPage=${cp?.lastPage} done=${cp?.done}`,
  )

  const replayChanges = (await changesHandler!.execute(
    changesCtx as never,
    changesHandler!.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }) as never,
  )) as { kinds: readonly { skipped: boolean }[] }
  record(
    'changes: janela ja concluida e noop na reexecucao',
    replayChanges.kinds[0]?.skipped === true,
    `skipped=${replayChanges.kinds[0]?.skipped}`,
  )

  // ROLLBACK: o commit e uma transacao unica (jobs + checkpoint). Se ela falha,
  // o checkpoint NAO pode avancar — senao a janela seria dada como processada
  // sem os jobs existirem, e a retomada pularia dados de verdade.
  const before = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:tv' } })
  let rolledBack = false
  try {
    await checkpoint.commit({
      job: 'changes:tv',
      paramsHash: '2026-07-15:2026-07-16',
      lastPage: 1,
      totalPages: 1,
      done: true,
      cursor: '2026-07-15:2026-07-16',
      // idempotencyKey null viola NOT NULL => a transacao inteira aborta.
      enqueue: [{ jobType: 'sync_details', idempotencyKey: null as never, entityType: 'tv', externalId: '1' }],
    })
  } catch {
    rolledBack = true
  }
  const after = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:tv' } })
  record(
    'changes rollback: falha no lote NAO avanca o checkpoint',
    rolledBack && after?.lastPage === before?.lastPage,
    `rolledBack=${rolledBack} before=${before?.lastPage ?? 'null'} after=${after?.lastPage ?? 'null'}`,
  )

  // --- metricas ----------------------------------------------------------
  const jobsTotal = metrics
    .samples()
    .filter((s) => s.name === CATALOG_METRIC_NAMES.jobsTotal)
    .reduce((sum, s) => sum + s.value, 0)
  record('metricas emitidas no fluxo real', jobsTotal > 0, `catalog_jobs_total=${jobsTotal}`)

  const labelKeys = new Set<string>()
  for (const sample of metrics.samples()) for (const k of Object.keys(sample.labels)) labelKeys.add(k)
  const forbidden = [...labelKeys].filter(
    (k) => !(ALLOWED_METRIC_LABELS as readonly string[]).includes(k),
  )
  record(
    'nenhuma label de metrica de alta cardinalidade',
    forbidden.length === 0,
    forbidden.length === 0 ? `labels=${[...labelKeys].join(',')}` : `proibidas=${forbidden.join(',')}`,
  )

  // --- dead-letter: payload invalido vira dead-letter, e replay volta -----
  // Limpa a fila: os checks acima deixam jobs de /changes pendentes, e o teste
  // abaixo conta dead-letters — precisa de estado conhecido.
  await prisma.catalogJob.deleteMany({})
  await store.enqueue({
    jobType: 'reprocess_raw',
    idempotencyKey: 'validator:dead-letter-probe',
    payload: { entityType: 'nope' }, // input invalido => falha PERMANENTE
    maxAttempts: 3,
  })
  const worker3 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 1, maxJobs: 5, drain: true, runId: 'validator' },
  )
  record(
    'payload invalido vai DIRETO para dead-letter (sem gastar retry)',
    worker3.deadLettered === 1 && worker3.failedPermanently === 1,
    `dead=${worker3.deadLettered} permanent=${worker3.failedPermanently}`,
  )

  const dl = await store.listDeadLetter(10)
  record('dead-letter listado', dl.length === 1, `entries=${dl.length}`)

  const replayedNone = await store.replayDeadLetter([])
  record(
    'replayDeadLetter([]) e noop (nao reprocessa tudo por engano)',
    replayedNone === 0,
    `replayed=${replayedNone}`,
  )

  const replayed = await store.replayDeadLetter(dl.map((d) => d.id))
  record('replay reenfileira o dead-letter', replayed === 1, `replayed=${replayed}`)

  // --- auditoria: read-only ----------------------------------------------
  const auditBefore = await prisma.catalogJob.count()
  const report = await runDatabaseAudit(createPrismaAuditReader(prisma) as never, {
    environment: 'test',
    now: new Date('2026-07-16T12:00:00.000Z'),
  })
  const auditAfter = await prisma.catalogJob.count()
  record(
    'audit-database e read-only (nao muta nada)',
    auditBefore === auditAfter,
    `jobs before=${auditBefore} after=${auditAfter}`,
  )
  record(
    'audit-database reporta contagens reais do banco',
    report.entities.length > 0 && report.jobs.length > 0,
    `entities=${report.entities.length} jobStatuses=${report.jobs.length} deadLetters=${report.deadLetters}`,
  )
  record(
    'audit-database nunca expoe DATABASE_URL',
    !formatAuditReport(report).includes(url) && !JSON.stringify(report).includes(url),
    'relatorio sem credencial',
  )

  const gateProd = evaluateAuditGate({
    environment: 'production',
    confirmProductionRead: false,
    hasDatabaseUrl: true,
  })
  record(
    'audit-database em producao exige --confirm-production-read',
    !gateProd.allowed,
    `allowed=${gateProd.allowed}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-catalog-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_catalog?schema=public`
  console.log(
    `\n=== Backend A — Postgres efemero (embedded) :${port} | postgresql://postgres:****@127.0.0.1:${port} ===\n`,
  )

  let started = false
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('screena_catalog')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy (do zero) ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record('migrate deploy aplica do zero sem erro', true, 'ok')

    console.log('\n--- checks no banco real ---')
    await runChecks(url)
  } catch (e) {
    record('execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split('\n')[0]}`)
      }
    }
    await safeRm(dataDir)
    console.log('\n=== Backend A: Postgres efemero derrubado e dir temporario removido ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nRESUMO (Backend A / catalog-platform): ${results.length - failed.length}/${results.length} checks OK.`,
  )
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Fila de jobs + busca validadas em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
