/**
 * sync-tmdb.ts — CLI OPERACIONAL UNIFICADA da plataforma TMDB (Fases 6-8).
 * Worker-only; EXCLUIDO do typecheck (toca Prisma). Consolida os syncs num unico
 * comando com subcomandos, em vez de scripts soltos.
 *
 * Subcomandos:
 *   configuration | taxonomies | genres | media | lists | discover | trending
 *
 * Args: --id --series-id --season --episode --language --region --page --limit
 *       --max-pages --concurrency --dry-run --apply --resume --checkpoint --from --to
 *
 * Fail-closed: dry-run por padrao; --apply exige token TMDB (env) + DATABASE_URL e
 * aborta em producao. O antigo `sync-tmdb-config` segue como wrapper compativel.
 *
 * Uso:
 *   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts taxonomies --apply
 *   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts media --id 27205 --apply
 *   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb.ts lists --max-pages 3 --resume --apply
 */

import process from 'node:process'
import { PrismaClient } from '@prisma/client'
import { createTmdbClient, createTmdbCatalogEndpoints } from '@screena/tmdb-client'

import { createPrismaCache } from '../src/persistence/cache.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { createPrismaImageConfigStore } from '../src/persistence/image-config-store.js'
import { createPrismaMediaStore } from '../src/persistence/media-store.js'
import { createPrismaGenresStore, createPrismaCheckpointStore } from '../src/persistence/catalog-stores.js'
import { runTaxonomySync, type TaxonomyReadPort } from '../src/config-sync/run.js'
import { runMediaSync, type MediaTarget } from '../src/catalog-sync/media-sync.js'
import { runListSync } from '../src/catalog-sync/list-sync.js'

