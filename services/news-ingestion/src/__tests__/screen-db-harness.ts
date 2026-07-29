/**
 * screen-db-harness.ts — PostgreSQL 16 efemero com o schema REAL do banco
 * publico (screen-db), para o teste de integracao da projecao editorial.
 *
 * SEGUNDO banco do teste. O primeiro (Payload) sobe pelo harness do CMS. Sao
 * dois processos Postgres distintos de proposito: a separacao dos bancos e a
 * tese do ADR 0015, e um teste que rodasse os dois lados sobre a mesma base
 * nao provaria nada sobre ela.
 *
 * DESCARTAVEL. Nenhum segredo, URL so em memoria, PG derrubado no `stop()`.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

export interface ScreenDbHarness {
  readonly prisma: PrismaClient
  /** URL do banco efemero. NAO deve ser impressa em log de teste. */
  readonly url: string
  stop(): Promise<void>
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
      srv.close()
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

export async function startScreenDbHarness(): Promise<ScreenDbHarness> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-screendb-'))
  const database = 'cinerie_projection_it'
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })

  await pg.initialise()
  await pg.start()
  await pg.createDatabase(database)
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${database}`

  // Migration REAL, nao SQL sintetico: o teste tem que falhar se a migration
  // que vai para producao estiver errada.
  const env = { ...process.env, DATABASE_URL: url }
  execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
    env,
    stdio: 'pipe',
    cwd: dbDir,
  })
  // O seed traz `languages` (pt-BR/en/es), sem o qual a FK da traducao recusa.
  execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', schemaPath], {
    env,
    stdio: 'pipe',
    cwd: dbDir,
  })

  const prisma = new PrismaClient({ datasources: { db: { url } } })

  return {
    prisma,
    url,
    stop: async (): Promise<void> => {
      await prisma.$disconnect()
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
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      }
    },
  }
}
