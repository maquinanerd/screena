/**
 * validate-tmdb-catalog-real-postgres.ts — Validador de INTEGRACAO do sync de
 * taxonomia/config do TMDB (Fase 6) contra PostgreSQL 16 EFEMERO.
 *
 * Nao testa SQL sintetico nem chama o TMDB real: usa o CLIENT REAL
 * (`TmdbHttpClient` + `createTmdbCatalogEndpoints`) com um TRANSPORTE FALSO local
 * (payloads canned), e os ADAPTERS Prisma REAIS (`createPrismaCache`,
 * `createPrismaSyncLog`, `createPrismaImageConfigStore`) sobre um banco com as
 * migrations aplicadas. Prova: captura raw (api_cache) + log (api_sync_logs) +
 * normalizacao (tmdb_image_config) + idempotencia + determinismo de mudanca.
 *
 * Ferramenta DESCARTAVEL (nunca em produto/render/prod). Motor: embedded-postgres
 * (PostgreSQL 16 real, efemero). Sem segredo real; instancia derrubada no finally.
 *
 * Uso: pnpm --filter @screena/ingestion validate:tmdb-catalog
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
import {
  createTmdbCatalogEndpoints,
  loadTmdbConfig,
  TmdbHttpClient,
  type HttpResponse,
  type HttpTransport,
} from '@screena/tmdb-client'

import { createPrismaCache } from '../src/persistence/cache.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { createPrismaImageConfigStore } from '../src/persistence/image-config-store.js'
import { TAXONOMY_ENDPOINTS, runTaxonomySync, type TaxonomyReadPort } from '../src/config-sync/run.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
      srv.close()
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
    try { rmSync(dir, { recursive: true, force: true }); return } catch { await new Promise((r) => setTimeout(r, 300)) }
  }
}

/** Estado mutavel do "servidor TMDB falso": permite mudar o payload no 3o ciclo. */
let configSecureBaseUrl = 'https://image.tmdb.org/t/p/'

function fakePayload(pathname: string): unknown {
  const map: Record<string, unknown> = {
    '/3/configuration': {
      images: {
        base_url: 'http://image.tmdb.org/t/p/',
        secure_base_url: configSecureBaseUrl,
        poster_sizes: ['w92', 'w154', 'original'],
        backdrop_sizes: ['w300', 'original'],
        still_sizes: ['w92', 'original'],
        profile_sizes: ['w45', 'original'],
        logo_sizes: ['w45', 'original'],
      },
      change_keys: ['adult', 'air_date'],
    },
    '/3/genre/movie/list': { genres: [{ id: 28, name: 'Acao' }] },
    '/3/genre/tv/list': { genres: [{ id: 10759, name: 'Acao & Aventura' }] },
    '/3/certification/movie/list': { certifications: { BR: [{ certification: '14', order: 3 }] } },
    '/3/certification/tv/list': { certifications: { BR: [{ certification: '16', order: 4 }] } },
    '/3/configuration/countries': [{ iso_3166_1: 'BR', english_name: 'Brazil' }],
    '/3/configuration/languages': [{ iso_639_1: 'pt', english_name: 'Portuguese' }],
    '/3/configuration/jobs': [{ department: 'Directing', jobs: ['Director'] }],
  }
  return map[pathname] ?? {}
}