const SUBCOMMANDS = ['configuration', 'taxonomies', 'genres', 'media', 'lists', 'discover', 'trending'] as const
type Sub = (typeof SUBCOMMANDS)[number]

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}
function intArg(name: string, fallback: number): number {
  const raw = arg(name)
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function isProductionLike(): boolean {
  const env = `${process.env.NODE_ENV ?? ''} ${process.env.VERCEL_ENV ?? ''}`.toLowerCase()
  return env.includes('production')
}

async function main(): Promise<void> {
  const sub = process.argv[2] as Sub | undefined
  if (!sub || !SUBCOMMANDS.includes(sub)) {
    console.log(`Uso: sync-tmdb <${SUBCOMMANDS.join('|')}> [--apply] [args]`)
    process.exit(sub ? 1 : 0)
  }

  const apply = flag('apply')
  if (!apply) {
    console.log(`[dry-run] sync-tmdb ${sub}: nenhuma chamada externa/escrita. Use --apply para aplicar.`)
    return
  }
  if (isProductionLike()) {
    console.error('ABORTADO: --apply proibido em producao (NODE_ENV/VERCEL_ENV).')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('ABORTADO: DATABASE_URL ausente.')
    process.exit(1)
  }

  const client = createTmdbClient() // lanca se nao houver token TMDB
  const catalog = createTmdbCatalogEndpoints(client.http, client.config)
  const prisma = new PrismaClient()
  const now = () => new Date()
  const cache = createPrismaCache(prisma, { ttlMs: client.config.cacheTtlMs, now })
  const log = createPrismaSyncLog(prisma)
  const language = arg('language') ?? client.config.defaultLanguage
  const region = arg('region')
  const page = intArg('page', 1)
  const maxPages = intArg('max-pages', 5)
  const resume = flag('resume')

  try {
    if (sub === 'configuration' || sub === 'taxonomies' || sub === 'genres') {
      const summary = await runTaxonomySync({
        read: catalog as TaxonomyReadPort,
        cache,
        log,
        imageConfigStore: createPrismaImageConfigStore(prisma),
        genresStore: sub === 'configuration' ? undefined : createPrismaGenresStore(prisma),
        now,
      })
      console.log(JSON.stringify({ sub, imageConfig: summary.imageConfig, genres: summary.genres }, null, 2))
    } else if (sub === 'media') {
      const id = intArg('id', 0)
      if (id === 0) throw new Error('media exige --id <tmdbId>')
      const target: MediaTarget = {
        entityType: 'movie',
        tmdbId: id,
        fetchImages: () => catalog.getMovieImages(id),
        fetchVideos: () => catalog.getMovieVideos(id),
      }
      const r = await runMediaSync(target, { cache, log, store: createPrismaMediaStore(prisma), now })
      console.log(JSON.stringify({ sub, result: r }, null, 2))
    } else {
      // lists | discover | trending: execucao paginada via list-sync.
      const checkpoint = createPrismaCheckpointStore(prisma)
      const jobs = resolvePagedJobs(sub, catalog, { language, region, page })
      for (const job of jobs) {
        const r = await runListSync({ ...job, maxPages, resume }, { cache, log, checkpoint, now })
        console.log(`  ${r.job}: pages=${r.pagesFetched} last=${r.lastPage}/${r.totalPages ?? '?'} done=${r.done} ids=${r.uniqueIds}`)
      }
    }
    console.log('OK.')
  } finally {
    await prisma.$disconnect()
  }
}

interface PagedJob {
  job: string
  endpoint: string
  paramsHash: string
  fetchPage: (page: number) => Promise<unknown>
}

function resolvePagedJobs(
  sub: 'lists' | 'discover' | 'trending',
  catalog: ReturnType<typeof createTmdbCatalogEndpoints>,
  ctx: { language: string; region: string | undefined; page: number },
): PagedJob[] {
  const p = (page: number) => ({ page, language: ctx.language, region: ctx.region })
  if (sub === 'lists') {
    return [
      { job: 'list:movie/popular', endpoint: '/movie/popular', paramsHash: 'default', fetchPage: (n) => catalog.getPopularMovies(p(n)) },
      { job: 'list:movie/top_rated', endpoint: '/movie/top_rated', paramsHash: 'default', fetchPage: (n) => catalog.getTopRatedMovies(p(n)) },
      { job: 'list:movie/now_playing', endpoint: '/movie/now_playing', paramsHash: 'default', fetchPage: (n) => catalog.getNowPlayingMovies(p(n)) },
      { job: 'list:tv/popular', endpoint: '/tv/popular', paramsHash: 'default', fetchPage: (n) => catalog.getPopularTvShows(p(n)) },
      { job: 'list:tv/top_rated', endpoint: '/tv/top_rated', paramsHash: 'default', fetchPage: (n) => catalog.getTopRatedTvShows(p(n)) },
      { job: 'list:tv/airing_today', endpoint: '/tv/airing_today', paramsHash: 'default', fetchPage: (n) => catalog.getAiringTodayTvShows(p(n)) },
      { job: 'list:tv/on_the_air', endpoint: '/tv/on_the_air', paramsHash: 'default', fetchPage: (n) => catalog.getOnTheAirTvShows(p(n)) },
    ]
  }
  if (sub === 'discover') {
    return [
      { job: 'discover:movie', endpoint: '/discover/movie', paramsHash: 'default', fetchPage: (n) => catalog.discoverMovies({ page: n, language: ctx.language }) },
      { job: 'discover:tv', endpoint: '/discover/tv', paramsHash: 'default', fetchPage: (n) => catalog.discoverTvShows({ page: n, language: ctx.language }) },
    ]
  }
  return [
    { job: 'trending:movie/week', endpoint: '/trending/movie/week', paramsHash: 'default', fetchPage: (n) => catalog.getTrending('movie', 'week', { page: n, language: ctx.language }) },
    { job: 'trending:tv/week', endpoint: '/trending/tv/week', paramsHash: 'default', fetchPage: (n) => catalog.getTrending('tv', 'week', { page: n, language: ctx.language }) },
  ]
}

main().catch((err) => {
  console.error('Erro fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
