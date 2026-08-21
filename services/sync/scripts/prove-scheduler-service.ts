#!/usr/bin/env node
/**
 * prove-scheduler-service.ts — O agendador de ponta a ponta, com PostgreSQL de
 * verdade e as migrations REAIS.
 *
 * ============================================================================
 * O QUE ISTO PROVA QUE UM TESTE DE UNIDADE NAO PROVA
 * ============================================================================
 * Que o processo SOBE, abre a porta, le `api_sync_logs` num banco real, avalia as
 * onze filas e serve o painel — sem `.env`, sem rede externa e sem tocar
 * producao. Os testes puros provam as decisoes; este prova a MONTAGEM: imports,
 * config, Prisma, HTTP e o primeiro ciclo.
 *
 * DRY-RUN SEMPRE (`CINERIE_SCHEDULER_APPLY` fica de fora): o agendador avalia,
 * seleciona e loga, e nao enfileira nada. Uma prova que escrevesse no banco
 * estaria testando o efeito colateral, nao a montagem.
 *
 * NOTA DE AMBIENTE (Windows): o `initdb` do `embedded-postgres` falha em caminho
 * com acento. O diretorio de dados sai de `os.tmpdir()`; se o seu `TEMP` tiver
 * acento, aponte `TMPDIR`/`TEMP` para um caminho ASCII antes de rodar.
 *
 * Uso: pnpm --filter @screena/sync prove:scheduler-service
 */

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

import { RHYTHMS } from '../src/scheduler/rhythms.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

/** Token FALSO. O dry-run nunca chega a rede; o gate de config exige presenca. */
const FAKE_TMDB_TOKEN = 'token-de-prova-nao-e-credencial'

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

