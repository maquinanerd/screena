/**
 * validate-omdb-unexpected-error-real-postgres.ts — UM ERRO INESPERADO no meio
 * de um lote da OMDb, com o processo de verdade, PostgreSQL de verdade e as
 * migrations REAIS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * O nucleo (`runOmdbRatingsSync`) grava a linha de `api_sync_logs` UMA vez, no
 * FIM do lote. Se ele lancar antes disso, a CLI ainda grava uma linha — o
 * `catch` de `main()` escreve `aborted`/`omdb_unexpected_error`. Mas escrevia
 * SEM `quotaCost`, e o adapter grava `quota_cost` NULL quando o campo falta
 * (`input.quotaCost ?? null`). `readSpentToday` soma a coluna com
 * `COALESCE(SUM(quota_cost), 0)`: um NULL vale ZERO.
 *
 * Resultado: as requisicoes que o lote JA tinha emitido — e que a OMDb ja tinha
 * cobrado — desapareciam da contabilidade do dia, e o leitor podia ficar sem
 * cota mais tarde no MESMO dia por causa de um gasto que ninguem registrou.
 *
 * O caminho e concreto, nao hipotetico: `deps.cache.write` (a escrita em
 * `api_cache`) NAO esta dentro de try/catch no nucleo. Uma falha dela depois de
 * N requisicoes pagas sobe inteira ate o `catch` da CLI. E o mesmo sintoma que a
 * PR #303 fechou para o SIGTERM; este ramo tinha ficado de fora.
 *
 * ============================================================================
 * O QUE ISTO PROVA QUE O TESTE DE UNIDADE NAO PROVA
 * ============================================================================
 *  - O caminho INTEIRO: o spawn e o de `runScript`, os argumentos sao os de
 *    `buildOmdbChildArgs`, a CLI e a de producao (Prisma, client HTTP, gate).
 *  - Que uma falha REAL de escrita em `api_cache` (a tabela passa a recusar
 *    escrita com a requisicao em voo) chega ao `catch` — nao e engolida antes.
 *  - Que a linha `aborted`/`omdb_unexpected_error` carrega, em `quota_cost`, o
 *    numero de requisicoes que o servidor RECEBEU — medido do outro lado da rede.
 *  - Que `readSpentToday`, a leitura de cota do agendador, enxerga essa cota.
 *  - Que a linha carrega `duration_ms` (o ciclo abortado tambem durou algo).
 *  - Que continua sendo UMA linha por ciclo, nunca duas.
 *  - CONTROLE NEGATIVO: o MESMO cenario rodado contra a CLI SEM o conserto —
 *    uma copia da fonte real com as duas linhas do conserto removidas, e a
 *    remocao e AFIRMADA antes de rodar — grava `quota_cost` NULL e
 *    `readSpentToday` devolve 0 com o servidor tendo recebido as requisicoes.
 *    Era producao ate esta mudanca.
 *  - CALIBRACAO, antes de tudo: sem quebrar nada, o mesmo harness mede cota
 *    igual a do servidor. Sem ela, um check verde poderia ser defeito do proprio
 *    harness.
 *
 * ZERO rede externa: a OMDb e um servidor HTTP local (`OMDB_BASE_URL`) e a chave
 * e falsa. Nenhum `DATABASE_URL` persistido; Postgres derrubado no `finally`.
 * Nenhum filho sincrono: quem hospeda Postgres embarcado nao congela o laco que
 * drena o log dele (PR #292).
 *
 * Roda em POSIX e no Windows: nao depende de sinal nenhum — a falha e uma DDL.
 *
 * Uso: pnpm --filter @screena/ratings validate:omdb-unexpected-error
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { runChild } from '@screena/db/async-child-process'
import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import EmbeddedPostgres from 'embedded-postgres'

import { buildOmdbChildArgs } from '../../sync/src/scheduler/runtime/child-args.js'
import { readSpentToday } from '../../sync/src/scheduler/runtime/facts.js'
import { runScript, type SpawnResult } from '../../sync/src/scheduler/runtime/run-script.js'
import { OMDB_GUARDIANS_PAYLOAD } from '../src/omdb/__tests__/fixture.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

/** O script que o agendador spawna, pelo caminho que ele usa. */
const CLI = path.join('services', 'ratings', 'bin', 'sync-omdb-ratings.ts')
/** A fonte real, para derivar a copia SEM o conserto (controle negativo). */
const CLI_SOURCE = path.join(repoRoot, CLI)
/**
 * A copia sem o conserto vive em `services/ratings/.data/` — gitignorado, e a
 * MESMA profundidade de `bin/`: os imports relativos (`../src/...`) e o
 * `repoRoot()` da propria CLI resolvem identicos. Um diretorio qualquer de
 * `tmp` quebraria os dois.
 */
