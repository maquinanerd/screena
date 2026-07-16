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
 * importer não cria: slug canônico pt-BR, tradução pt-BR (title+summary) e o
 * `file_path` de imagem (poster/backdrop).
 *
 * Imagens (decisão de arquitetura: NÃO salvar imagem no servidor):
 *  - PADRÃO: grava posterPath/backdropPath com o `file_path` CRU do TMDB
 *    (ex.: `/abc.jpg`). O frontend monta a URL pública remota do CDN de imagens.
 *    Nada é baixado; nenhum arquivo salvo; sem `/media/tmdb`; sem disco/volume.
 *  - `--download-images` (LEGADO/opt-in): baixa poster/backdrop para
 *    apps/web/public/media/tmdb/ e grava o path local `/media/tmdb/...`.
 *
 * Governança:
 *  - Zero API externa no render — este script roda offline; a home lê só Postgres.
 *  - Token TMDB só no .env da raiz; NUNCA logado; NUNCA em NEXT_PUBLIC_*.
 *  - O host do CDN vem SÓ do helper canônico de @screena/public-contracts.
 *  - Idempotente: upsert por tmdbId/slug/translation.
 *  - Fail-closed: aborta em produção; exige token + DATABASE_URL; --apply p/ escrever.
 *
 * Uso (a partir da raiz, com TMDB_READ_ACCESS_TOKEN no .env). Resolva o cli do
 * tsx e rode com --apply (dry-run sem a flag). Ver o resumo do agente para o
 * comando exato de resolucao do caminho do tsx.
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/ingest-public-catalog.ts --apply
 *   # flags:
 *   #   --apply             escreve (sem a flag = dry-run, nada gravado)
 *   #   --include-upcoming  descobre filmes em estreia (TMDB /movie/upcoming) e os
 *   #                       ingere junto do catálogo curado, alimentando "Em breve"
 *   #   --download-images   LEGADO/opt-in: baixa imagens p/ /media/tmdb (default = NÃO
 *   #                       baixa; grava file_path cru p/ URL remota no frontend)
 *   #   --refresh-images    só com --download-images: rebaixa imagens já existentes
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createIngestionContext, importMovie, importTvShow } from '../src/composition.js'
import { resolveCatalogImagePath } from '../src/public-catalog-image.js'
import { planCreditedPeople } from '../src/public-catalog-people.js'
import { desiredCatalogSlug } from '../src/public-catalog-slug.js'
import { upsertCanonicalSlug } from '../src/persistence/catalog-finalize.js'
import { getPrismaClient } from '@screena/db/server'
import { buildTmdbImageUrl, type TmdbImageSize } from '@screena/public-contracts'

const LANGUAGE = 'pt-BR'
const POSTER_SIZE: TmdbImageSize = 'w500'
const BACKDROP_SIZE: TmdbImageSize = 'w1280'
const APPEND = 'external_ids,credits'

/**
 * Lista CURADA de títulos reais (~10 filmes + ~10 séries) por TMDB id. São
 * defaults editáveis; ids inválidos apenas falham/pulam (logados), sem quebrar.
 */
const MOVIE_IDS = [27205, 157336, 155, 872585, 693134, 346698, 496243, 634649, 414906, 335984]
const TV_IDS = [1399, 1396, 66732, 100088, 119051, 94997, 60625, 1402, 82856, 71912]

/**
 * Descoberta de "Em breve": lê poucas páginas de /movie/upcoming (região BR) e
 * limita o total ingerido — a home só mostra 6, então não precisa varrer tudo.
 * Offline/read-only; os IDs entram no mesmo fluxo de importMovie + finalize.
 */
const UPCOMING_PAGES = 1
const UPCOMING_IMPORT_CAP = 20
const UPCOMING_REGION = 'BR'

/** Subconjunto do detalhe TMDB que este backfill lê (bin não é typechecked). */
interface TmdbCreditLite {
  readonly id?: number
  readonly name?: string | null
}
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
  /** Vem do append_to_response=credits; alimenta os slugs de pessoa. */
  readonly credits?: { readonly cast?: TmdbCreditLite[]; readonly crew?: TmdbCreditLite[] }
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

/**
 * Baixa uma imagem do TMDB para apps/web/public/<publicRel> e devolve o caminho
 * público local (/media/tmdb/...) ou null em qualquer falha (→ card cai no
 * fallback). Idempotente: pula se o arquivo já existe (salvo `refresh`).
 */
