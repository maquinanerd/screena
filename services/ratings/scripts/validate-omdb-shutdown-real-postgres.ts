/**
 * validate-omdb-shutdown-real-postgres.ts — O SIGTERM no meio de um lote da
 * OMDb, com o processo de verdade, PostgreSQL de verdade e as migrations REAIS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * No desligamento de todo redeploy o agendador aborta a CLI `sync-omdb-ratings`.
 * O nucleo grava `api_sync_logs` UMA vez, no fim do lote, e a CLI morria antes:
 * o lote cortado nao deixava linha, e a cota que ele tinha gastado sumia de
 * `readSpentToday` — o leitor podia ficar sem cota mais tarde no mesmo dia.
 *
 * ============================================================================
 * O QUE ISTO PROVA QUE O TESTE DE UNIDADE NAO PROVA
 * ============================================================================
 *  - O caminho INTEIRO do agendador: o spawn e o de `runScript`, os argumentos
 *    sao os de `buildOmdbChildArgs`, o sinal e o do `AbortController` de
 *    desligamento. A CLI e a de producao (Prisma, client HTTP, ouvinte de sinal).
 *  - Que a linha sai no banco, `aborted` com `shutdown-requested`, e que a cota
 *    dela e a que o servidor RECEBEU — medida do outro lado da rede.
 *  - Que `readSpentToday`, a leitura de cota do agendador, enxerga essa cota.
 *  - Que nenhuma requisicao sai depois do sinal, que o titulo em voo termina as
 *    tres notas (nunca uma ou duas), e que uma requisicao PENDURADA e cortada
 *    pela carencia — o processo sai em segundos, dentro dos 10 s do Swarm.
 *  - CONTROLE NEGATIVO: o MESMO processo sem a parada cooperativa (o ouvinte de
 *    SIGTERM neutralizado por um `--import` que so existe aqui) morre no sinal
 *    com as requisicoes ja recebidas pelo servidor — e `api_sync_logs` fica
 *    vazio. Era producao ate esta mudanca.
 *  - CALIBRACAO, antes de tudo: sem sinal, o mesmo harness mede cota e notas
 *    iguais as do servidor. Sem ela, um check verde poderia ser defeito do
 *    proprio harness.
 *
 * ZERO rede externa: a OMDb e um servidor HTTP local (`OMDB_BASE_URL`) e a chave
 * e falsa. Nenhum `DATABASE_URL` persistido; Postgres derrubado no `finally`.
 * Nenhum filho sincrono: quem hospeda Postgres embarcado nao congela o laco que
 * drena o log dele.
 *
 * SIGTERM SO EXISTE EM POSIX. No Windows `kill('SIGTERM')` vira
 * `TerminateProcess` e ouvinte nenhum roda: la so a calibracao executa, e o
 * validador sai com 2 (nunca 0) dizendo isso. A CI (Linux) roda tudo.
 *
 * Uso: pnpm --filter @screena/ratings validate:omdb-shutdown
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { STOP_IN_FLIGHT_GRACE_MS } from '@screena/rapidapi-core'
import EmbeddedPostgres from 'embedded-postgres'

import { buildOmdbChildArgs } from '../../sync/src/scheduler/runtime/child-args.js'
import { readSpentToday } from '../../sync/src/scheduler/runtime/facts.js'
import { runScript, type SpawnResult } from '../../sync/src/scheduler/runtime/run-script.js'
import { OMDB_GUARDIANS_PAYLOAD } from '../src/omdb/__tests__/fixture.js'
import { OMDB_SHUTDOWN_ERROR_CODE } from '../src/omdb/run.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

/** O script que o agendador spawna, pelo caminho que ele usa. */
const CLI = path.join('services', 'ratings', 'bin', 'sync-omdb-ratings.ts')
const MOVIES = 6
/** Latencia do servidor falso: a requisicao esta EM VOO quando o sinal chega. */
const RESPONSE_DELAY_MS = 600
/** Teto de saida depois do sinal: a carencia da requisicao em voo + escritas + fim. */
const EXIT_BUDGET_MS = STOP_IN_FLIGHT_GRACE_MS + 3_000
const POSIX = process.platform !== 'win32'

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T[]>
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
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
  const pkgPath = dbRequire.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin: string | Record<string, string>
  }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

