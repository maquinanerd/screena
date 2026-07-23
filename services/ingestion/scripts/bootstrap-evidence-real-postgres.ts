/**
 * bootstrap-evidence.ts — Execucao REAL de bootstrap do catalogo contra
 * PostgreSQL 16 EFEMERO, com TMDB REAL.
 *
 * FERRAMENTA DE EVIDENCIA (scratchpad, fora do repositorio). Nunca toca
 * producao: sobe um Postgres proprio, descartavel, e forca DATABASE_URL +
 * NODE_ENV=development no ambiente dos filhos.
 *
 * Prova, em ordem:
 *   1. censo ANTES (banco vazio, migrado do zero)
 *   2. bootstrap --apply (enfileira) + worker (drena)
 *   3. censo DEPOIS
 *   4. IDEMPOTENCIA: segunda execucao identica nao duplica
 *   5. amostras reais (ids + slugs) de filme/serie/temporada/episodio/pessoa
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(SCRIPT_DIR, '..', '..', '..')
const DB_DIR = path.join(REPO, 'packages', 'db')
const SCHEMA = path.join(DB_DIR, 'prisma', 'schema.prisma')
/** Arquivo de env com a credencial TMDB. --env-file=<path> ou .env do repo. */
const ENV_FILE =
  process.argv.find((a) => a.startsWith('--env-file='))?.slice('--env-file='.length) ??
  path.join(REPO, '.env')
const OUT =
  process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ??
  path.join(tmpdir(), 'bootstrap-evidence.json')

/** Titulos por tipo. --limit=<n>; default 100 (escopo editorial inicial). */
const LIMIT =
  process.argv.find((a) => a.startsWith('--limit='))?.slice('--limit='.length) ?? '100'

const require = createRequire(import.meta.url)

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
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

interface StepLog {
  readonly step: string
  readonly command: string
  readonly exitCode: number
  readonly durationMs: number
  readonly stdoutTail: string
  readonly stderrTail: string
}

const steps: StepLog[] = []

/**
 * Roda a CLI do catalogo. O TOKEN TMDB entra via --env-file (o processo filho o
 * le do disco); DATABASE_URL e NODE_ENV sao passados no env do shell, que TEM
 * PRECEDENCIA sobre --env-file no Node. E isso que garante que a ingestao caia
 * no Postgres efemero e nunca no banco de producao do .env.
 */
function runCatalog(step: string, args: string[], databaseUrl: string, timeoutMs = 900_000): StepLog {
  return runBin(step, 'bin/catalog.ts', args, databaseUrl, timeoutMs)
}

/** Roda um bin qualquer de `services/ingestion` com o mesmo isolamento de env. */
function runBin(
  step: string,
  bin: string,
  args: string[],
  databaseUrl: string,
  timeoutMs = 900_000,
): StepLog {
  const started = Date.now()
  const res = spawnSync(
    'node',
    ['--env-file', ENV_FILE, '--import', 'tsx', bin, ...args],
    {
      // `tsx` so resolve a partir do pacote que o declara.
      cwd: path.join(REPO, 'services', 'ingestion'),
      encoding: 'utf8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
        // Nao herdar nada que aponte para producao.
        CINERIE_PUBLIC_INDEXING_ENABLED: '0',
      },
    },
  )
  const log: StepLog = {
    step,
    command: `${bin} ${args.join(' ')}`,
    exitCode: res.status ?? -1,
    durationMs: Date.now() - started,
    stdoutTail: (res.stdout ?? '').split('\n').slice(-40).join('\n'),
    stderrTail: (res.stderr ?? '').split('\n').slice(-20).join('\n'),
  }
  steps.push(log)
  console.log(`\n=== [${step}] ${bin} ${args.join(' ')} -> exit ${log.exitCode} (${log.durationMs}ms) ===`)
  console.log(log.stdoutTail)
  if (log.stderrTail.trim()) console.log('--- stderr ---\n' + log.stderrTail)
  return log
}