const BROKEN_CLI = path.join('services', 'ratings', '.data', 'omdb-cli-sem-conserto.ts')

const MOVIES = 6
/** Latencia do servidor falso: a requisicao esta EM VOO quando a DDL corre. */
const RESPONSE_DELAY_MS = 600
/** Depois de quantas requisicoes recebidas a escrita em `api_cache` passa a falhar. */
const BREAK_AFTER = 2
/**
 * COMO a escrita e quebrada: um CHECK que nenhuma linha satisfaz.
 *
 * `NOT VALID` isenta as linhas que JA estao la (a do titulo anterior continua
 * intacta) e enforca em todo INSERT/UPDATE seguinte — o upsert do proximo titulo
 * volta com violacao de constraint (23514).
 *
 * Renomear ou dropar a tabela seria a quebra obvia, e ela depende de detalhe
 * interno: um `INSERT` ja preparado no servidor carrega a relacao por OID, e o
 * resultado de reexecuta-lo depois de um RENAME depende de o PostgreSQL reanalisar
 * o texto. Uma violacao de constraint nao tem essa duvida: ela e decidida na
 * EXECUCAO, todas as vezes. E o desfazer e uma linha, sem recriar coluna nenhuma.
 */
const BREAK_SQL =
  'ALTER TABLE api_cache ADD CONSTRAINT prova_escrita_recusada CHECK (false) NOT VALID'
const UNBREAK_SQL = 'ALTER TABLE api_cache DROP CONSTRAINT prova_escrita_recusada'

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

// ---------------------------------------------------------------------------
// A CLI SEM O CONSERTO, derivada da fonte REAL
// ---------------------------------------------------------------------------

/**
 * Escreve uma copia da CLI de producao com as duas linhas do conserto
 * removidas, e devolve quantas removeu.
 *
 * A copia e DERIVADA da fonte, nunca escrita a mao: uma copia a mao continuaria
 * verde no dia em que o original mudasse — e e assim que um controle negativo
 * envelhece sem ninguem notar. Quem chama AFIRMA o retorno: se a remocao nao
 * aconteceu, a copia e a propria CLI consertada e o controle negativo nao
 * controla nada.
 */
function writeCliWithoutTheFix(target: string): { readonly removed: readonly string[] } {
  const source = readFileSync(CLI_SOURCE, 'utf8')
  const marker = "errorCode: 'omdb_unexpected_error',"
  const at = source.indexOf(marker)
  if (at < 0) throw new Error(`fonte da CLI sem o marcador ${marker}`)

  const head = source.slice(0, at)
  let tail = source.slice(at)
  const removed: string[] = []
  // As duas linhas do conserto, removidas SO na vizinhanca do marcador (o
  // restante do arquivo tem outros `quotaCost`/`durationMs` legitimos).
  for (const needle of [
    'quotaCost: client.getRequestCount(),',
    'durationMs: Date.now() - startedAt,',
  ]) {
    const lineStart = tail.indexOf(needle)
    if (lineStart < 0) continue
    const from = tail.lastIndexOf('\n', lineStart) + 1
    const nextBreak = tail.indexOf('\n', lineStart)
    const to = nextBreak < 0 ? tail.length : nextBreak + 1
    tail = tail.slice(0, from) + tail.slice(to)
    removed.push(needle)
  }
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, head + tail)
  return { removed }
}

