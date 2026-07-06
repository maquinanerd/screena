#!/usr/bin/env node
/**
 * bin/ingest-public-catalog.ts — Backfill CONTROLADO do catálogo público real
 * (Camada 1: TMDB só). Worker-only/offline — NUNCA no render.
 *
 * Fica em services/ingestion/bin (como bin/import.ts): EXCLUÍDO do typecheck e
 * do bundle de render. É a "Admin Area / ingestão" do page-map. Reusa o pipeline
 * de ingestão (createIngestionContext + importMovie/importTvShow → persiste
 * movie/tv/season/episode/people/cast/crew/entity_external_ids + api_cache +
 * api_sync_logs, com retry/backoff/breaker) e ADICIONA o que a home precisa e o
 * importer não cria: slug canônico pt-BR, tradução pt-BR (title+summary) e
 * download LOCAL das imagens (poster/backdrop) para apps/web/public/media/tmdb/.
 *
 * Governança:
 *  - Zero API externa no render — este script roda offline; a home lê só Postgres.
 *  - Token TMDB só no .env da raiz; NUNCA logado; NUNCA em NEXT_PUBLIC_*.
 *  - Imagens locais (/media/tmdb/...); nada de image.tmdb.org no render.
 *  - Idempotente: upsert por tmdbId/slug/translation; imagem pula se já existe.
 *  - Fail-closed: aborta em produção; exige token + DATABASE_URL; --apply p/ escrever.
 *
 * Uso (a partir da raiz, com TMDB_READ_ACCESS_TOKEN no .env). Resolva o cli do
 * tsx e rode com --apply (dry-run sem a flag). Ver o resumo do agente para o
 * comando exato de resolucao do caminho do tsx.
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/ingest-public-catalog.ts --apply
 *   # flags: --apply (escreve) · --refresh-images (rebaixa imagens já existentes)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIngestionContext, importMovie, importTvShow } from '../src/composition.js'
import { getPrismaClient } from '@screena/db/server'

const LANGUAGE = 'pt-BR'
const IMAGE_CDN = 'https://image.tmdb.org/t/p'
const POSTER_SIZE = 'w500'
const BACKDROP_SIZE = 'w1280'
const APPEND = 'external_ids,credits'

/**
 * Lista CURADA de títulos reais (~10 filmes + ~10 séries) por TMDB id. São
 * defaults editáveis; ids inválidos apenas falham/pulam (logados), sem quebrar.
 */
const MOVIE_IDS = [27205, 157336, 155, 872585, 693134, 346698, 496243, 634649, 414906, 335984]
const TV_IDS = [1399, 1396, 66732, 100088, 119051, 94997, 60625, 1402, 82856, 71912]

/** Subconjunto do detalhe TMDB que este backfill lê (bin não é typechecked). */
interface TmdbDetailLite {
  readonly id: number
  readonly title?: string
  readonly name?: string
  readonly original_title?: string
  readonly original_name?: string
  readonly overview?: string | null
  readonly poster_path?: string | null
  readonly backdrop_path?: string | null
  readonly release_date?: string | null
  readonly first_air_date?: string | null
}

function repoRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/ingestion/bin
  return path.resolve(dir, '..', '..', '..')
}

