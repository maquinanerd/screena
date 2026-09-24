/**
 * validate-country-backfill-real-postgres.ts — O PAIS DE ORIGEM, provado contra
 * PostgreSQL 16 efemero com o schema de producao.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * ============================================================================
 * O QUE SO UM BANCO REAL PROVA
 * ============================================================================
 *   1. que o `INSERT ... WHERE NOT EXISTS` RECUSA reescrever pais existente —
 *      chamado direto, porque rodando o backfill inteiro um titulo com pais nem
 *      entra nos candidatos e o guard nunca seria exercido;
 *   2. que o `unnest($1::text[], $2::integer[])` recebe os arrays do Prisma;
 *   3. que a leitura em lote acha o payload guardado em `api_cache` (por
 *      `endpoint`, o mais recente) e em `tmdb_raw`, atravessando `jsonb`;
 *   4. que `--dry-run` LE o banco e nao escreve uma linha;
 *   5. que o caminho de payload inalterado do import (`touch` +
 *      `fillMissingTitleCountries`) grava o pais que faltava e NAO toca o
 *      `updated_at` do titulo;
 *   6. que o SQL de verificacao de `docs/operations/` roda, e so-leitura, e
 *      devolve UMA celula JSON com os numeros esperados.
 *
 * Uso: pnpm --filter @screena/ingestion validate:country-backfill
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { runChild } from '@screena/db/async-child-process'
import { PrismaClient } from '@prisma/client'

import {
  backfillTitleCountries,
  writeTitleCountriesIfEmpty,
} from '../src/persistence/country-backfill.js'
import { createPrismaStore } from '../src/persistence/store.js'
import { importMovie, importTvShow } from '../src/import/index.js'
import type { ImportContext } from '../src/import/types.js'
import type { CachePort, SyncLogInput, TmdbReadPort } from '../src/ports.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(ingestionDir, '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')
const VERIFICATION_SQL = path.join(repoRoot, 'docs', 'operations', 'verificacao-entrada-e-pais.sql')

let passed = 0
let total = 0
function record(name: string, ok: boolean, detail: string): void {
  total += 1
  if (ok) passed += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${total}. ${name} — ${detail}`)
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
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

/** Ver `validate-language-cutdown-real-postgres.ts`: cluster JA de pe, so loopback. */
function externalDatabaseUrl(): string | null {
  const raw = process.env.CINERIE_VALIDATOR_DATABASE_URL
  if (raw === undefined || raw.trim().length === 0) return null
  const host = new URL(raw).hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `CINERIE_VALIDATOR_DATABASE_URL precisa apontar para loopback (recebeu host "${host}").`,
    )
  }
  return raw
}

/**
 * Roda um arquivo SQL "como o dono roda no DbGate": primeiro statement e o
 * `SET default_transaction_read_only = on`, o segundo e o SELECT. Os dois vao na
 * MESMA conexao (transacao interativa); o SELECT roda numa transacao marcada
 * READ ONLY, entao uma escrita escondida no arquivo falharia aqui.
 */
export async function runReadOnlySqlFile(
  prisma: PrismaClient,
  file: string,
): Promise<{ firstLine: string; rows: Record<string, unknown>[] }> {
  const text = readFileSync(file, 'utf8')
  const firstLine = text.split('\n')[0]?.trim() ?? ''
  // Remove comentarios de linha e separa por `;` no FIM de linha. O arquivo e
  // escrito sem `;` dentro de literais.
  const statements = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt !== '')
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    let last: Record<string, unknown>[] = []
    for (const stmt of statements) {
      if (/^SET\s/i.test(stmt)) await tx.$executeRawUnsafe(stmt)
      else last = await tx.$queryRawUnsafe<Record<string, unknown>[]>(stmt)
    }
    // O `SET` do arquivo e de SESSAO: sobrevive ao COMMIT e deixaria a conexao
    // do pool recusando escrita no resto do validador — que e a prova de que a
    // primeira linha funciona, mas nao pode vazar para os checks seguintes.
    await tx.$executeRawUnsafe('RESET default_transaction_read_only')
    return last
  })
  return { firstLine, rows }
}