function tsxBin(): string {
  return path.join(repoRoot, 'services', 'ingestion', 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function prismaBin(): string {
  return path.join(dbDir, 'node_modules', 'prisma', 'build', 'index.js')
}

async function get(port: number, route: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${route}`)
  return { status: response.status, body: await response.text() }
}

async function waitFor(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const health = await get(port, '/healthz')
      if (health.status === 200) return true
    } catch {
      /* ainda subindo */
    }
    await sleep(300)
  }
  return false
}

async function main(): Promise<number> {
  const pgPort = await freePort()
  const httpPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-sched-'))
  const database = 'cinerie_scheduler_proof'
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

  let child: ReturnType<typeof spawn> | null = null

  try {
    log('== subindo PostgreSQL 16 efemero ==')
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(database)
    const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}`

    log('== aplicando as migrations REAIS do screen-db ==')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      cwd: dbDir,
    })

    log('')
    log('== subindo o agendador em DRY-RUN ==')
    child = spawn(
      process.execPath,
      [tsxBin(), path.join(repoRoot, 'services', 'sync', 'bin', 'cinerie-scheduler.ts')],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: url,
          TMDB_READ_ACCESS_TOKEN: FAKE_TMDB_TOKEN,
          CINERIE_SCHEDULER_HEALTH_PORT: String(httpPort),
          CINERIE_SCHEDULER_TICK_MS: '60000',
          CINERIE_SCHEDULER_WORKER_ID: 'prova',
          NODE_ENV: 'test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stderr = ''
    child.stdout?.on('data', () => undefined)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const subiu = await waitFor(httpPort, 60_000)
    check(subiu, 'o processo sobe e responde /healthz')
    if (!subiu) {
      log(`   stderr: ${stderr.slice(0, 800)}`)
      return 1
    }

    // ---- readiness ---------------------------------------------------------
    const ready = await get(httpPort, '/readyz')
    const readyJson = JSON.parse(ready.body) as {
      status: string
      checks: { name: string; status: string }[]
    }
    check(ready.status === 200 && readyJson.status === 'ready', '/readyz diz PRONTO com banco real')
    check(
      readyJson.checks.some((c) => c.name === 'stalled_queues'),
      '/readyz carrega a contagem de filas paradas (informativa, nao bloqueante)',
    )

    // ---- painel HTML -------------------------------------------------------
    const status = await get(httpPort, '/status')
    check(status.status === 200, '/status responde 200')
    check(
      status.body.trimStart().toLowerCase().startsWith('<!doctype html>'),
      '/status serve HTML por padrao',
    )
    const todasAsFilas = RHYTHMS.every((rhythm) => status.body.includes(rhythm.queue))
    check(todasAsFilas, `o painel lista as ${RHYTHMS.length} filas da tabela de ritmos`)
    check(status.body.includes('NUNCA RODOU'), 'banco vazio => toda fila aparece como NUNCA RODOU')
    check(!/<script/i.test(status.body), 'o painel nao carrega script')
    check(!/https?:\/\//i.test(status.body), 'o painel nao faz requisicao externa')

    // ---- painel JSON -------------------------------------------------------
    const json = await get(httpPort, '/status?format=json')
    const report = JSON.parse(json.body) as {
      rows: { queue: string }[]
      quotas: { providerApi: string; dailyLimit: number | null; remainingForBackground: number | null }[]
    }
    check(report.rows.length === RHYTHMS.length, '/status?format=json traz uma linha por fila')
    const omdb = report.quotas.find((q) => q.providerApi === 'omdb')
    check(omdb?.dailyLimit === 1_000, 'a cota da OMDb aparece com o teto publicado (1.000/dia)')
    check(
      omdb !== undefined && omdb.remainingForBackground !== null && omdb.remainingForBackground < omdb.dailyLimit!,
      'o saldo da FILA DE FUNDO e menor que o teto: a reserva do leitor esta descontada',
    )

    // ---- superficie minima -------------------------------------------------
    const naoExiste = await get(httpPort, '/enfileirar')
    check(naoExiste.status === 404, 'nenhuma rota alem das tres: /enfileirar da 404')

    // ---- desligamento limpo ------------------------------------------------
    const pedidoEm = Date.now()
    child.kill('SIGTERM')
    const saiu = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 30_000)
      child!.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code)
      })
    })
    const levou = Date.now() - pedidoEm

    /**
     * O DESLIGAMENTO SO PODE SER MEDIDO EM POSIX, e dizer isso e obrigatorio.
     *
     * O Windows NAO TEM SIGTERM: `child.kill('SIGTERM')` vira `TerminateProcess`,
     * o processo morre na hora e `process.on('SIGTERM')` do filho nunca roda. Um
     * check de "codigo 0" aqui reprovaria SEMPRE no Windows, por um motivo que
     * nao e defeito do agendador — e afrouxar o check para "saiu de algum jeito"
     * nos dois sistemas apagaria a unica prova da drenagem no sistema onde ela
     * acontece (o container e Linux).
     *
     * Entao o check e DIFERENTE por plataforma, e cada um afirma o que aquele
     * sistema consegue provar.
     */
    if (process.platform === 'win32') {
      check(
        levou < 10_000,
        `Windows: kill encerra prontamente em ${levou}ms ` +
          '(SIGTERM nao existe aqui; a drenagem limpa so e verificavel em POSIX/CI)',
      )
    } else {
      check(
        saiu === 0,
        `SIGTERM desliga com codigo 0 (drenagem limpa) — saiu=${String(saiu)} em ${levou}ms`,
      )
      if (saiu !== 0) {
        // Um check que falha sem dizer o que aconteceu nao serve para nada.
        log(`   stderr do agendador: ${stderr.trim().slice(-600) || '(vazio)'}`)
      }
    }

    log('')
    if (failures.length === 0) {
      log('RESULTADO: todas as provas OK — o agendador sobe, le o banco e serve o painel.')
      return 0
    }
    log(`RESULTADO: ${failures.length} FALHA(S):`)
    for (const failure of failures) log(`  - ${failure}`)
    return 1
  } finally {
    try {
      child?.kill('SIGKILL')
    } catch {
      /* pode ja ter morrido */
    }
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

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`Falha na prova do agendador: ${String(error)}\n`)
    process.exit(1)
  })