async function downloadImage(
  remotePath: string | null | undefined,
  size: TmdbImageSize,
  publicRel: string,
  refresh: boolean,
): Promise<string | null> {
  if (!remotePath) return null
  const absFile = path.join(repoRoot(), 'apps', 'web', 'public', publicRel)
  const localUrlPath = `/${publicRel.replace(/\\/g, '/')}`
  try {
    if (existsSync(absFile) && !refresh) return localUrlPath
    // URL montada pelo helper CANONICO (fonte unica do host do CDN). Este fetch
    // e o modo LEGADO --download-images de um worker offline — nunca render.
    const remoteUrl = buildTmdbImageUrl(remotePath, size)
    if (remoteUrl === null) return null
    const res = await fetch(remoteUrl)
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
 * pt-BR (title+summary) e resolve posterPath/backdropPath. Idempotente.
 *
 * PADRÃO (`downloadImages=false`): NÃO baixa imagem — grava o `file_path` CRU do
 * TMDB (ex.: `/abc.jpg`); o frontend monta a URL remota. Servidor não salva imagem.
 * `--download-images` (legado): baixa poster/backdrop para caminho local e grava
 * `/media/tmdb/...`. A decisão de qual string persistir é do helper puro
 * `resolveCatalogImagePath`.
 */
async function finalize(
  prisma: ReturnType<typeof getPrismaClient>,
  entityType: 'movie' | 'tv',
  detail: TmdbDetailLite,
  refresh: boolean,
  downloadImages: boolean,
): Promise<void> {
  const isMovie = entityType === 'movie'
  const title =
    (isMovie ? detail.title : detail.name) ??
    (isMovie ? detail.original_title : detail.original_name) ??
    ''
  const overview = detail.overview ?? null

  const model = isMovie ? prisma.movie : prisma.tvShow
  const entity = await model.findUnique({ where: { tmdbId: detail.id }, select: { id: true } })
  if (entity === null) return

  // Slug canonico sem ano de lancamento (o ano vive na ficha, nunca na URL).
  const desiredSlug = desiredCatalogSlug(title, detail.id)
  const slug = await upsertCanonicalSlug(prisma, entityType, entity.id, desiredSlug, detail.id, LANGUAGE)

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

  // Só baixa arquivo quando --download-images (legado). Default: nada de disco.
  const posterLocal = downloadImages
    ? await downloadImage(detail.poster_path, POSTER_SIZE, `media/tmdb/${entityType}/${slug}-poster.jpg`, refresh)
    : null
  const backdropLocal = downloadImages
    ? await downloadImage(detail.backdrop_path, BACKDROP_SIZE, `media/tmdb/${entityType}/${slug}-backdrop.jpg`, refresh)
    : null

  const posterPath = resolveCatalogImagePath({
    rawPath: detail.poster_path,
    downloadedLocalPath: posterLocal,
    downloadImages,
  })
  const backdropPath = resolveCatalogImagePath({
    rawPath: detail.backdrop_path,
    downloadedLocalPath: backdropLocal,
    downloadImages,
  })
  await model.update({ where: { id: entity.id }, data: { posterPath, backdropPath } })

  // Fecha o loop de pessoa: cada creditado ganha slug canônico + tradução pt-BR.
  await finalizeCreditedPeople(prisma, detail.credits)
}

/**
 * Cria slug canônico pt-BR + tradução (title) para CADA pessoa creditada do
 * título, a partir de `detail.credits`. As pessoas já foram persistidas pelo
 * importer (importMovie/importTvShow) via os créditos; aqui só garantimos que
 * NENHUM `cast_member`/`crew_member` fique sem slug de pessoa — sem isso
 * `/pt/pessoas/{slug}` e os links de elenco morrem (P0-10). Idempotente.
 *
 * O QUE existe (nome/id) vem do payload controlado do TMDB; nada é inventado.
 * O plano puro (`planCreditedPeople`) decide os slugs base; o upsert compartilha
 * a mesma lógica de idempotência + colisão + 301 dos títulos.
 */
async function finalizeCreditedPeople(
  prisma: ReturnType<typeof getPrismaClient>,
  credits: TmdbDetailLite['credits'],
): Promise<void> {
  const plans = planCreditedPeople(credits)
  if (plans.length === 0) return

  const planByTmdb = new Map(plans.map((plan) => [plan.tmdbId, plan]))
  const people = await prisma.person.findMany({
    where: { tmdbId: { in: [...planByTmdb.keys()] } },
    select: { id: true, tmdbId: true, name: true },
  })

  for (const person of people) {
    const plan = planByTmdb.get(person.tmdbId)
    if (plan === undefined) continue

    await upsertCanonicalSlug(prisma, 'person', person.id, plan.baseSlug, person.tmdbId, LANGUAGE)

    const title = plan.name !== '' ? plan.name : person.name
    await prisma.entityTranslation.upsert({
      where: {
        entityType_entityId_languageCode: {
          entityType: 'person',
          entityId: person.id,
          languageCode: LANGUAGE,
        },
      },
      update: { title },
      create: { entityType: 'person', entityId: person.id, languageCode: LANGUAGE, title },
    })
  }
}

/** Dedup estavel de ids numericos preservando a ordem de primeira aparicao. */
function dedupeNumbers(nums: readonly number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const n of nums) {
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/**
 * Descobre ids de filmes em estreia via TMDB /movie/upcoming, roteando pelo MESMO
 * caminho de ingestao: resposta crua em `api_cache` (ctx.cache.getOrFetch) e 1 log
 * em `api_sync_logs` (regra "todo sync externo gera log" — sem excecao). Nao
 * escreve entidades (a enumeracao so coleta ids; os detalhes vem depois por
 * importMovie). Degrada gracioso em falha de rede (loga `failed`, segue so com o
 * catalogo curado). Cap por UPCOMING_IMPORT_CAP. Chamado SO no --apply (o dry-run
 * nao dispara sync externo).
 */
async function discoverUpcomingMovieIds(
  ctx: ReturnType<typeof createIngestionContext>['context'],
): Promise<number[]> {
  const ids: number[] = []
  const seen = new Set<number>()
  const startedAt = Date.now()
  let quotaCost = 0
  let payloadHash: string | null = null
  let failure: string | null = null

  try {
    for (let page = 1; page <= UPCOMING_PAGES; page += 1) {
      const cached = await ctx.cache.getOrFetch({
        endpoint: '/movie/upcoming',
        params: { region: UPCOMING_REGION, page },
        fetcher: () => ctx.tmdb.getUpcomingMovies({ page }),
      })
      if (!cached.fromCache) quotaCost += 1
      payloadHash = cached.payloadHash
      const res = cached.data
      for (const item of res.results ?? []) {
        const id = item?.id
        if (typeof id === 'number' && Number.isInteger(id) && !seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
      const totalPages = typeof res.total_pages === 'number' ? res.total_pages : 1
      if (ids.length >= UPCOMING_IMPORT_CAP || page >= totalPages) break
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }

  const capped = ids.slice(0, UPCOMING_IMPORT_CAP)
  await ctx.syncLog.write({
    endpoint: '/movie/upcoming',
    status: failure !== null ? 'failed' : capped.length === 0 ? 'empty' : 'success',
    errorCode: failure !== null ? 'upcoming_discovery_failed' : null,
    itemsProcessed: capped.length,
    durationMs: Date.now() - startedAt,
    quotaCost,
    payloadHash,
  })
  if (failure !== null) {
    console.warn(`  upcoming: descoberta falhou — ${failure} (seguindo só com o catálogo curado).`)
  }
  return capped
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const refresh = argv.includes('--refresh-images')
  const includeUpcoming = argv.includes('--include-upcoming')
  // Default: NÃO baixa imagem (grava file_path cru; frontend usa URL remota).
  // --download-images = comportamento legado (baixa + grava /media/tmdb/...).
  const downloadImages = argv.includes('--download-images')
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
    if (includeUpcoming) {
      console.log(
        '  upcoming: será descoberto do TMDB /movie/upcoming (com api_cache + api_sync_logs) e ingerido no --apply — sync externo só no apply.',
      )
    }
    return
  }

  const { context: ctx, disconnect } = createIngestionContext()
  const prisma = getPrismaClient()
  let ok = 0
  let failed = 0
  try {
    // Descoberta de "Em breve" (só no --apply): junta os ids upcoming ao catálogo
    // curado (dedup preserva os curados primeiro). O sync da enumeração passa por
    // api_cache + api_sync_logs (regra de ingestão); os detalhes por filme vêm
    // depois via importMovie (também cacheado/logado).
    let upcomingIds: number[] = []
    if (includeUpcoming) {
      console.log('Descobrindo filmes em estreia (TMDB /movie/upcoming, offline)...')
      upcomingIds = await discoverUpcomingMovieIds(ctx)
      console.log(
        `  upcoming descobertos: ${upcomingIds.length}${upcomingIds.length > 0 ? ` (${upcomingIds.join(', ')})` : ''}`,
      )
    }
    const movieIds = dedupeNumbers([...MOVIE_IDS, ...upcomingIds])

    for (const id of movieIds) {
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
      await finalize(prisma, 'movie', cached.data as TmdbDetailLite, refresh, downloadImages)
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
      await finalize(prisma, 'tv', cached.data as TmdbDetailLite, refresh, downloadImages)
      ok += 1
      console.log(`  serie ${id}: OK`)
    }
    console.log(`Ingestão concluída (idempotente): ${ok} OK, ${failed} falha(s).`)
    console.log(
      downloadImages
        ? 'Imagens LOCAIS em apps/web/public/media/tmdb/ (--download-images, legado; gitignored).'
        : 'Sem imagem salva no servidor: posterPath/backdropPath = file_path CRU do TMDB (frontend monta a URL remota do CDN).',
    )
  } finally {
    await disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Falha na ingestão de catálogo público:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