/**
 * FIXTURE — o estado medido em producao em 24/09/2026, em miniatura:
 *
 *   filme 272  sem pais · api_cache com US             -> GANHA US (o defeito)
 *   filme 602  sem pais · api_cache [] · tmdb_raw US   -> GANHA US (reserva)
 *   filme 605  COM FR   · api_cache com US             -> INTOCADO (nao e candidato)
 *   filme 900  sem pais · api_cache []                 -> fica sem (lista vazia do TMDB)
 *   filme 901  sem pais · sem payload                  -> fica sem (sem payload)
 *   serie 433  sem pais · api_cache ["GB"]             -> GANHA GB
 *   serie 186  COM KR   · api_cache ["US"]             -> INTOCADA
 *   filme 621  sem pais · sem payload guardado; usado no teste do import
 *              (payload inalterado), que grava US
 */
async function seed(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  const json = (v: unknown) => JSON.stringify(v).replace(/'/g, "''")
  const old = "'2026-07-10T00:00:00Z'"

  await run(`INSERT INTO api_providers (key, name, kind) VALUES ('tmdb','TMDB','data')
             ON CONFLICT (key) DO NOTHING`)
  await run(`INSERT INTO movies (id, tmdb_id, title_original, created_at, updated_at) VALUES
             (1, 272, 'Batman Begins', ${old}, ${old}),
             (2, 602, 'Independence Day', ${old}, ${old}),
             (3, 605, 'Matrix Revolutions', ${old}, ${old}),
             (4, 900, 'Cauda sem pais', now(), now()),
             (5, 901, 'Sem payload', now(), now()),
             (6, 621, 'Grease', ${old}, ${old})`)
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, created_at, updated_at) VALUES
             (11, 433, 'Serie britanica', ${old}, ${old}),
             (12, 186, 'Serie coreana', ${old}, ${old})`)
  await run(`INSERT INTO movie_production_countries (movie_id, country_code, position) VALUES (3, 'FR', 0)`)
  await run(`INSERT INTO tv_show_origin_countries (tv_show_id, country_code, position) VALUES (12, 'KR', 0)`)

  const cache = (endpoint: string, payload: unknown, fetchedAt = 'now()') =>
    run(`INSERT INTO api_cache (provider_api, endpoint, request_key, params_hash, payload, payload_hash, fetched_at)
         VALUES ('tmdb', '${endpoint}', '${endpoint}?v=${Math.random()}', 'h', '${json(payload)}'::jsonb, 'x', ${fetchedAt})`)
  const US = [{ iso_3166_1: 'US', name: 'United States of America' }]
  // Duas linhas para o 272: a MAIS RECENTE e a que vale.
  await cache('/movie/272', { id: 272, production_countries: [] }, "'2026-07-01T00:00:00Z'")
  await cache('/movie/272', { id: 272, production_countries: US })
  await cache('/movie/602', { id: 602, production_countries: [] })
  await cache('/movie/605', { id: 605, production_countries: US })
  await cache('/movie/900', { id: 900, production_countries: [] })
  await cache('/tv/433', { id: 433, origin_country: ['gb'] })
  await cache('/tv/186', { id: 186, origin_country: ['US'] })
  await run(`INSERT INTO tmdb_raw (entity_type, tmdb_id, base_language, payload, payload_hash, updated_at)
             VALUES ('movie', 602, 'pt-BR', '${json({ id: 602, production_countries: US })}'::jsonb, 'r', now())`)

  // Um dead_letter 'empty' recente (a recusa virando erro) e um antigo, para o
  // SQL de verificacao contar SO a janela de 24 h.
  await run(`INSERT INTO catalog_jobs (job_type, status, idempotency_key, last_error_code, updated_at)
             VALUES ('sync_details', 'dead_letter', 'v:recente', 'empty', now()),
                    ('sync_details', 'dead_letter', 'v:antigo', 'empty', now() - interval '3 days')`)
  await run(`INSERT INTO api_sync_logs (provider_api, endpoint, status, items_processed, items_updated, items_created)
             VALUES ('tmdb', '/movie/changes', 'success', 100, 12, 10)`)
}

async function countryRows(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ k: string }[]>(
    `SELECT 'movie:' || m.tmdb_id || '=' || x.country_code AS k
       FROM movie_production_countries x JOIN movies m ON m.id = x.movie_id
     UNION ALL
     SELECT 'tv:' || t.tmdb_id || '=' || x.country_code
       FROM tv_show_origin_countries x JOIN tv_shows t ON t.id = x.tv_show_id
     ORDER BY 1`,
  )
  return rows.map((r) => r.k).join(' ')
}

async function updatedAtFingerprint(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ k: string }[]>(
    `SELECT string_agg(tmdb_id || '@' || updated_at::text, ',' ORDER BY tmdb_id) AS k FROM movies
     UNION ALL
     SELECT string_agg(tmdb_id || '@' || updated_at::text, ',' ORDER BY tmdb_id) FROM tv_shows`,
  )
  return rows.map((r) => r.k).join(' | ')
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  try {
    await seed(prisma)
    const verdadeInicial = await countryRows(prisma)
    const carimbosIniciais = await updatedAtFingerprint(prisma)

    // --- SQL de verificacao: linha de base -------------------------------
    const base = await runReadOnlySqlFile(prisma, VERIFICATION_SQL)
    const baseCell = base.rows[0]?.verificacao as Record<string, unknown> | undefined
    const pais = baseCell?.titulos_com_pais_no_payload_e_sem_pais_gravado as
      | { total: number; filmes: number; series: number; amostra_tmdb_ids: string[] }
      | undefined
    record(
      'SQL de verificacao: primeira linha poe a sessao em so-leitura',
      base.firstLine === 'SET default_transaction_read_only = on;',
      base.firstLine,
    )
    record(
      'SQL de verificacao: UMA linha, UMA coluna JSON',
      base.rows.length === 1 && Object.keys(base.rows[0] ?? {}).length === 1 && baseCell !== undefined,
      `linhas=${base.rows.length} colunas=${Object.keys(base.rows[0] ?? {}).join(',')}`,
    )
    // 272 (cache mais recente com US) e tv 433. O 602 so tem pais no tmdb_raw —
    // a metrica e "no payload do api_cache", e o cache dele e lista vazia.
    record(
      'SQL de verificacao: conta os titulos com pais no api_cache e sem pais gravado',
      Number(pais?.total) === 2 &&
        Number(pais?.filmes) === 1 &&
        Number(pais?.series) === 1 &&
        JSON.stringify(pais?.amostra_tmdb_ids) === JSON.stringify(['movie:272', 'tv:433']),
      JSON.stringify(pais),
    )
    record(
      'SQL de verificacao: dead_letter empty conta so as ultimas 24 h',
      Number(baseCell?.sync_details_dead_letter_empty_24h) === 1,
      `n=${String(baseCell?.sync_details_dead_letter_empty_24h)}`,
    )
    const changes = baseCell?.changes_ultimas_24h as
      | { endpoint: string; ids_descartados_fora_do_catalogo: number }[]
      | undefined
    record(
      'SQL de verificacao: descartados do /changes = vieram - no catalogo',
      changes?.[0]?.endpoint === '/movie/changes' &&
        Number(changes[0].ids_descartados_fora_do_catalogo) === 88,
      JSON.stringify(changes),
    )
    const porDia = baseCell?.titulos_criados_por_dia as { titulos: number }[] | undefined
    record(
      'SQL de verificacao: titulos criados por dia cobre 7 dias',
      porDia?.length === 7 && Number(porDia[6]?.titulos) === 2,
      JSON.stringify(porDia?.map((d) => d.titulos)),
    )

    // --- dry-run: LE o banco e nao escreve -------------------------------
    const dry = await backfillTitleCountries(prisma, { dryRun: true })
    record(
      'dry-run LEU o banco: candidatos e recuperados reais',
      dry.candidates === 6 &&
        dry.recovered === 3 &&
        dry.byPayloadSource.api_cache === 2 &&
        dry.byPayloadSource.tmdb_raw === 1,
      `candidatos=${dry.candidates} recuperados=${dry.recovered} fontes=${JSON.stringify(dry.byPayloadSource)}`,
    )
    record(
      'dry-run separa lista vazia do TMDB e ausencia de payload',
      dry.skipped.empty_country_list_in_payload === 1 && dry.skipped.no_stored_payload === 2,
      JSON.stringify(dry.skipped),
    )
    record(
      'dry-run NAO escreveu uma linha',
      (await countryRows(prisma)) === verdadeInicial && dry.rowsWritten === 0,
      `antes="${verdadeInicial}" depois="${await countryRows(prisma)}"`,
    )

    // --- apply ------------------------------------------------------------
    const applied = await backfillTitleCountries(prisma, { dryRun: false })
    const depois = await countryRows(prisma)
    record(
      '--apply grava SO em titulo sem pais (272, 602, tv 433)',
      applied.titlesWritten === 3 &&
        depois ===
          'movie:272=US movie:602=US movie:605=FR tv:186=KR tv:433=GB',
      `gravados=${applied.titlesWritten} estado="${depois}"`,
    )
    record(
      '--apply nao reescreveu pais existente (605=FR, 186=KR) mesmo com payload dizendo US',
      depois.includes('movie:605=FR') && !depois.includes('movie:605=US') && depois.includes('tv:186=KR'),
      depois,
    )
    record(
      '--apply nao tocou updated_at de filme nem serie',
      (await updatedAtFingerprint(prisma)) === carimbosIniciais,
      'carimbos identicos',
    )

    const again = await backfillTitleCountries(prisma, { dryRun: false })
    record(
      'segunda execucao grava zero (titulo com pais saiu do conjunto)',
      again.candidates === 3 && again.titlesWritten === 0 && again.recovered === 0,
      `candidatos=${again.candidates} gravados=${again.titlesWritten}`,
    )

    // --- o guard, exercido DIRETO ------------------------------------------
    const recusado = await writeTitleCountriesIfEmpty(prisma, 'movie', 'id', 3n, [
      { countryCode: 'US', position: 0 },
    ])
    record(
      'o NOT EXISTS recusa escrita em titulo que JA tem pais (chamada direta)',
      recusado === 0 && (await countryRows(prisma)).includes('movie:605=FR'),
      `linhas=${recusado}`,
    )

    // --- import: payload inalterado grava o pais que faltava -------------
    const store = createPrismaStore(prisma)
    const logs: SyncLogInput[] = []
    const unchangedCache: CachePort = {
      async getOrFetch(input) {
        return { data: await input.fetcher(), fromCache: true, payloadHash: 'mesmo', changed: false }
      },
    }
    const notUsed = async (): Promise<never> => {
      throw new Error('nao usado')
    }
    const tmdb: TmdbReadPort = {
      getMovie: async (id) => ({
        id,
        original_title: 'Grease',
        production_countries: [{ iso_3166_1: 'US', name: 'United States of America' }],
      }),
      getTvShow: async (id) => ({ id, original_name: 'Serie', origin_country: ['JP'], seasons: [] }),
      getTvSeason: notUsed,
      getTvEpisode: notUsed,
      getPerson: notUsed,
      getUpcomingMovies: notUsed,
    }
    const ctx: ImportContext = {
      tmdb,
      cache: unchangedCache,
      store,
      syncLog: {
        async write(input) {
          logs.push(input)
        },
      },
      now: () => new Date('2026-09-24T12:00:00.000Z'),
      staleAfter: () => null,
    }
    const antesImport = await prisma.$queryRawUnsafe<{ u: Date }[]>(
      `SELECT updated_at AS u FROM movies WHERE tmdb_id = 621`,
    )
    const r621 = await importMovie(ctx, 621)
    const depoisImport = await prisma.$queryRawUnsafe<{ u: Date }[]>(
      `SELECT updated_at AS u FROM movies WHERE tmdb_id = 621`,
    )
    record(
      'import com payload INALTERADO grava o pais que faltava (621=US)',
      r621.status === 'success' &&
        r621.changed === false &&
        (await countryRows(prisma)).includes('movie:621=US') &&
        logs[0]?.itemsUpdated === 1,
      `status=${r621.status} changed=${r621.changed} log.itemsUpdated=${logs[0]?.itemsUpdated}`,
    )
    record(
      'import com payload inalterado NAO mexe em updated_at do titulo',
      antesImport[0]?.u.getTime() === depoisImport[0]?.u.getTime(),
      `${antesImport[0]?.u.toISOString()} -> ${depoisImport[0]?.u.toISOString()}`,
    )

    // Serie 186 JA tem KR; o payload inalterado diz JP. Nada e reescrito.
    const r186 = await importTvShow(ctx, 186)
    record(
      'import de serie com payload inalterado e pais PRESENTE nao reescreve (186=KR)',
      r186.status === 'success' &&
        (await countryRows(prisma)).includes('tv:186=KR') &&
        !(await countryRows(prisma)).includes('tv:186=JP') &&
        logs[1]?.itemsUpdated === 0,
      `status=${r186.status} log.itemsUpdated=${logs[1]?.itemsUpdated}`,
    )

    // --- SQL de verificacao depois do backfill ----------------------------
    const final = await runReadOnlySqlFile(prisma, VERIFICATION_SQL)
    const finalCell = final.rows[0]?.verificacao as Record<string, unknown> | undefined
    const finalPais = finalCell?.titulos_com_pais_no_payload_e_sem_pais_gravado as
      | { total: number }
      | undefined
    record(
      'SQL de verificacao depois do backfill: pais no payload e nao gravado = 0',
      Number(finalPais?.total) === 0,
      JSON.stringify(finalCell?.titulos_sem_pais),
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const external = externalDatabaseUrl()
  if (external !== null) {
    console.log('[info] usando CINERIE_VALIDATOR_DATABASE_URL (cluster externo, loopback).')
    try {
      await runChild('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
        env: { ...process.env, DATABASE_URL: external },
        stdio: 'inherit',
        cwd: dbDir,
      })
      record('migrate deploy aplica do zero', true, 'ok')
      await runChecks(external)
    } catch (error) {
      record('execucao sem excecao', false, error instanceof Error ? error.message.slice(0, 300) : String(error))
      if (error instanceof Error && error.stack) console.error(error.stack)
    }
    console.log(`\nRESUMO: ${passed}/${total} checks OK`)
    process.exitCode = passed === total ? 0 : 1
    return
  }

  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-country-backfill-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_country_backfill`
  let started = false

  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_country_backfill')
    await runChild('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      cwd: dbDir,
    })
    record('migrate deploy aplica do zero', true, 'ok')
    await runChecks(url)
  } catch (error) {
    record(
      'execucao sem excecao',
      false,
      error instanceof Error ? error.message.split('\n').join(' ').slice(0, 300) : String(error),
    )
    if (error instanceof Error && error.stack) console.error(error.stack)
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch {
      /* o SO limpa */
    }
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK`)
  process.exitCode = passed === total ? 0 : 1
}

void main()
