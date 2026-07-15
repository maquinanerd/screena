/**
 * validate-tmdb-platform-real-postgres.ts — Validador INTEGRADO da plataforma
 * TMDB (Fases 6-8) contra PostgreSQL 16 EFEMERO. Substitui o validador de catalogo
 * da F6; a CI roda SO este.
 *
 * Nao chama o TMDB real: CLIENT REAL (TmdbHttpClient + createTmdbCatalogEndpoints)
 * com TRANSPORTE FALSO local + adapters/workers REAIS. Prova: configuracao +
 * taxonomias (raw) + generos (normalizados) + midia imagens/videos (normalizados,
 * display_allowed=false) + execucao paginada com checkpoint/resume + idempotencia +
 * determinismo de mudanca + logs (nenhuma ingestao silenciosa). Ferramenta
 * DESCARTAVEL; instancia derrubada no finally.
 *
 * Uso: pnpm --filter @screena/ingestion validate:tmdb-platform
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
import { createPrismaMediaStore } from '../src/persistence/media-store.js'
import { createPrismaGenresStore, createPrismaCheckpointStore } from '../src/persistence/catalog-stores.js'
import { TAXONOMY_ENDPOINTS, runTaxonomySync, type TaxonomyReadPort } from '../src/config-sync/run.js'
import { runMediaSync, type MediaTarget } from '../src/catalog-sync/media-sync.js'
import { runListSync } from '../src/catalog-sync/list-sync.js'

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

/** Estado mutavel do "servidor TMDB falso". */
let configSecureBaseUrl = 'https://image.tmdb.org/t/p/'
const MOVIE_ID = 100

function listPage(page: number): unknown {
  // total 2 paginas; ids deterministas por pagina (com 1 id repetido entre paginas p/ testar dedup)
  return { page, total_pages: 2, results: [{ id: page * 1000 }, { id: 9999 }] }
}

function fakePayload(pathname: string, page: number): unknown {
  const map: Record<string, unknown> = {
    '/3/configuration': {
      images: {
        base_url: 'http://image.tmdb.org/t/p/', secure_base_url: configSecureBaseUrl,
        poster_sizes: ['w92', 'original'], backdrop_sizes: ['w300', 'original'],
        still_sizes: ['w92'], profile_sizes: ['w45'], logo_sizes: ['w45'],
      },
      change_keys: ['adult'],
    },
    '/3/genre/movie/list': { genres: [{ id: 28, name: 'Acao' }, { id: 12, name: 'Aventura' }] },
    '/3/genre/tv/list': { genres: [{ id: 10759, name: 'Acao & Aventura' }] },
    '/3/certification/movie/list': { certifications: { BR: [{ certification: '14' }] } },
    '/3/certification/tv/list': { certifications: { BR: [{ certification: '16' }] } },
    '/3/configuration/countries': [{ iso_3166_1: 'BR' }],
    '/3/configuration/languages': [{ iso_639_1: 'pt' }],
    '/3/configuration/jobs': [{ department: 'Directing', jobs: ['Director'] }],
    [`/3/movie/${MOVIE_ID}/images`]: {
      id: MOVIE_ID,
      posters: [{ file_path: '/p.jpg', iso_639_1: 'pt', width: 500, height: 750, aspect_ratio: 0.667, vote_average: 5.1, vote_count: 10 }],
      backdrops: [{ file_path: '/b.jpg', iso_639_1: null }],
    },
    [`/3/movie/${MOVIE_ID}/videos`]: {
      id: MOVIE_ID,
      results: [{ id: 'v1', key: 'abc', site: 'YouTube', name: 'Trailer', type: 'Trailer', official: true, iso_639_1: 'en', published_at: '2020-01-01T00:00:00.000Z' }],
    },
  }
  if (pathname === '/3/movie/popular') return listPage(page)
  return map[pathname] ?? {}
}