/** Carrega o .env da raiz (best-effort), como os demais scripts. */
function loadRepoEnv(): void {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

/** slug SEO-friendly a partir de um texto (sem acento, minúsculo, hifenizado). */
function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function yearOf(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const y = Number(String(dateStr).slice(0, 4))
  return Number.isInteger(y) && y > 0 ? y : null
}

/**
 * Baixa uma imagem do TMDB para apps/web/public/<publicRel> e devolve o caminho
 * público local (/media/tmdb/...) ou null em qualquer falha (→ card cai no
 * fallback). Idempotente: pula se o arquivo já existe (salvo `refresh`).
 */
async function downloadImage(
  remotePath: string | null | undefined,
  size: string,
  publicRel: string,
  refresh: boolean,
): Promise<string | null> {
  if (!remotePath) return null
  const absFile = path.join(repoRoot(), 'apps', 'web', 'public', publicRel)
  const localUrlPath = `/${publicRel.replace(/\\/g, '/')}`
  try {
    if (existsSync(absFile) && !refresh) return localUrlPath
    const res = await fetch(`${IMAGE_CDN}/${size}${remotePath}`)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    mkdirSync(path.dirname(absFile), { recursive: true })
    writeFileSync(absFile, buf)
    return localUrlPath
  } catch {
    return null
  }
}

/**
 * Finaliza UMA entidade já persistida pelo importer: cria slug pt-BR + tradução
 * pt-BR (title+summary) e baixa poster/backdrop para caminho local, reescrevendo
 * posterPath/backdropPath. Idempotente.
 */
async function finalize(
  prisma: ReturnType<typeof getPrismaClient>,
  entityType: 'movie' | 'tv',
  detail: TmdbDetailLite,
  refresh: boolean,
): Promise<void> {
  const isMovie = entityType === 'movie'
  const title =
    (isMovie ? detail.title : detail.name) ??
    (isMovie ? detail.original_title : detail.original_name) ??
    ''
  const overview = detail.overview ?? null
  const year = yearOf(isMovie ? detail.release_date : detail.first_air_date)

  const model = isMovie ? prisma.movie : prisma.tvShow
  const entity = await model.findUnique({ where: { tmdbId: detail.id }, select: { id: true } })
  if (entity === null) return

  const slugBase = slugify(title) || `tmdb-${detail.id}`
  const slug = year !== null ? `${slugBase}-${year}` : slugBase

  await prisma.slug.upsert({
    where: { entityType_languageCode_slug: { entityType, languageCode: LANGUAGE, slug } },
    update: { entityId: entity.id, isCanonical: true },
    create: { entityType, entityId: entity.id, languageCode: LANGUAGE, slug, isCanonical: true },
  })

  await prisma.entityTranslation.upsert({
    where: {
      entityType_entityId_languageCode: {
        entityType,
        entityId: entity.id,
        languageCode: LANGUAGE,
      },
    },
    update: { title, summary: overview },
    create: { entityType, entityId: entity.id, languageCode: LANGUAGE, title, summary: overview },
  })

  const poster = await downloadImage(
    detail.poster_path,
    POSTER_SIZE,
    `media/tmdb/${entityType}/${slug}-poster.jpg`,
    refresh,
  )
  const backdrop = await downloadImage(
    detail.backdrop_path,
    BACKDROP_SIZE,
    `media/tmdb/${entityType}/${slug}-backdrop.jpg`,
    refresh,
  )
  await model.update({ where: { id: entity.id }, data: { posterPath: poster, backdropPath: backdrop } })
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const refresh = argv.includes('--refresh-images')
  loadRepoEnv()

  const hasToken = Boolean(
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim(),
  )
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

  console.log('== Screen · Ingestão de catálogo público (TMDB — Camada 1) ==')
  console.log(`Alvo: ${MOVIE_IDS.length} filmes + ${TV_IDS.length} séries (curados, editáveis).`)

  if (isProd) {
    console.error('Abortado: produção real detectada — backfill só em local/staging.')
    process.exitCode = 1
    return
  }
  if (!hasDb) {
    console.error('Abortado: DATABASE_URL ausente no ambiente.')
    process.exitCode = 1
    return
  }
  if (!hasToken) {
    console.error(
      'Abortado: defina TMDB_READ_ACCESS_TOKEN (v4) — ou TMDB_API_KEY (v3) — no .env da raiz. Nunca commite o token.',
    )
    process.exitCode = 1
    return
  }
  if (!apply) {
    console.log('Dry-run: NADA foi escrito. Use --apply para ingerir (idempotente).')
    console.log(`  filmes: ${MOVIE_IDS.join(', ')}`)
    console.log(`  series: ${TV_IDS.join(', ')}`)
    return
  }

  const { context: ctx, disconnect } = createIngestionContext()
  const prisma = getPrismaClient()
  let ok = 0
  let failed = 0
  try {
    for (const id of MOVIE_IDS) {
      const res = await importMovie(ctx, id)
      if (res.status !== 'success') {
        failed += 1
        console.warn(`  filme ${id}: ${res.status}${res.error ? ` — ${res.error}` : ''}`)
        continue
      }
      const cached = await ctx.cache.getOrFetch({
        endpoint: `/movie/${id}`,
        params: { append_to_response: APPEND },
        fetcher: () => ctx.tmdb.getMovie(id),
      })
      await finalize(prisma, 'movie', cached.data as TmdbDetailLite, refresh)
      ok += 1
      console.log(`  filme ${id}: OK`)
    }
    for (const id of TV_IDS) {
      const res = await importTvShow(ctx, id)
      if (res.status !== 'success') {
        failed += 1
        console.warn(`  serie ${id}: ${res.status}${res.error ? ` — ${res.error}` : ''}`)
        continue
      }
      const cached = await ctx.cache.getOrFetch({
        endpoint: `/tv/${id}`,
        params: { append_to_response: APPEND },
        fetcher: () => ctx.tmdb.getTvShow(id),
      })
      await finalize(prisma, 'tv', cached.data as TmdbDetailLite, refresh)
      ok += 1
      console.log(`  serie ${id}: OK`)
    }
    console.log(`Ingestão concluída (idempotente): ${ok} OK, ${failed} falha(s).`)
    console.log('Imagens locais em apps/web/public/media/tmdb/ (gitignored — regeradas por este script).')
  } finally {
    await disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Falha na ingestão de catálogo público:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
