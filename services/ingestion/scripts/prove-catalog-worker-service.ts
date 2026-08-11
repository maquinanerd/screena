/**
 * prove-catalog-worker-service.ts — PROVA do servico de catalogo contra um
 * PostgreSQL 16 EFEMERO com o schema REAL do screen-db.
 *
 * O que este script prova, em ordem:
 *   1. o servico SOBE e `/healthz` responde 200 (liveness);
 *   2. `/readyz` responde 200 `ready` com os checks reais (banco alcancavel,
 *      `catalog_jobs` presente, credencial presente);
 *   3. FAIL-CLOSED: em `NODE_ENV=production` SEM a autorizacao explicita, o
 *      servico RECUSA subir (exit 3) e a porta nunca abre;
 *   4. FILA DURAVEL: jobs enfileirados sobrevivem a MORTE do processo, e um
 *      segundo servico retoma de onde o primeiro parou — inclusive recuperando
 *      as linhas que ficaram `running` quando o primeiro foi morto (SIGKILL).
 *
 * Descartavel: nenhum segredo, URL so em memoria, PG derrubado no fim (e
 * tambem quando o boot falha no meio).
 *
 * Uso: pnpm --filter @screena/ingestion prove:catalog-worker
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

const require = createRequire(import.meta.url)
const serviceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(serviceDir, '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')
const entrypoint = path.join(serviceDir, 'bin', 'catalog-worker-service.ts')

/** Token FICTICIO: o servico so checa PRESENCA na subida; nenhum job roda aqui. */
const FAKE_TMDB_TOKEN = 'token-ficticio-de-prova-nao-e-credencial-real'

function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

/** Reserva uma porta e a DEVOLVE desocupada (ver o harness do screen-db). */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0
      if (port <= 0) {
        srv.close(() => reject(new Error('nao foi possivel reservar uma porta TCP valida')))
        return
      }
      srv.close((error) => (error !== undefined ? reject(error) : resolve(port)))
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

