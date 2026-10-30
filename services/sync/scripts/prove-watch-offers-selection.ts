#!/usr/bin/env node
/**
 * prove-watch-offers-selection.ts — A selecao da fila `watch_offers` contra
 * PostgreSQL REAL: a marca de "conferido" em `api_cache` tira o titulo da fila.
 *
 * FERRAMENTA DE DESENVOLVIMENTO. Nunca roda no render nem em producao.
 *
 * POR QUE BANCO REAL: a marca e a linha que o adapter de cache de PRODUCAO
 * (`createPrismaCache`) grava, e a selecao a casa por uma chave montada em SQL
 * (`'/movie/' || tmdb_id || '/watch/providers'`). Os testes de unidade usam um
 * banco falso e nao distinguem uma chave que casa de uma que nunca casa — e uma
 * chave que nunca casa devolveria o defeito: o titulo sem oferta voltando ao
 * topo todo dia.
 *
 * AS PROVAS
 *   [1] sem marca nenhuma, os dois filmes entram, em ordem de popularidade;
 *   [2] o filme conferido HOJE pelo cache de producao sai da fila;
 *   [3] CONTROLE NEGATIVO: conferido ha mais que a janela, ele VOLTA.
 *
 * Uso: pnpm --filter @screena/sync prove:watch-offers-selection
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { runChild } from '@screena/db/async-child-process'

import { createPrismaCache } from '../../ingestion/src/persistence/cache.js'
import { WATCH_OFFERS_REFRESH_DAYS, watchProvidersEndpoint } from '../src/scheduler/runtime/runners.js'
import { selectStaleWatchOffers } from '../src/scheduler/runtime/selection.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date()

const results: { ok: boolean; name: string }[] = []
function record(name: string, ok: boolean, detail: string): void {
  results.push({ ok, name })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`)
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
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

type Prisma = Parameters<typeof selectStaleWatchOffers>[0]

async function runChecks(prisma: Prisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO movies (tmdb_id, title_original, popularity, created_at, updated_at)
     VALUES (1, 'popular', 100, now(), now()), (2, 'menos-popular', 10, now(), now())`,
  )
  const olderThan = new Date(NOW.getTime() - WATCH_OFFERS_REFRESH_DAYS * DAY_MS)
  const pick = async (): Promise<number[]> =>
    (await selectStaleWatchOffers(prisma, olderThan, 10)).map((c) => c.tmdbId)

  const first = await pick()
  record('[1] sem marca, os dois entram por popularidade', first.join(',') === '1,2', `selecao=${first.join(',')}`)

  // A marca gravada pelo MESMO adapter de cache que a fila usa em producao.
  const cache = createPrismaCache(prisma, { ttlMs: DAY_MS, now: () => NOW })
  await cache.getOrFetch({
    endpoint: watchProvidersEndpoint('movie', 1),
    fetcher: async () => ({ results: {} }),
  })
  const second = await pick()
  record('[2] conferido hoje (sem oferta) sai da fila', second.join(',') === '2', `selecao=${second.join(',')}`)

  await prisma.$executeRawUnsafe(
    `UPDATE api_cache SET fetched_at = now() - interval '${String(WATCH_OFFERS_REFRESH_DAYS + 1)} days'
      WHERE provider_api = 'tmdb' AND request_key = '/movie/1/watch/providers'`,
  )
  const third = await pick()
  record('[3] CONTROLE NEGATIVO: conferido fora da janela VOLTA', third.join(',') === '1,2', `selecao=${third.join(',')}`)
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-watch-selection-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: true })
  const dbName = 'cinerie_watch_selection'
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${dbName}?schema=public`
  let started = false
  let disconnect: (() => Promise<void>) | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase(dbName)
    process.env.DATABASE_URL = url
    const env = { ...process.env, DATABASE_URL: url }
    await runChild('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], { env, stdio: 'inherit', cwd: dbDir })
    await runChild('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], { env, stdio: 'inherit', cwd: dbDir })
    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => Prisma
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma
    await runChecks(dbServer.getPrismaClient())
  } catch (e) {
    record('execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch {
      // limpo pelo SO
    }
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} provas OK.`)
  if (results.length < 3 || failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