/** Filho ASSINCRONO com a semantica de erro de um `exec`: codigo != 0 rejeita. */
async function runNode(args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', reject)
    child.on('exit', (exitCode) => resolve(exitCode))
  })
  if (code !== 0) throw new Error(`node ${args.slice(0, 2).join(' ')} saiu com ${String(code)}`)
}

// ---------------------------------------------------------------------------
// A OMDb falsa
// ---------------------------------------------------------------------------

interface FakeOmdb {
  readonly url: string
  /** Cada requisicao recebida: o id e o instante de chegada. */
  readonly received: Array<{ readonly id: string; readonly at: number }>
  /** Requisicoes que o CLIENTE abandonou antes da resposta. */
  readonly cutByClient: () => number
  /** A partir de qual requisicao (0-based) o servidor pendura; `null` = nunca. */
  hangFrom: number | null
  reset(): void
  close(): Promise<void>
}

async function startFakeOmdb(): Promise<FakeOmdb> {
  const received: Array<{ id: string; at: number }> = []
  let cut = 0
  const state: FakeOmdb = {
    url: '',
    received,
    cutByClient: () => cut,
    hangFrom: null,
    reset: () => {
      received.length = 0
      cut = 0
      state.hangFrom = null
    },
    close: async () => undefined,
  }
  const server = http.createServer((req, res) => {
    const id = new URL(req.url ?? '/', 'http://omdb.local').searchParams.get('i') ?? ''
    const index = received.length
    received.push({ id, at: Date.now() })
    res.on('close', () => {
      if (!res.writableFinished) cut += 1
    })
    // Pendurada: so termina quando o cliente desiste.
    if (state.hangFrom !== null && index >= state.hangFrom) return
    setTimeout(() => {
      // O processo pode ter morrido com esta requisicao em voo (controle negativo).
      if (res.destroyed) return
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...OMDB_GUARDIANS_PAYLOAD, imdbID: id }))
    }, RESPONSE_DELAY_MS)
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return Object.assign(state, {
    url: `http://127.0.0.1:${String(port)}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  })
}

// ---------------------------------------------------------------------------
// Uma execucao da CLI, como o agendador a faz
// ---------------------------------------------------------------------------

interface CliRun {
  readonly result: SpawnResult | null
  readonly signaledAt: number | null
  readonly exitedAt: number
}

async function runCli(
  fake: FakeOmdb,
  options: {
    readonly limit: number
    /** Manda o SIGTERM quando o servidor tiver recebido N requisicoes; `null` = sem sinal. */
    readonly signalAfterRequests: number | null
    /** `NODE_OPTIONS` do filho (o controle negativo injeta o neutralizador aqui). */
    readonly nodeOptions?: string
  },
): Promise<CliRun> {
  const shutdown = new AbortController()
  const previous = process.env.NODE_OPTIONS
  if (options.nodeOptions !== undefined) process.env.NODE_OPTIONS = options.nodeOptions

  let finished = false
  const pending = runScript(
    repoRoot,
    CLI,
    buildOmdbChildArgs('movie', 'coverage', options.limit),
    shutdown.signal,
  ).then((result) => {
    finished = true
    return result
  })

  let signaledAt: number | null = null
  try {
    if (options.signalAfterRequests !== null) {
      const deadline = Date.now() + 90_000
      while (!finished && fake.received.length < options.signalAfterRequests && Date.now() < deadline) {
        await sleep(10)
      }
      if (!finished && fake.received.length >= options.signalAfterRequests) {
        shutdown.abort()
        signaledAt = Date.now()
      }
    }
    // Teto para um filho que nunca sai (o defeito que isto procura). O timer e
    // LIMPO: um `sleep` solto seguraria este processo dois minutos no sucesso.
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      pending,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 120_000)
      }),
    ])
    clearTimeout(timer)
    return { result, signaledAt, exitedAt: Date.now() }
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previous
  }
}

interface SyncRow {
  readonly status: string
  readonly error_code: string | null
  readonly quota_cost: number | null
  readonly items_processed: number
}

async function syncRows(prisma: PrismaLike): Promise<SyncRow[]> {
  return prisma.$queryRawUnsafe<SyncRow>(
    `SELECT status::text AS status, error_code, quota_cost, items_processed
       FROM api_sync_logs WHERE provider_api = $1 ORDER BY id`,
    OMDB_PROVIDER_API,
  )
}

/** Notas gravadas por titulo. Um titulo com 1 ou 2 seria escrita cortada. */
async function ratingsPerTitle(prisma: PrismaLike): Promise<number[]> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }>(
    `SELECT count(*)::int AS n FROM external_ratings
      WHERE provider_api = $1 GROUP BY entity_type, entity_id`,
    OMDB_PROVIDER_API,
  )
  return rows.map((row) => row.n)
}

async function resetDatabase(prisma: PrismaLike): Promise<void> {
  await prisma.$executeRawUnsafe('DELETE FROM external_ratings')
  await prisma.$executeRawUnsafe('DELETE FROM api_cache')
  await prisma.$executeRawUnsafe('DELETE FROM api_sync_logs')
}

function tail(text: string): string {
  const clean = text.trim()
  return clean.length > 600 ? `...${clean.slice(-600)}` : clean || '(vazio)'
}

async function runChecks(prisma: PrismaLike, fake: FakeOmdb, workDir: string): Promise<void> {
  for (let i = 0; i < MOVIES; i += 1) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, popularity, created_at, updated_at)
       VALUES (${String(71000 + i)}, 'tt${String(9500000 + i)}', 'prova-parada-${String(i)}',
               ${String(100 - i)}, now(), now())`,
    )
  }
  record(2, `cenario plantado (${String(MOVIES)} filmes com imdb_id e sem nota)`, true, 'ok')

  const env = process.env
  env.OMDB_API_KEY = 'chave-falsa-de-prova-0000'
  env.OMDB_BASE_URL = fake.url
  env.NODE_ENV = 'test'

  // ---- A. calibracao: sem sinal -------------------------------------------
  const spentBefore = new Date()
  const calibration = await runCli(fake, { limit: 3, signalAfterRequests: null })
  const calRows = await syncRows(prisma)
  const calRatings = await ratingsPerTitle(prisma)
  record(
    3,
    'calibracao: sem sinal a CLI termina com codigo 0',
    calibration.result?.code === 0,
    `codigo=${String(calibration.result?.code)}` +
      (calibration.result?.code === 0 ? '' : ` stderr: ${tail(calibration.result?.stderr ?? '')}`),
  )
  record(
    4,
    'calibracao: UMA linha `success` e quota_cost = requisicoes que o servidor recebeu',
    calRows.length === 1 &&
      calRows[0]?.status === 'success' &&
      calRows[0]?.quota_cost === fake.received.length &&
      fake.received.length === 3,
    `linhas=${JSON.stringify(calRows)} servidor=${String(fake.received.length)}`,
  )
  const calSpent = await readSpentToday(prisma as never, OMDB_PROVIDER_API, spentBefore)
  record(
    5,
    'calibracao: readSpentToday (a leitura do agendador) ve a mesma cota',
    calSpent === fake.received.length,
    `readSpentToday=${String(calSpent)} servidor=${String(fake.received.length)}`,
  )
  record(
    6,
    'calibracao: tres notas por titulo (IMDb, Rotten Tomatoes, Metacritic)',
    calRatings.length === 3 && calRatings.every((n) => n === 3),
    `notas por titulo=${JSON.stringify(calRatings)}`,
  )

  if (!POSIX) return

  // ---- B. SIGTERM com a 2a requisicao em voo ------------------------------
  await resetDatabase(prisma)
  fake.reset()
  const spentBeforeB = new Date()
  const stopped = await runCli(fake, { limit: MOVIES, signalAfterRequests: 2 })
  const rowsB = await syncRows(prisma)
  const ratingsB = await ratingsPerTitle(prisma)
  const spentB = await readSpentToday(prisma as never, OMDB_PROVIDER_API, spentBeforeB)
  const tookB = stopped.signaledAt === null ? null : stopped.exitedAt - stopped.signaledAt
  const afterSignal = fake.received.filter((r) => stopped.signaledAt !== null && r.at > stopped.signaledAt)

  record(
    7,
    'SIGTERM: a CLI drena pelo proprio ouvinte e sai com 143',
    stopped.signaledAt !== null && stopped.result?.code === 143,
    `sinal=${stopped.signaledAt === null ? 'NAO ENVIADO' : 'enviado'} codigo=${String(stopped.result?.code)}` +
      (stopped.result?.code === 143 ? '' : ` stderr: ${tail(stopped.result?.stderr ?? '')}`),
  )
  record(
    8,
    `SIGTERM: sai em menos de ${String(EXIT_BUDGET_MS)} ms (carencia do Swarm: 10 s)`,
    tookB !== null && tookB < EXIT_BUDGET_MS,
    `saiu ${String(tookB)} ms depois do sinal`,
  )
  record(
    9,
    'SIGTERM: NENHUMA requisicao chega ao servidor depois do sinal',
    stopped.signaledAt !== null && afterSignal.length === 0,
    `recebidas=${String(fake.received.length)} depois do sinal=${String(afterSignal.length)}`,
  )
  record(
    10,
    'SIGTERM: UMA linha `aborted` com error_code `shutdown-requested`',
    rowsB.length === 1 &&
      rowsB[0]?.status === 'aborted' &&
      rowsB[0]?.error_code === OMDB_SHUTDOWN_ERROR_CODE,
    `linhas=${JSON.stringify(rowsB)}`,
  )
  record(
    11,
    'SIGTERM: quota_cost e readSpentToday = requisicoes que o servidor RECEBEU',
    rowsB[0]?.quota_cost === fake.received.length &&
      spentB === fake.received.length &&
      fake.received.length === 2,
    `quota_cost=${String(rowsB[0]?.quota_cost)} readSpentToday=${String(spentB)} servidor=${String(fake.received.length)}`,
  )
  record(
    12,
    'SIGTERM: o titulo em voo terminou as TRES notas — nenhuma escrita pela metade',
    ratingsB.length === rowsB[0]?.items_processed &&
      ratingsB.length === 2 &&
      ratingsB.every((n) => n === 3),
    `notas por titulo=${JSON.stringify(ratingsB)} items_processed=${String(rowsB[0]?.items_processed)}`,
  )
  record(
    13,
    'SIGTERM: o stderr diz que o lote parou entre requisicoes',
    (stopped.result?.stderr ?? '').includes('SIGTERM recebido'),
    tail(stopped.result?.stderr ?? ''),
  )

  // ---- C. requisicao PENDURADA: a carencia corta --------------------------
  await resetDatabase(prisma)
  fake.reset()
  fake.hangFrom = 1
  const hung = await runCli(fake, { limit: MOVIES, signalAfterRequests: 2 })
  const rowsC = await syncRows(prisma)
  const tookC = hung.signaledAt === null ? null : hung.exitedAt - hung.signaledAt
  record(
    14,
    `PENDURADA: sai com 143 depois da carencia (${String(STOP_IN_FLIGHT_GRACE_MS)} ms) e antes de ${String(EXIT_BUDGET_MS)} ms`,
    hung.result?.code === 143 &&
      tookC !== null &&
      tookC >= STOP_IN_FLIGHT_GRACE_MS - 250 &&
      tookC < EXIT_BUDGET_MS,
    `codigo=${String(hung.result?.code)} saiu ${String(tookC)} ms depois do sinal`,
  )
  record(
    15,
    'PENDURADA: a linha `aborted` conta a requisicao cortada (ela saiu e foi paga)',
    rowsC.length === 1 &&
      rowsC[0]?.status === 'aborted' &&
      rowsC[0]?.error_code === OMDB_SHUTDOWN_ERROR_CODE &&
      rowsC[0]?.quota_cost === fake.received.length &&
      rowsC[0]?.items_processed === 1,
    `linhas=${JSON.stringify(rowsC)} servidor=${String(fake.received.length)}`,
  )
  record(
    16,
    'PENDURADA: foi o CLIENTE que abandonou a requisicao (o servidor nunca respondeu)',
    fake.cutByClient() === 1,
    `abandonadas pelo cliente=${String(fake.cutByClient())}`,
  )

  // ---- D. CONTROLE NEGATIVO: sem a parada cooperativa -----------------------
  // O neutralizador descarta o registro de ouvinte de SIGTERM: a CLI fica como
  // era antes desta mudanca, e a acao padrao do sinal volta a matar o processo.
  await resetDatabase(prisma)
  fake.reset()
  const neutralizer = path.join(workDir, 'sem-parada-cooperativa.mjs')
  writeFileSync(
    neutralizer,
    [
      "const semSigterm = (original) => function (event, ...rest) {",
      "  return event === 'SIGTERM' ? this : original.call(this, event, ...rest)",
      '}',
      'for (const metodo of ["on", "addListener", "once", "prependListener", "prependOnceListener"]) {',
      '  process[metodo] = semSigterm(process[metodo])',
      '}',
      '',
    ].join('\n'),
  )
  const spentBeforeD = new Date()
  const killed = await runCli(fake, {
    limit: MOVIES,
    signalAfterRequests: 2,
    nodeOptions: `--import=${pathToFileURL(neutralizer).href}`,
  })
  const rowsD = await syncRows(prisma)
  const spentD = await readSpentToday(prisma as never, OMDB_PROVIDER_API, spentBeforeD)
  record(
    17,
    'CONTROLE NEGATIVO: sem a parada cooperativa o processo MORRE no sinal',
    killed.signaledAt !== null && killed.result !== null && killed.result.code === null,
    `codigo=${String(killed.result?.code)} (null = morto por sinal)`,
  )
  record(
    18,
    'CONTROLE NEGATIVO: o servidor recebeu as requisicoes — a cota foi gasta',
    fake.received.length === 2,
    `servidor=${String(fake.received.length)}`,
  )
  record(
    19,
    'CONTROLE NEGATIVO: e NAO ha linha em api_sync_logs — readSpentToday nao ve a cota',
    rowsD.length === 0 && spentD === 0,
    `linhas=${String(rowsD.length)} readSpentToday=${String(spentD)} (servidor recebeu ${String(fake.received.length)})`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const workDir = mkdtempSync(path.join(tmpdir(), 'cinerie-omdb-shutdown-'))
  const dataDir = path.join(workDir, 'pg')
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_omdb_shutdown'
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${dbName}?schema=public`
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${String(port)}/${dbName}?schema=public`
  console.log(`\n=== Postgres efemero (embedded) :${String(port)} | ${maskedUrl} ===\n`)

  let started = false
  let fake: FakeOmdb | null = null
  let disconnect: (() => Promise<void>) | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase(dbName)

    process.env.DATABASE_URL = url
    const env = { ...process.env, DATABASE_URL: url }

    console.log('--- prisma migrate deploy ---')
    await runNode([prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], env, dbDir)
    console.log('--- prisma db seed (inclui o provider "omdb") ---')
    await runNode([prismaBin(), 'db', 'seed', '--schema', dbSchema], env, dbDir)
    record(1, 'migrate deploy + seed aplicam sem erro', true, 'ok')

    fake = await startFakeOmdb()
    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => PrismaLike
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma
    await runChecks(dbServer.getPrismaClient(), fake, workDir)
  } catch (e) {
    // Uma excecao aqui NAO pode virar "passou": o resumo abaixo exige a contagem.
    record(0, 'execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (fake !== null) await fake.close()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    try {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch (e) {
      console.warn(
        `Aviso: dir temporario nao removido agora (${(e as Error).message.split('\n')[0]}); sera limpo pelo SO.`,
      )
    }
    console.log('\n=== Postgres efemero derrubado e dir temporario liberado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${String(f.n)}.${f.name}`).join(' | '))
    process.exit(1)
  }
  // Um numero de checks MENOR que o esperado significa que o validador morreu no
  // meio — e morrer no meio nao e passar.
  const EXPECTED_CHECKS = POSIX ? 19 : 6
  if (results.length < EXPECTED_CHECKS) {
    console.error(
      `FALHA: apenas ${String(results.length)} checks executados (esperados ${String(EXPECTED_CHECKS)}) — o validador morreu no meio.`,
    )
    process.exit(1)
  }
  if (!POSIX) {
    console.error(
      'PARCIAL: a calibracao passou, mas SIGTERM nao existe no Windows — os cenarios de ' +
        'parada so rodam em POSIX (a CI roda). Saindo com 2 para nunca ser lido como aprovacao.',
    )
    process.exit(2)
  }
  console.log(
    'Resultado: PASSOU. O SIGTERM para o lote entre requisicoes, a linha `aborted` registra a ' +
      'cota que o servidor recebeu, e sem a parada cooperativa essa cota some.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