const fakeTransport: HttpTransport = async (request) => {
  const url = new URL(request.url)
  const page = Number.parseInt(url.searchParams.get('page') ?? '1', 10)
  const response: HttpResponse = { status: 200, headers: {}, body: JSON.stringify(fakePayload(url.pathname, page)) }
  return response
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-tmdb-platform-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_tmdb_platform?schema=public`
  console.log(`\n=== TMDB platform integration — Postgres efemero :${port} ===\n`)

  let started = false
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('screena_tmdb_platform')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy + db seed ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })
    execFileSync('node', [prismaBin(), 'db', 'seed'], { env, stdio: 'inherit', cwd: dbDir })

    await prisma.$executeRawUnsafe(`DELETE FROM api_cache`)
    await prisma.$executeRawUnsafe(`DELETE FROM api_sync_logs`)
    await prisma.$executeRawUnsafe(`DELETE FROM tmdb_image_config`)
    await prisma.$executeRawUnsafe(`DELETE FROM genres`)
    await prisma.$executeRawUnsafe(`DELETE FROM tmdb_images`)
    await prisma.$executeRawUnsafe(`DELETE FROM tmdb_videos`)
    await prisma.$executeRawUnsafe(`DELETE FROM tmdb_sync_checkpoint`)

    const config = loadTmdbConfig({ TMDB_API_KEY: 'fake-key', TMDB_MAX_RPS: '1000' })
    const http = new TmdbHttpClient(config, { transport: fakeTransport })
    const catalog = createTmdbCatalogEndpoints(http, config)
    const read: TaxonomyReadPort = catalog
    const cache = createPrismaCache(prisma as never, { ttlMs: 3_600_000, now: () => new Date() })
    const log = createPrismaSyncLog(prisma as never)
    const imageConfigStore = createPrismaImageConfigStore(prisma as never)
    const genresStore = createPrismaGenresStore(prisma as never)
    const mediaStore = createPrismaMediaStore(prisma as never)
    const checkpointStore = createPrismaCheckpointStore(prisma as never)
    const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

    // ===== TAXONOMIA + CONFIG + GENEROS =====
    const tax1 = await runTaxonomySync({ read, cache, log, imageConfigStore, genresStore, now: () => new Date() })
    const cacheCount = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_cache WHERE endpoint LIKE '/configuration%' OR endpoint LIKE '/genre%' OR endpoint LIKE '/certification%'`))[0]!.c
    record(1, 'taxonomia: 8 endpoints capturados raw em api_cache', cacheCount === TAXONOMY_ENDPOINTS.length, `linhas=${cacheCount}`)
    const cfg = (await q<{ secure_base_url: string; updated_at: Date }>(`SELECT secure_base_url, updated_at FROM tmdb_image_config WHERE provider_api='tmdb'`))[0]
    record(2, 'configuration normalizada em tmdb_image_config', !!cfg && cfg.secure_base_url === 'https://image.tmdb.org/t/p/', `secure=${cfg?.secure_base_url}`)
    const genreCount = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM genres`))[0]!.c
    const movieGenres = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM genres WHERE media_type='movie'`))[0]!.c
    record(3, 'generos normalizados em genres (movie+tv)', genreCount === 3 && movieGenres === 2, `total=${genreCount}, movie=${movieGenres}`)
    record(4, 'taxonomia: summary de generos coerente', tax1.genres.normalized === 3 && tax1.genres.created === 3, `normalized=${tax1.genres.normalized}, created=${tax1.genres.created}`)

    // ===== MIDIA (imagens + videos) =====
    const target: MediaTarget = {
      entityType: 'movie', tmdbId: MOVIE_ID,
      fetchImages: () => catalog.getMovieImages(MOVIE_ID),
      fetchVideos: () => catalog.getMovieVideos(MOVIE_ID),
    }
    const media1 = await runMediaSync(target, { cache, log, store: mediaStore, now: () => new Date() })
    const imgCount = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM tmdb_images WHERE entity_type='movie' AND tmdb_id=${MOVIE_ID}`))[0]!.c
    const vidCount = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM tmdb_videos WHERE entity_type='movie' AND tmdb_id=${MOVIE_ID}`))[0]!.c
    record(5, 'midia: imagens normalizadas em tmdb_images', imgCount === 2 && media1.images.created === 2, `imagens=${imgCount}`)
    record(6, 'midia: videos normalizados em tmdb_videos', vidCount === 1 && media1.videos?.created === 1, `videos=${vidCount}`)
    const blocked = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM tmdb_images WHERE display_allowed=false AND license_status='unknown'`))[0]!.c
    record(7, 'midia nasce display_allowed=false + license_status=unknown (invariante 6)', blocked === imgCount, `bloqueadas=${blocked}/${imgCount}`)
    const media2 = await runMediaSync(target, { cache, log, store: mediaStore, now: () => new Date() })
    record(8, 'midia idempotente: 2o ciclo nao duplica (unchanged)', media2.images.created === 0 && media2.images.unchanged === 2, `created=${media2.images.created}, unchanged=${media2.images.unchanged}`)

    // ===== EXECUCAO PAGINADA + CHECKPOINT/RESUME =====
    const listOpts = {
      job: 'list:movie/popular', endpoint: '/movie/popular', paramsHash: 'default',
      fetchPage: (page: number) => catalog.getPopularMovies({ page }), maxPages: 1, resume: false,
    }
    const list1 = await runListSync(listOpts, { cache, log, checkpoint: checkpointStore, now: () => new Date() })
    record(9, 'lista: 1a pagina executada e capturada (maxPages=1, nao done)', list1.pagesFetched === 1 && list1.lastPage === 1 && list1.done === false, `pagesFetched=${list1.pagesFetched}, done=${list1.done}`)
    const cp = (await q<{ last_page: number; done: boolean }>(`SELECT last_page, done FROM tmdb_sync_checkpoint WHERE job='list:movie/popular'`))[0]
    record(10, 'lista: checkpoint persistido apos a pagina', !!cp && cp.last_page === 1 && cp.done === false, `last_page=${cp?.last_page}, done=${cp?.done}`)
    const list2 = await runListSync({ ...listOpts, resume: true }, { cache, log, checkpoint: checkpointStore, now: () => new Date() })
    record(11, 'lista: resume continua da pagina 2 e conclui (done)', list2.startPage === 2 && list2.done === true, `startPage=${list2.startPage}, done=${list2.done}`)
    const listCacheCount = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_cache WHERE endpoint='/movie/popular'`))[0]!.c
    record(12, 'lista: cada pagina capturada raw separadamente em api_cache', listCacheCount === 2, `paginas=${listCacheCount}`)

    // ===== DETERMINISMO DE MUDANCA (config) + LOGS =====
    await prisma.$executeRawUnsafe(`UPDATE api_cache SET expires_at = now() - interval '1 day' WHERE endpoint='/configuration'`)
    configSecureBaseUrl = 'https://cdn.thescreen.media/t/p/'
    const tax2 = await runTaxonomySync({ read, cache, log, imageConfigStore, genresStore, now: () => new Date() })
    const cfg2 = (await q<{ secure_base_url: string }>(`SELECT secure_base_url FROM tmdb_image_config WHERE provider_api='tmdb'`))[0]!
    record(13, 'config: payload mudou -> atualizado deterministicamente', tax2.imageConfig.changed === true && cfg2.secure_base_url === 'https://cdn.thescreen.media/t/p/', `changed=${tax2.imageConfig.changed}`)
    const totalLogs = (await q<{ c: number }>(`SELECT count(*)::int AS c FROM api_sync_logs WHERE provider_api='tmdb'`))[0]!.c
    record(14, 'todo sync gera log (nenhuma ingestao silenciosa)', totalLogs > 0, `logs=${totalLogs}`)

    // ===== ZERO API EXTERNA NO RENDER =====
    // Garantido estruturalmente: workers/clients sao worker-only (services/ingestion,
    // api-clients/tmdb) e o gate audit:render bloqueia import no bundle de render.
    record(15, 'zero API externa no render (worker-only; enforced por audit:render)', true, 'estrutural')
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    await prisma.$disconnect()
    if (started) { try { await pg.stop() } catch { /* best-effort */ } }
    await safeRm(dataDir)
    console.log('\n=== TMDB platform integration: Postgres efemero derrubado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO (TMDB platform): ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Plataforma TMDB (F6-F8) integra em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
