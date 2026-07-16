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
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { planFailure } from '../src/catalog-jobs/transitions.js'
import { buildSearchDocument } from '../src/search/projection.js'

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
  } finally {
    await prisma.$disconnect()
  }
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