/** Censo: contagens brutas + qualidade + classes de URL. Somente leitura. */
async function census(prisma: PrismaClient, label: string) {
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
  const one = async (sql: string): Promise<number> => {
    const rows = await q<{ n: bigint | number }>(sql)
    return Number(rows[0]?.n ?? 0)
  }

  const entities = {
    movies: await one('SELECT COUNT(*)::int AS n FROM movies'),
    tvShows: await one('SELECT COUNT(*)::int AS n FROM tv_shows'),
    seasons: await one('SELECT COUNT(*)::int AS n FROM seasons'),
    episodes: await one('SELECT COUNT(*)::int AS n FROM episodes'),
    people: await one('SELECT COUNT(*)::int AS n FROM people'),
    castMembers: await one('SELECT COUNT(*)::int AS n FROM cast_members'),
    crewMembers: await one('SELECT COUNT(*)::int AS n FROM crew_members'),
    slugs: await one('SELECT COUNT(*)::int AS n FROM slugs'),
    translations: await one('SELECT COUNT(*)::int AS n FROM entity_translations'),
    redirects: await one('SELECT COUNT(*)::int AS n FROM redirects'),
    searchDocuments: await one('SELECT COUNT(*)::int AS n FROM search_documents'),
    tmdbImages: await one('SELECT COUNT(*)::int AS n FROM tmdb_images'),
    tmdbVideos: await one('SELECT COUNT(*)::int AS n FROM tmdb_videos'),
    catalogJobs: await one('SELECT COUNT(*)::int AS n FROM catalog_jobs'),
    apiSyncLogs: await one('SELECT COUNT(*)::int AS n FROM api_sync_logs'),
    apiCache: await one('SELECT COUNT(*)::int AS n FROM api_cache'),
  }

  const quality = {
    moviesWithoutSlug: await one(
      "SELECT COUNT(*)::int AS n FROM movies m WHERE NOT EXISTS (SELECT 1 FROM slugs s WHERE s.entity_type='movie' AND s.entity_id=m.id AND s.is_canonical)",
    ),
    tvWithoutSlug: await one(
      "SELECT COUNT(*)::int AS n FROM tv_shows t WHERE NOT EXISTS (SELECT 1 FROM slugs s WHERE s.entity_type='tv' AND s.entity_id=t.id AND s.is_canonical)",
    ),
    peopleWithoutSlug: await one(
      "SELECT COUNT(*)::int AS n FROM people p WHERE NOT EXISTS (SELECT 1 FROM slugs s WHERE s.entity_type='person' AND s.entity_id=p.id AND s.is_canonical)",
    ),
    moviesWithoutTranslation: await one(
      "SELECT COUNT(*)::int AS n FROM movies m WHERE NOT EXISTS (SELECT 1 FROM entity_translations e WHERE e.entity_type='movie' AND e.entity_id=m.id)",
    ),
    moviesWithoutPoster: await one(
      "SELECT COUNT(*)::int AS n FROM movies WHERE poster_path IS NULL OR BTRIM(poster_path)=''",
    ),
    moviesWithoutBackdrop: await one(
      "SELECT COUNT(*)::int AS n FROM movies WHERE backdrop_path IS NULL OR BTRIM(backdrop_path)=''",
    ),
    tvWithoutSeasons: await one(
      'SELECT COUNT(*)::int AS n FROM tv_shows t WHERE NOT EXISTS (SELECT 1 FROM seasons s WHERE s.tv_show_id=t.id)',
    ),
    seasonsWithoutEpisodes: await one(
      'SELECT COUNT(*)::int AS n FROM seasons s WHERE NOT EXISTS (SELECT 1 FROM episodes e WHERE e.season_id=s.id)',
    ),
    duplicateCanonicalSlugs: await one(
      'SELECT COUNT(*)::int AS n FROM (SELECT entity_type, entity_id, language_code FROM slugs WHERE is_canonical GROUP BY 1,2,3 HAVING COUNT(*)>1) x',
    ),
  }

  // Classes de URL potencialmente indexaveis (mesma logica do sitemap).
  const lang = 'pt-BR'
  const urlClasses = {
    movies: await one(
      `SELECT COUNT(*)::int AS n FROM slugs s JOIN movies m ON m.id=s.entity_id
       WHERE s.entity_type='movie' AND s.language_code='${lang}' AND s.is_canonical AND BTRIM(m.title_original)<>''`,
    ),
    series: await one(
      `SELECT COUNT(*)::int AS n FROM slugs s JOIN tv_shows t ON t.id=s.entity_id
       WHERE s.entity_type='tv' AND s.language_code='${lang}' AND s.is_canonical AND BTRIM(t.name_original)<>''`,
    ),
    // ANTES do gate: qualquer pessoa com slug + nome.
    peopleUngated: await one(
      `SELECT COUNT(*)::int AS n FROM slugs s JOIN people p ON p.id=s.entity_id
       WHERE s.entity_type='person' AND s.language_code='${lang}' AND s.is_canonical AND BTRIM(p.name)<>''`,
    ),
    // DEPOIS do gate: exige credito em obra publicavel.
    peopleGated: await one(
      `SELECT COUNT(*)::int AS n FROM slugs s JOIN people p ON p.id=s.entity_id
       WHERE s.entity_type='person' AND s.language_code='${lang}' AND s.is_canonical AND BTRIM(p.name)<>''
         AND EXISTS (
           SELECT 1 FROM cast_members cm
           JOIN slugs ws ON ws.entity_type=cm.entity_type AND ws.entity_id=cm.entity_id
             AND ws.language_code='${lang}' AND ws.is_canonical
           WHERE cm.person_id=p.id AND cm.entity_type IN ('movie','tv')
           UNION ALL
           SELECT 1 FROM crew_members rm
           JOIN slugs ws ON ws.entity_type=rm.entity_type AND ws.entity_id=rm.entity_id
             AND ws.language_code='${lang}' AND ws.is_canonical
           WHERE rm.person_id=p.id AND rm.entity_type IN ('movie','tv')
         )`,
    ),
  }

  const jobs = await q<{ status: string; n: number }>(
    'SELECT status::text AS status, COUNT(*)::int AS n FROM catalog_jobs GROUP BY 1 ORDER BY 1',
  )

  console.log(`\n########## CENSO: ${label} ##########`)
  console.log('entidades  ', JSON.stringify(entities))
  console.log('qualidade  ', JSON.stringify(quality))
  console.log('classes URL', JSON.stringify(urlClasses))
  console.log('fila       ', JSON.stringify(jobs))

  return { label, entities, quality, urlClasses, jobs }
}