const fakeTransport: HttpTransport = async (request) => {
  const response: HttpResponse = {
    status: 200,
    headers: {},
    body: JSON.stringify(fakePayload(new URL(request.url).pathname)),
  }
  return response
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-tmdb-catalog-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_tmdb_catalog?schema=public`
  console.log(`\n=== TMDB catalog integration — Postgres efemero :${port} ===\n`)

  let started = false
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('screena_tmdb_catalog')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy + db seed ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })
    execFileSync('node', [prismaBin(), 'db', 'seed'], { env, stdio: 'inherit', cwd: dbDir })

    // Estado determinista: limpa raw/log/config (o worker os popula do zero).
    await prisma.$executeRawUnsafe(`DELETE FROM api_cache`)
    await prisma.$executeRawUnsafe(`DELETE FROM api_sync_logs`)
    await prisma.$executeRawUnsafe(`DELETE FROM tmdb_image_config`)

    // Client REAL com transporte FALSO (exercita build de URL, parsing, resiliencia).
    const config = loadTmdbConfig({ TMDB_API_KEY: 'fake-key-nao-usada', TMDB_MAX_RPS: '1000' })
    const http = new TmdbHttpClient(config, { transport: fakeTransport })
    const read: TaxonomyReadPort = createTmdbCatalogEndpoints(http, config)
    const cache = createPrismaCache(prisma as never, { ttlMs: 3_600_000, now: () => new Date() })
    const log = createPrismaSyncLog(prisma as never)
    const imageConfigStore = createPrismaImageConfigStore(prisma as never)
    const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

    // ---- Ciclo 1 ----
    const run1 = await runTaxonomySync({ read, cache, log, imageConfigStore, now: () => new Date() })

    const cacheCount1 = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_cache WHERE provider_api='tmdb'`))[0]!.c
    record(1, 'ciclo 1: captura raw dos 8 endpoints em api_cache', cacheCount1 === TAXONOMY_ENDPOINTS.length, `linhas=${cacheCount1}`)

    const logCount1 = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_sync_logs WHERE provider_api='tmdb'`))[0]!.c
    record(2, 'ciclo 1: 1 log por endpoint em api_sync_logs (todo sync gera log)', logCount1 === TAXONOMY_ENDPOINTS.length, `logs=${logCount1}`)

    const cfg1 = (await q<{ secure_base_url: string; updated_at: Date }>(`SELECT secure_base_url, updated_at FROM tmdb_image_config WHERE provider_api='tmdb'`))[0]
    record(3, 'ciclo 1: /configuration normalizado em tmdb_image_config', !!cfg1 && cfg1.secure_base_url === 'https://image.tmdb.org/t/p/', `secure_base_url=${cfg1?.secure_base_url}`)
    record(4, 'ciclo 1: summary marca created=true', run1.imageConfig.created === true && run1.imageConfig.normalized === true, `created=${run1.imageConfig.created}`)

    // ---- Ciclo 2 (identico, dentro do TTL) ----
    const run2 = await runTaxonomySync({ read, cache, log, imageConfigStore, now: () => new Date() })
    const cacheCount2 = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_cache WHERE provider_api='tmdb'`))[0]!.c
    record(5, 'ciclo 2: idempotente — api_cache nao duplica (short-circuit por TTL)', cacheCount2 === TAXONOMY_ENDPOINTS.length, `linhas=${cacheCount2}`)
    record(6, 'ciclo 2: config inalterado (changed=false, sem reescrita)', run2.imageConfig.changed === false, `changed=${run2.imageConfig.changed}`)

    const cfg2 = (await q<{ updated_at: Date }>(`SELECT updated_at FROM tmdb_image_config WHERE provider_api='tmdb'`))[0]!
    const sameUpdatedAt = cfg1 !== undefined && new Date(cfg1.updated_at).getTime() === new Date(cfg2.updated_at).getTime()
    record(7, 'ciclo 2: tmdb_image_config.updated_at NAO bumpado (no-op real)', sameUpdatedAt, `igual=${sameUpdatedAt}`)

    // ---- Ciclo 3 (payload mudou; cache expirada) ----
    await prisma.$executeRawUnsafe(`UPDATE api_cache SET expires_at = now() - interval '1 day'`)
    configSecureBaseUrl = 'https://cdn.thescreen.media/t/p/'
    const run3 = await runTaxonomySync({ read, cache, log, imageConfigStore, now: () => new Date() })
    const cfg3 = (await q<{ secure_base_url: string }>(`SELECT secure_base_url FROM tmdb_image_config WHERE provider_api='tmdb'`))[0]!
    record(8, 'ciclo 3: payload mudou -> config atualizado deterministicamente', run3.imageConfig.changed === true && cfg3.secure_base_url === 'https://cdn.thescreen.media/t/p/', `changed=${run3.imageConfig.changed}, secure=${cfg3.secure_base_url}`)

    const logCount3 = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_sync_logs WHERE provider_api='tmdb'`))[0]!.c
    record(9, '3 ciclos -> 24 logs (nenhuma ingestao silenciosa)', logCount3 === TAXONOMY_ENDPOINTS.length * 3, `logs=${logCount3}`)

    const distinctEndpoints = (await q<{ c: number }>(`SELECT count(DISTINCT endpoint)::int AS c FROM api_cache WHERE provider_api='tmdb'`))[0]!.c
    record(10, 'todos os 8 endpoints distintos capturados sob provider_api=tmdb', distinctEndpoints === TAXONOMY_ENDPOINTS.length, `distintos=${distinctEndpoints}`)
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    await prisma.$disconnect()
    if (started) { try { await pg.stop() } catch { /* best-effort */ } }
    await safeRm(dataDir)
    console.log('\n=== TMDB catalog integration: Postgres efemero derrubado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO (TMDB catalog): ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Sync de taxonomia/config TMDB integro em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