// ---------------------------------------------------------------------------
// A OMDb falsa
// ---------------------------------------------------------------------------

interface FakeOmdb {
  readonly url: string
  /** Cada requisicao recebida: o id e o instante de chegada. */
  readonly received: Array<{ readonly id: string; readonly at: number }>
  reset(): void
  close(): Promise<void>
}

async function startFakeOmdb(): Promise<FakeOmdb> {
  const received: Array<{ id: string; at: number }> = []
  const server = http.createServer((req, res) => {
    const id = new URL(req.url ?? '/', 'http://omdb.local').searchParams.get('i') ?? ''
    received.push({ id, at: Date.now() })
    setTimeout(() => {
      // O processo pode ter morrido com esta requisicao em voo.
      if (res.destroyed) return
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...OMDB_GUARDIANS_PAYLOAD, imdbID: id }))
    }, RESPONSE_DELAY_MS)
  })
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${String(port)}`,
    received,
    reset: () => {
      received.length = 0
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

// ---------------------------------------------------------------------------
// Uma execucao da CLI, como o agendador a faz
// ---------------------------------------------------------------------------

/**
 * Roda a CLI e, quando o servidor tiver recebido `breakAfterRequests`
 * requisicoes, faz a escrita em `api_cache` passar a ser recusada.
 *
 * O instante nao e arbitrario: naquele momento o titulo ANTERIOR ja fechou
 * cache e notas, e o titulo atual esta com a requisicao em voo (a latencia do
 * servidor falso e a janela). Quando a resposta chega, `deps.cache.write` cai
 * numa tabela que passou a recusar escrita e a excecao sobe ate o `catch` da CLI
 * — com N requisicoes JA pagas.
 */
async function runCli(
  prisma: PrismaLike,
  fake: FakeOmdb,
  options: {
    readonly script: string
    readonly limit: number
    /** `null` = nada e quebrado (calibracao). */
    readonly breakAfterRequests: number | null
  },
): Promise<{ readonly result: SpawnResult | null; readonly broke: boolean }> {
  let finished = false
  const pending = runScript(
    repoRoot,
    options.script,
    buildOmdbChildArgs('movie', 'coverage', options.limit),
  ).then((result) => {
    finished = true
    return result
  })

  let broke = false
  if (options.breakAfterRequests !== null) {
    const deadline = Date.now() + 90_000
    while (
      !finished &&
      fake.received.length < options.breakAfterRequests &&
      Date.now() < deadline
    ) {
      await sleep(10)
    }
    if (!finished && fake.received.length >= options.breakAfterRequests) {
      await prisma.$executeRawUnsafe(BREAK_SQL)
      broke = true
    }
  }

  // Teto para um filho que nunca sai. O timer e LIMPO: um `sleep` solto
  // seguraria este processo dois minutos tambem no caminho de sucesso.
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    pending,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), 120_000)
    }),
  ])
  clearTimeout(timer)

  if (broke) await prisma.$executeRawUnsafe(UNBREAK_SQL)
  return { result, broke }
}

interface SyncRow {
  readonly status: string
  readonly error_code: string | null
  readonly quota_cost: number | null
  readonly duration_ms: number | null
  readonly items_processed: number
}

async function syncRows(prisma: PrismaLike): Promise<SyncRow[]> {
  return prisma.$queryRawUnsafe<SyncRow>(
    `SELECT status::text AS status, error_code, quota_cost, duration_ms, items_processed
       FROM api_sync_logs WHERE provider_api = $1 ORDER BY id`,
    OMDB_PROVIDER_API,
  )
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

async function runChecks(prisma: PrismaLike, fake: FakeOmdb): Promise<void> {
  for (let i = 0; i < MOVIES; i += 1) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, popularity, created_at, updated_at)
       VALUES (${String(72000 + i)}, 'tt${String(9600000 + i)}', 'prova-erro-inesperado-${String(i)}',
               ${String(100 - i)}, now(), now())`,
    )
  }
  record(2, `cenario plantado (${String(MOVIES)} filmes com imdb_id e sem nota)`, true, 'ok')

  const env = process.env
  env.OMDB_API_KEY = 'chave-falsa-de-prova-0000'
  env.OMDB_BASE_URL = fake.url
  env.NODE_ENV = 'test'

  // ---- A. calibracao: nada quebrado --------------------------------------
  const sinceA = new Date()
  const calibration = await runCli(prisma, fake, {
    script: CLI,
    limit: 3,
    breakAfterRequests: null,
  })
  const rowsA = await syncRows(prisma)
  const spentA = await readSpentToday(prisma as never, OMDB_PROVIDER_API, sinceA)
  record(
    3,
    'calibracao: sem quebrar nada a CLI termina com codigo 0',
    calibration.result?.code === 0,
    `codigo=${String(calibration.result?.code)}` +
      (calibration.result?.code === 0 ? '' : ` stderr: ${tail(calibration.result?.stderr ?? '')}`),
  )
  record(
    4,
    'calibracao: UMA linha `success`, quota_cost e readSpentToday = requisicoes recebidas',
    rowsA.length === 1 &&
      rowsA[0]?.status === 'success' &&
      rowsA[0]?.quota_cost === fake.received.length &&
      spentA === fake.received.length &&
      fake.received.length === 3,
    `linhas=${JSON.stringify(rowsA)} readSpentToday=${String(spentA)} servidor=${String(fake.received.length)}`,
  )

  // ---- B. erro inesperado no meio do lote --------------------------------
  await resetDatabase(prisma)
  fake.reset()
  const sinceB = new Date()
  const aborted = await runCli(prisma, fake, {
    script: CLI,
    limit: MOVIES,
    breakAfterRequests: BREAK_AFTER,
  })
  const rowsB = await syncRows(prisma)
  const spentB = await readSpentToday(prisma as never, OMDB_PROVIDER_API, sinceB)

  record(
    5,
    `escrita em api_cache recusada com a requisicao ${String(BREAK_AFTER)} em voo`,
    aborted.broke,
    aborted.broke
      ? 'DDL aplicada durante o lote'
      : 'a CLI terminou antes da DDL — cenario nao ocorreu',
  )
  record(
    6,
    'a falha de escrita sobe ate o `catch` da CLI, que sai com codigo 1',
    aborted.result?.code === 1,
    `codigo=${String(aborted.result?.code)}`,
  )
  record(
    7,
    'o stderr nomeia o desfecho (erro inesperado), nao um sucesso silencioso',
    (aborted.result?.stderr ?? '').includes('abortado por erro inesperado'),
    tail(aborted.result?.stderr ?? ''),
  )
  record(
    8,
    'UMA linha `aborted` com error_code `omdb_unexpected_error` (nunca duas)',
    rowsB.length === 1 &&
      rowsB[0]?.status === 'aborted' &&
      rowsB[0]?.error_code === 'omdb_unexpected_error',
    `linhas=${JSON.stringify(rowsB)}`,
  )
  // O CHECK DESTA MUDANCA.
  record(
    9,
    'O CONSERTO: quota_cost = requisicoes que o servidor RECEBEU (nao NULL)',
    rowsB[0]?.quota_cost === fake.received.length &&
      // O lote FOI cortado: emitiu ao menos a requisicao da quebra e menos que
      // o lote inteiro. O numero exato depende de uma corrida de
      // milissegundos; fixa-lo em BREAK_AFTER seria fragil sem provar nada
      // mais — a afirmacao e a IGUALDADE com o que o servidor recebeu.
      fake.received.length >= BREAK_AFTER &&
      fake.received.length < MOVIES,
    `quota_cost=${String(rowsB[0]?.quota_cost)} servidor=${String(fake.received.length)}`,
  )
  record(
    10,
    'O CONSERTO: readSpentToday (a leitura do agendador) ve essa cota',
    spentB === fake.received.length,
    `readSpentToday=${String(spentB)} servidor=${String(fake.received.length)}`,
  )
  record(
    11,
    'o ciclo abortado tambem registra duration_ms',
    typeof rowsB[0]?.duration_ms === 'number' && (rowsB[0]?.duration_ms ?? 0) > 0,
    `duration_ms=${String(rowsB[0]?.duration_ms)}`,
  )

  // ---- C. CONTROLE NEGATIVO: a MESMA CLI sem o conserto -------------------
  await resetDatabase(prisma)
  fake.reset()
  const { removed } = writeCliWithoutTheFix(path.join(repoRoot, BROKEN_CLI))
  record(
    12,
    'CONTROLE NEGATIVO: a copia sem o conserto perdeu as DUAS linhas da fonte real',
    removed.length === 2,
    `removidas=${JSON.stringify(removed)}`,
  )
  const sinceC = new Date()
  const withoutFix = await runCli(prisma, fake, {
    script: BROKEN_CLI,
    limit: MOVIES,
    breakAfterRequests: BREAK_AFTER,
  })
  const rowsC = await syncRows(prisma)
  const spentC = await readSpentToday(prisma as never, OMDB_PROVIDER_API, sinceC)
  record(
    13,
    'CONTROLE NEGATIVO: sem o conserto a linha `aborted` sai igual — e com quota_cost NULL',
    rowsC.length === 1 &&
      rowsC[0]?.status === 'aborted' &&
      rowsC[0]?.error_code === 'omdb_unexpected_error' &&
      rowsC[0]?.quota_cost === null,
    `linhas=${JSON.stringify(rowsC)} codigo=${String(withoutFix.result?.code)}`,
  )
  record(
    14,
    'CONTROLE NEGATIVO: o servidor recebeu as requisicoes e readSpentToday devolve 0',
    fake.received.length >= BREAK_AFTER && fake.received.length < MOVIES && spentC === 0,
    `servidor=${String(fake.received.length)} readSpentToday=${String(spentC)}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const workDir = mkdtempSync(path.join(tmpdir(), 'cinerie-omdb-unexpected-'))
  const dataDir = path.join(workDir, 'pg')
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_omdb_unexpected'
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
    await runChild('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    console.log('--- prisma db seed (inclui o provider "omdb") ---')
    await runChild('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(1, 'migrate deploy + seed aplicam sem erro', true, 'ok')

    fake = await startFakeOmdb()
    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => PrismaLike
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma
    await runChecks(dbServer.getPrismaClient(), fake)
  } catch (e) {
    // Uma excecao aqui NAO pode virar "passou": o resumo abaixo exige a contagem.
    record(0, 'execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (fake !== null) await fake.close()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    // A copia sem o conserto nunca sobrevive a execucao (ela vive num diretorio
    // gitignorado, mas uma fonte obsoleta parada na arvore engana quem a ler).
    rmSync(path.join(repoRoot, BROKEN_CLI), { force: true })
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
  console.log(
    `\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`,
  )
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${String(f.n)}.${f.name}`).join(' | '))
    process.exit(1)
  }
  // Um numero de checks MENOR que o esperado significa que o validador morreu no
  // meio — e morrer no meio nao e passar.
  const EXPECTED_CHECKS = 14
  if (results.length < EXPECTED_CHECKS) {
    console.error(
      `FALHA: apenas ${String(results.length)} checks executados (esperados ${String(EXPECTED_CHECKS)}) — o validador morreu no meio.`,
    )
    process.exit(1)
  }
  console.log(
    'Resultado: PASSOU. Um erro inesperado no meio do lote grava a linha `aborted` com a cota ' +
      'que o servidor recebeu, e sem o conserto essa cota some de readSpentToday.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