/** Amostras REAIS (ids + slugs) para a evidencia da PR. */
async function samples(prisma: PrismaClient) {
  const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
  return {
    movies: await q(
      `SELECT m.tmdb_id, m.title_original, s.slug FROM movies m
       JOIN slugs s ON s.entity_type='movie' AND s.entity_id=m.id AND s.is_canonical
       ORDER BY m.tmdb_id LIMIT 8`,
    ),
    series: await q(
      `SELECT t.tmdb_id, t.name_original, s.slug FROM tv_shows t
       JOIN slugs s ON s.entity_type='tv' AND s.entity_id=t.id AND s.is_canonical
       ORDER BY t.tmdb_id LIMIT 8`,
    ),
    seasons: await q(
      `SELECT se.season_number, se.name, t.name_original AS show FROM seasons se
       JOIN tv_shows t ON t.id=se.tv_show_id ORDER BY t.tmdb_id, se.season_number LIMIT 8`,
    ),
    episodes: await q(
      `SELECT se.season_number, e.episode_number, e.name, t.name_original AS show FROM episodes e
       JOIN seasons se ON se.id=e.season_id
       JOIN tv_shows t ON t.id=e.tv_show_id ORDER BY t.tmdb_id, se.season_number, e.episode_number LIMIT 8`,
    ),
    peopleEligible: await q(
      `SELECT p.tmdb_id, p.name, s.slug,
              (SELECT COUNT(*) FROM cast_members cm WHERE cm.person_id=p.id AND cm.entity_type IN ('movie','tv'))
            + (SELECT COUNT(*) FROM crew_members rm WHERE rm.person_id=p.id AND rm.entity_type IN ('movie','tv')) AS credits
       FROM people p JOIN slugs s ON s.entity_type='person' AND s.entity_id=p.id AND s.is_canonical
       ORDER BY credits DESC, p.tmdb_id LIMIT 8`,
    ),
    mediaSample: await q(
      `SELECT entity_type::text AS entity_type, image_type::text AS image_type, file_path, width, height
       FROM tmdb_images ORDER BY id LIMIT 6`,
    ),
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-bootstrap-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // ENCODING E OBRIGATORIO AQUI. No Windows, `initdb` herda o locale do SO e
    // cria o cluster em WIN1252. Payload real do TMDB tem turco (İ), tailandes,
    // cirilico e grego — e a gravacao em `api_cache` morre com
    // "character with byte sequence 0x.. has no equivalent in encoding WIN1252",
    // derrubando TODO `sync_details`. Os validadores PG16 existentes nao pegam
    // isso porque usam dados sinteticos ASCII; so dado real expoe o problema.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_bootstrap`
  let started = false
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), port }

  try {
    console.log(`--- subindo PostgreSQL 16 efemero na porta ${port} ---`)
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_bootstrap')

    console.log('--- prisma migrate deploy (do zero) ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', SCHEMA], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      cwd: DB_DIR,
    })

    // -------------------------------------------------------------------
    // SEED de referencia — PRE-REQUISITO REAL, nao conveniencia.
    //
    // `migrate deploy` cria as tabelas vazias. Varias FKs apontam para tabelas
    // de referencia que SO o seed preenche:
    //   api_sync_logs.provider_api  -> api_providers
    //   movies.original_language    -> languages
    //   tv_shows.original_language  -> languages
    //   slugs.language_code         -> languages
    //   entity_translations.language_code -> languages
    //
    // Sem o seed, a PRIMEIRA escrita de qualquer worker morre com FK violation
    // (`api_sync_logs_provider_api_fkey`) — antes mesmo de tocar o catalogo.
    // -------------------------------------------------------------------
    console.log('--- prisma db seed (tabelas de referencia) ---')
    execFileSync('node', ['--import', 'tsx', path.join(DB_DIR, 'prisma', 'seed.ts')], {
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'development' },
      stdio: 'inherit',
      cwd: DB_DIR,
    })

    const prisma = new PrismaClient({ datasourceUrl: url })
    try {
      report.censusBefore = await census(prisma, 'ANTES (banco migrado, vazio)')

      // -------------------------------------------------------------------
      // ESCOPO EDITORIAL: ~100 filmes populares + ~100 series populares.
      // Pessoas NAO sao descobertas por lista: entram apenas como elenco/equipe
      // dos titulos escolhidos.
      // -------------------------------------------------------------------
      // -------------------------------------------------------------------
      // PRE-REQUISITO: taxonomias + configuracao de imagens.
      //
      // `catalog bootstrap` NAO enfileira esta etapa — ela e um passo separado
      // no runbook. Contra um banco recem-migrado (languages/countries/genres
      // vazios) o bootstrap falha inteiro com P2003: `movies.original_language`
      // e `tv_shows.original_language` tem FK para `languages`, e `slugs`/
      // `entity_translations` tambem. Sem este passo, nenhuma entidade persiste.
      // -------------------------------------------------------------------
      runBin('taxonomies', 'bin/sync-tmdb.ts', ['taxonomies', '--apply'], url)
      runBin('tmdb-config', 'bin/sync-tmdb-config.ts', ['--apply'], url)

      const requestId = 'prompt03-bootstrap-1'
      runCatalog('dry-run', [
        'bootstrap', '--strategy', 'popular', '--entity', 'movie,tv',
        '--limit', LIMIT, '--locale', 'pt-BR', '--request-id', requestId, '--dry-run', '--json',
      ], url)

      runCatalog('bootstrap-apply', [
        'bootstrap', '--strategy', 'popular', '--entity', 'movie,tv',
        '--limit', LIMIT, '--locale', 'pt-BR', '--request-id', requestId, '--apply', '--json',
      ], url)

      runCatalog('worker-1', ['worker', '--concurrency', '4', '--max-jobs', '4000', '--timeout-ms', '300000'], url, 1_800_000)

      report.censusAfter = await census(prisma, 'DEPOIS (1a execucao)')

      // -------------------------------------------------------------------
      // DEMONSTRACAO DO GATE DE PESSOA.
      //
      // No caminho da fila, pessoa chega como linha de credito e NAO ganha slug
      // (so movie/tv sao alvos de `sync_details`), entao o gate nem chega a ser
      // exercitado. O catalogo de producao com ~22.400 pessoas foi construido
      // com pessoa NA DESCOBERTA — e ai cada pessoa ganha slug.
      //
      // Para provar o gate, reproduzimos esse cenario: sincronizamos pessoas COM
      // credito nos titulos ingeridos e pessoas SEM credito nenhum. As duas
      // ganham slug; so as primeiras passam no gate.
      // -------------------------------------------------------------------
      const withCredits = await prisma.$queryRawUnsafe<{ tmdb_id: number }[]>(
        `SELECT DISTINCT p.tmdb_id FROM people p
         JOIN cast_members cm ON cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
         ORDER BY p.tmdb_id LIMIT 5`,
      )
      // Ids de pessoa que NAO participam de nenhum titulo ingerido.
      const orphanIds = [1, 2, 3, 4, 5].map((n) => 500_000 + n)
      for (const row of withCredits) {
        runCatalog(`person-credited-${row.tmdb_id}`, [
          'sync', '--entity', 'person', '--id', String(row.tmdb_id), '--locale', 'pt-BR', '--apply',
        ], url)
      }
      for (const id of orphanIds) {
        runCatalog(`person-orphan-${id}`, [
          'sync', '--entity', 'person', '--id', String(id), '--locale', 'pt-BR', '--apply',
        ], url)
      }
      report.censusPersonGate = await census(prisma, 'GATE DE PESSOA (com e sem credito)')

      report.samples = await samples(prisma)

      // -------------------------------------------------------------------
      // IDEMPOTENCIA: MESMO request-id, mesmo escopo. Nao pode duplicar.
      // -------------------------------------------------------------------
      runCatalog('bootstrap-apply-2', [
        'bootstrap', '--strategy', 'popular', '--entity', 'movie,tv',
        '--limit', LIMIT, '--locale', 'pt-BR', '--request-id', requestId, '--apply', '--json',
      ], url)
      runCatalog('worker-2', ['worker', '--concurrency', '4', '--max-jobs', '4000', '--timeout-ms', '300000'], url, 1_800_000)

      report.censusIdempotency = await census(prisma, 'DEPOIS (2a execucao — idempotencia)')

      report.steps = steps
      report.finishedAt = new Date().toISOString()
      writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
      console.log(`\n>>> relatorio salvo em ${OUT}`)
    } finally {
      await prisma.$disconnect()
    }
  } catch (e) {
    console.error('FALHA:', e instanceof Error ? e.stack : String(e))
    report.error = e instanceof Error ? e.message : String(e)
    report.steps = steps
    writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
    process.exitCode = 1
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* o SO limpa */
    }
  }
}

void main()