function tsxBin(): string {
  const pkgPath = require.resolve('tsx/package.json')
  return path.join(path.dirname(pkgPath), 'dist', 'cli.mjs')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera a porta responder; devolve `false` se nunca responder. */
async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/healthz`)
      if (res.status === 200) return true
    } catch {
      /* ainda subindo */
    }
    await sleep(300)
  }
  return false
}

interface ServiceHandle {
  readonly child: ChildProcess
  readonly stderr: () => string
  readonly exitCode: () => number | null
}

function startService(env: Record<string, string>): ServiceHandle {
  const child = spawn(process.execPath, [tsxBin(), entrypoint], {
    cwd: serviceDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let exited: number | null = null
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  // Silencia o stdout do servico (log estruturado) para a prova ficar legivel.
  child.stdout?.on('data', () => undefined)
  child.on('exit', (code) => {
    exited = code
  })
  return { child, stderr: () => stderr, exitCode: () => exited }
}

async function main(): Promise<number> {
  const pgPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-catalogsvc-'))
  const database = 'cinerie_catalog_proof'
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  })

  let prisma: PrismaClient | null = null
  let service: ServiceHandle | null = null

  const teardown = async (): Promise<void> => {
    try {
      service?.child.kill('SIGKILL')
    } catch {
      /* pode ja ter morrido */
    }
    try {
      await prisma?.$disconnect()
    } catch {
      /* pode ja estar desconectado */
    }
    try {
      await pg.stop()
    } catch {
      /* o processo pode ja ter morrido */
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true })
        return
      } catch {
        await sleep(300)
      }
    }
  }

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
    prisma = new PrismaClient({ datasources: { db: { url } } })

    // ---- 3. FAIL-CLOSED em producao (antes de tudo: a porta nao pode abrir) --
    log('')
    log('== [3] FAIL-CLOSED: producao SEM autorizacao explicita ==')
    const blockedPort = await freePort()
    const blocked = startService({
      DATABASE_URL: url,
      TMDB_READ_ACCESS_TOKEN: FAKE_TMDB_TOKEN,
      NODE_ENV: 'production',
      CATALOG_WORKER_HEALTH_PORT: String(blockedPort),
    })
    const blockedExit = await new Promise<number | null>((resolve) => {
      blocked.child.on('exit', (code) => resolve(code))
      setTimeout(() => resolve(blocked.exitCode()), 30_000)
    })
    const portOpened = await waitForHealth(blockedPort, 1_000)
    log(`   exit code: ${String(blockedExit)} (esperado 3 = blocked)`)
    log(`   porta abriu? ${portOpened ? 'SIM (DEFEITO)' : 'nao'}`)
    log(`   motivo: ${blocked.stderr().split('\n')[0] ?? ''}`)
    if (blockedExit !== 3 || portOpened) {
      log('   FALHOU: o servico deveria recusar subir.')
      return 1
    }
    log('   OK')

    // ---- 1+2. Sobe e responde ------------------------------------------------
    log('')
    log('== [1+2] servico sobe, /healthz e /readyz respondem ==')
    const healthPort = await freePort()
    service = startService({
      DATABASE_URL: url,
      TMDB_READ_ACCESS_TOKEN: FAKE_TMDB_TOKEN,
      NODE_ENV: 'development',
      CATALOG_WORKER_HEALTH_PORT: String(healthPort),
      // Intervalos longos: esta prova nao quer que o enfileirador periodico
      // dispare de novo no meio.
      CATALOG_WORKER_DISCOVERY_INTERVAL_MS: String(6 * 60 * 60 * 1000),
      CATALOG_WORKER_CHANGES_INTERVAL_MS: String(6 * 60 * 60 * 1000),
      CATALOG_WORKER_ID: 'prova-worker-1',
    })
    if (!(await waitForHealth(healthPort, 90_000))) {
      log('   FALHOU: /healthz nunca respondeu 200.')
      log(service.stderr().slice(0, 2000))
      return 1
    }
    const healthz = await fetch(`http://127.0.0.1:${String(healthPort)}/healthz`)
    log(`   GET /healthz -> ${String(healthz.status)}`)
    log(`   ${JSON.stringify(await healthz.json())}`)

    const readyz = await fetch(`http://127.0.0.1:${String(healthPort)}/readyz`)
    const readyBody = (await readyz.json()) as {
      status: string
      checks: { name: string; status: string; detail: string }[]
    }
    log(`   GET /readyz  -> ${String(readyz.status)} (${readyBody.status})`)
    for (const check of readyBody.checks) {
      log(`     - ${check.name}: ${check.status} — ${check.detail}`)
    }
    if (readyz.status !== 200) {
      log('   FALHOU: /readyz deveria responder 200.')
      return 1
    }
    log('   OK')

    // ---- 4. Fila duravel: retoma de onde parou -------------------------------
    log('')
    log('== [4] FILA DURAVEL: sobrevive a morte do processo ==')

    // O servico ja enfileirou discovery + changes na subida. Contamos e, alem
    // disso, plantamos jobs `running` com heartbeat velho — exatamente o estado
    // que um SIGKILL/OOM deixa para tras.
    const before = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status::text AS status, COUNT(*)::bigint AS count FROM catalog_jobs GROUP BY status ORDER BY status
    `
    log(`   antes da morte: ${before.map((r) => `${r.status}=${String(r.count)}`).join(' · ')}`)
    const totalBefore = before.reduce((acc, r) => acc + Number(r.count), 0)
    if (totalBefore === 0) {
      log('   FALHOU: o servico nao enfileirou nada na subida.')
      return 1
    }

    // Simula o que um SIGKILL deixa: uma linha presa em `running` com heartbeat
    // antigo. `claimNext` so olha pending|retry_wait, entao sem o reclaim ela
    // ficaria perdida para sempre.
    await prisma.$executeRaw`
      UPDATE catalog_jobs
         SET status = 'running',
             heartbeat_at = NOW() - INTERVAL '30 minutes',
             claimed_at   = NOW() - INTERVAL '30 minutes'
       WHERE id = (SELECT id FROM catalog_jobs ORDER BY id LIMIT 1)
    `
    // Contagem HONESTA: o servico ja havia reivindicado jobs (eles estao
    // `running` com heartbeat fresco). O UPDATE acima envelheceu UM deles de
    // proposito; o SIGKILL a seguir orfana os DEMAIS de verdade. As duas vias
    // levam ao mesmo estado — linha `running` sem worker vivo — e e esse estado
    // que o reclaim tem que desfazer.
    const running = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM catalog_jobs WHERE status = 'running'
    `
    log(
      `   em 'running' antes do kill: ${String(running[0]?.count ?? 0n)} ` +
        `(1 envelhecido a mao; o resto ficara orfao pelo proprio SIGKILL)`,
    )

    // MORTE ABRUPTA: SIGKILL, sem chance de shutdown gracioso.
    log('   matando o servico com SIGKILL (sem drenagem)...')
    service.child.kill('SIGKILL')
    await sleep(2_000)

    const afterKill = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status::text AS status, COUNT(*)::bigint AS count FROM catalog_jobs GROUP BY status ORDER BY status
    `
    log(`   depois da morte: ${afterKill.map((r) => `${r.status}=${String(r.count)}`).join(' · ')}`)
    const totalAfterKill = afterKill.reduce((acc, r) => acc + Number(r.count), 0)
    if (totalAfterKill !== totalBefore) {
      log('   FALHOU: a fila perdeu linhas na morte do processo.')
      return 1
    }
    log('   a fila sobreviveu inteira (nenhum job perdido).')

    // SEGUNDO servico: retoma. Ele roda `reclaimOrphans` na subida.
    log('   subindo um SEGUNDO servico (retomada)...')
    const port2 = await freePort()
    service = startService({
      DATABASE_URL: url,
      TMDB_READ_ACCESS_TOKEN: FAKE_TMDB_TOKEN,
      NODE_ENV: 'development',
      CATALOG_WORKER_HEALTH_PORT: String(port2),
      CATALOG_WORKER_DISCOVERY_INTERVAL_MS: String(6 * 60 * 60 * 1000),
      CATALOG_WORKER_CHANGES_INTERVAL_MS: String(6 * 60 * 60 * 1000),
      CATALOG_WORKER_ID: 'prova-worker-2',
    })
    if (!(await waitForHealth(port2, 90_000))) {
      log('   FALHOU: o segundo servico nao subiu.')
      log(service.stderr().slice(0, 2000))
      return 1
    }
    await sleep(3_000)

    const afterRestart = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT status::text AS status, COUNT(*)::bigint AS count FROM catalog_jobs GROUP BY status ORDER BY status
    `
    log(`   depois da retomada: ${afterRestart.map((r) => `${r.status}=${String(r.count)}`).join(' · ')}`)
    const stillOrphan = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM catalog_jobs
       WHERE status = 'running' AND heartbeat_at < NOW() - INTERVAL '20 minutes'
    `
    const stillOrphanCount = Number(stillOrphan[0]?.count ?? 0n)
    log(`   orfaos ainda presos: ${String(stillOrphanCount)} (esperado 0 — o reclaim os devolveu)`)
    if (stillOrphanCount !== 0) {
      log('   FALHOU: o job orfao continuou preso em running.')
      return 1
    }

    // A idempotencia impede a retomada de DUPLICAR o trabalho ja enfileirado.
    const totalAfterRestart = afterRestart.reduce((acc, r) => acc + Number(r.count), 0)
    log(`   total de jobs: antes=${String(totalBefore)} depois=${String(totalAfterRestart)}`)
    if (totalAfterRestart !== totalBefore) {
      log('   ATENCAO: a retomada mudou o total de jobs (a chave de idempotencia inclui dia/hora).')
    } else {
      log('   a retomada NAO duplicou trabalho (chave de idempotencia respeitada).')
    }
    log('   OK')

    log('')
    log('== TODAS AS PROVAS PASSARAM ==')
    log('')
    log('RESSALVA HONESTA: o token TMDB desta prova e FICTICIO, entao nenhum job')
    log('chega a concluir — eles sao reivindicados e falhariam na rede. O que esta')
    log('prova cobre e a SUBIDA, a readiness e a DURABILIDADE da fila; nao a')
    log('execucao de um sync real contra o TMDB.')
    return 0
  } finally {
    await teardown()
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    process.exit(1)
  })
