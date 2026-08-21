#!/usr/bin/env node
/**
 * prove-scheduler-lock.ts — A trava contra execucao dupla, com PROCESSOS DE
 * VERDADE e PostgreSQL de verdade.
 *
 * ============================================================================
 * POR QUE ISTO NAO PODE SER UM TESTE DE UNIDADE
 * ============================================================================
 * O teste de contrato (`src/scheduler/__tests__/lock.test.ts`) prova que o
 * agendador USA a trava direito. Ele NAO pode provar que a trava funciona entre
 * dois processos, porque uma trava em memoria e sempre correta dentro do mesmo
 * processo — e o defeito que mata em producao (`pg_advisory_lock` emitido numa
 * conexao do pool e liberado em outra) so aparece com um pool de verdade.
 *
 * Aqui sao DOIS processos filhos, dois clientes Prisma, um PostgreSQL efemero.
 *
 * ============================================================================
 * AS TRES PROVAS
 * ============================================================================
 *  [1] DOIS PROCESSOS, UMA FILA: exatamente um pega a trava. O outro e recusado
 *      e sabe por que.
 *  [2] FILAS DIFERENTES: os dois passam. Sem isto, uma trava GLOBAL quebrada
 *      passaria em [1] e serializaria a plataforma inteira.
 *  [3] PROCESSO MORTO A SIGKILL: a trava e liberada pela QUEDA DA CONEXAO, e o
 *      proximo processo entra. E o cenario do redeploy e do OOM — e o motivo de
 *      a trava ser advisory de SESSAO em vez de uma linha de lease com TTL, que
 *      ficaria presa ate o TTL vencer.
 *
 * NAO PRECISA DE MIGRATION: advisory lock nao toca tabela nenhuma. O banco
 * efemero sobe vazio.
 *
 * NOTA DE AMBIENTE (Windows): o `initdb` do `embedded-postgres` falha quando o
 * caminho do diretorio de dados tem acento. O diretorio e criado em `os.tmpdir()`
 * de proposito; se o seu `TEMP` tiver acento, aponte `TMPDIR`/`TEMP` para um
 * caminho ASCII antes de rodar.
 *
 * Uso: pnpm --filter @screena/sync prove:scheduler-lock
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

import { advisoryLockKey } from '../src/scheduler/lock.js'
import { createAdvisoryLockPort, createLockClient } from '../src/scheduler/runtime/advisory-lock.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

// ---------------------------------------------------------------------------
// MODO FILHO: pega a trava, segura, e reporta em JSON numa linha.
// ---------------------------------------------------------------------------

async function child(): Promise<void> {
  const url = process.env.PROVE_DATABASE_URL ?? ''
  const queue = process.env.PROVE_QUEUE ?? 'ratings_omdb'
  const holdMs = Number(process.env.PROVE_HOLD_MS ?? '2000')

  const client = createLockClient(url)
  const lock = createAdvisoryLockPort(client)
  const outcome = await lock.tryAcquire(queue)
  process.stdout.write(
    `${JSON.stringify({ pid: process.pid, queue, acquired: outcome.acquired, key: outcome.key.toString() })}\n`,
  )
  if (!outcome.acquired) {
    await client.$disconnect()
    process.exit(0)
  }
  await sleep(holdMs)
  await lock.release(queue)
  await client.$disconnect()
  process.exit(0)
}

// ---------------------------------------------------------------------------
// MODO PAI
// ---------------------------------------------------------------------------

interface ChildRun {
  readonly pid: number
  readonly acquired: boolean
  readonly key: string
}

function tsxBin(): string {
  return path.join(repoRoot, 'services', 'ingestion', 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function spawnChild(env: Record<string, string>): {
  readonly kill: () => void
  readonly first: Promise<ChildRun | null>
  readonly done: Promise<number | null>
} {
  const entry = path.join(here, 'prove-scheduler-lock.ts')
  const proc = spawn(process.execPath, [tsxBin(), entry, '--child'], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer = ''
  let resolveFirst: (value: ChildRun | null) => void = () => {}
  const first = new Promise<ChildRun | null>((resolve) => {
    resolveFirst = resolve
  })
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const newline = buffer.indexOf('\n')
    if (newline < 0) return
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    try {
      resolveFirst(JSON.parse(line) as ChildRun)
    } catch {
      /* linha de ruido; espera a proxima */
    }
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[filho] ${chunk.toString('utf8')}`)
  })
  const done = new Promise<number | null>((resolve) => {
    proc.on('exit', (code) => {
      resolveFirst(null)
      resolve(code)
    })
  })
  return { kill: () => proc.kill('SIGKILL'), first, done }
}

async function main(): Promise<number> {
  const pgPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-lock-'))
  const database = 'cinerie_lock_proof'
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  })

  const failures: string[] = []
  const check = (ok: boolean, label: string): void => {
    log(`   ${ok ? 'OK  ' : 'FALHA'} ${label}`)
    if (!ok) failures.push(label)
  }

  try {
    log('== subindo PostgreSQL efemero (sem migration: advisory lock nao usa tabela) ==')
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(database)
    const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}`

    // ---- [1] Dois processos, uma fila ------------------------------------
    log('')
    log('== [1] DOIS PROCESSOS na MESMA fila ==')
    const a = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'ratings_omdb', PROVE_HOLD_MS: '3000' })
    // Espera o primeiro REPORTAR antes de subir o segundo: sem isto, os dois
    // poderiam disputar antes de qualquer um ter conectado, e o teste mediria
    // uma corrida de conexao em vez da trava.
    const aRun = await a.first
    const b = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'ratings_omdb', PROVE_HOLD_MS: '100' })
    const bRun = await b.first

    log(`   filho A: pid=${aRun?.pid} acquired=${String(aRun?.acquired)}`)
    log(`   filho B: pid=${bRun?.pid} acquired=${String(bRun?.acquired)}`)
    check(aRun?.acquired === true, 'o primeiro processo PEGA a trava')
    check(bRun?.acquired === false, 'o segundo processo e RECUSADO (nao espera, nao roda)')
    check(
      aRun?.key === advisoryLockKey('ratings_omdb').toString(),
      'a chave e a derivada do nome da fila, identica nos dois processos',
    )
    await a.done
    await b.done

    // ---- [2] Filas diferentes --------------------------------------------
    log('')
    log('== [2] DOIS PROCESSOS em filas DIFERENTES (controle) ==')
    const c = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'watch_offers', PROVE_HOLD_MS: '2000' })
    const cRun = await c.first
    const d = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'awards', PROVE_HOLD_MS: '100' })
    const dRun = await d.first
    check(
      cRun?.acquired === true && dRun?.acquired === true,
      'filas diferentes rodam em paralelo (a trava e por fila, nao global)',
    )
    await c.done
    await d.done

    // ---- [3] Processo morto a SIGKILL -------------------------------------
    log('')
    log('== [3] PROCESSO MORTO no meio: a trava tem que ser liberada ==')
    const e = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'discovery', PROVE_HOLD_MS: '60000' })
    const eRun = await e.first
    check(eRun?.acquired === true, 'o processo pegou a trava e esta segurando')
    e.kill()
    await e.done
    // O Postgres so nota a queda quando a conexao fecha; alguns milissegundos.
    await sleep(1_000)

    const f = spawnChild({ PROVE_DATABASE_URL: url, PROVE_QUEUE: 'discovery', PROVE_HOLD_MS: '100' })
    const fRun = await f.first
    check(
      fRun?.acquired === true,
      'depois do SIGKILL, o PROXIMO processo entra (a fila nao ficou congelada)',
    )
    await f.done

    // ---- Resumo ------------------------------------------------------------
    log('')
    if (failures.length === 0) {
      log('RESULTADO: 4/4 provas OK — a trava funciona entre processos.')
      return 0
    }
    log(`RESULTADO: ${failures.length} FALHA(S):`)
    for (const failure of failures) log(`  - ${failure}`)
    return 1
  } finally {
    try {
      await pg.stop()
    } catch {
      /* pode ja ter morrido */
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true })
        break
      } catch {
        await sleep(300)
      }
    }
  }
}

if (process.argv.includes('--child')) {
  void child()
} else {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`Falha na prova da trava: ${String(error)}\n`)
      process.exit(1)
    })
}
