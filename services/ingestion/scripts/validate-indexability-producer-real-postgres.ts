/**
 * validate-indexability-producer-real-postgres.ts — Validador DESCARTAVEL do
 * PRODUTOR de `page_indexability_decisions`, contra PostgreSQL 16 real efemero.
 *
 * A politica pura ja tem teste unitario. O que SO um banco real prova:
 *
 *   1. o produtor grava a decisao certa para cada tipo de entidade;
 *   2. reexecutar NAO grava de novo (sem churn) — a propriedade mais importante,
 *      porque um produtor que grava por execucao transforma a tabela num log;
 *   3. quando a decisao MUDA, a anterior e despromovida e a nova aponta para ela
 *      (`supersedes_id`), sem janela com duas vigentes;
 *   4. `--dry-run` nao escreve nada.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * Uso: pnpm --filter @screena/ingestion validate:indexability-producer
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'
import { produceIndexabilityDecisions } from '../src/persistence/indexability-writer.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

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
  return path.join(path.dirname(pkgPath), rel)
}

/**
 * Fixtures: 2 filmes (um publicavel, um sem slug) e 2 pessoas (uma com credito
 * em obra publicavel, outra sem credito nenhum). So o que a decisao depende.
 */
async function seed(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO movies (id, tmdb_id, title_original, updated_at) VALUES
             (101, 70101, 'Filme Publicavel', now()),
             (102, 70102, 'Filme Sem Slug', now())`)
  await run(`INSERT INTO people (id, tmdb_id, name, updated_at) VALUES
             (201, 70201, 'Pessoa Com Credito', now()),
             (202, 70202, 'Pessoa Sem Credito', now())`)
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-publicavel', true, now()),
             ('person', 201, 'pt-BR', 'pessoa-com-credito', true, now()),
             ('person', 202, 'pt-BR', 'pessoa-sem-credito', true, now())`)
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'Filme Publicavel', now()),
             ('movie', 102, 'pt-BR', 'Filme Sem Slug', now()),
             ('person', 201, 'pt-BR', 'Pessoa Com Credito', now()),
             ('person', 202, 'pt-BR', 'Pessoa Sem Credito', now())`)
  // So a pessoa 201 tem credito numa obra COM slug canonico.
  await run(`INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at) VALUES
             (201, 'movie', 101, now())`)
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
  const now = () => new Date('2026-07-24T00:00:00.000Z')

  try {
    await seed(prisma)

    // ---- (1) dry-run nao escreve -------------------------------------
    const dry = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: true,
      now,
    })
    const afterDry = await q<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM page_indexability_decisions',
    )
    record(
      'dry-run avalia mas NAO grava',
      dry.evaluated === 4 && dry.written === 0 && Number(afterDry[0]?.n) === 0,
      `avaliadas=${dry.evaluated} gravadas=${dry.written} linhas=${afterDry[0]?.n}`,
    )

    // ---- (2) apply grava as decisoes corretas -------------------------
    const applied = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: false,
      now,
    })
    record('apply grava 4 decisoes', applied.written === 4, `gravadas=${applied.written}`)

    const rows = await q<{ entity_type: string; entity_id: bigint; decision: string; reason: string }>(
      `SELECT entity_type::text AS entity_type, entity_id, decision::text AS decision, reason
         FROM page_indexability_decisions WHERE is_current ORDER BY entity_type, entity_id`,
    )
    const find = (t: string, id: number) =>
      rows.find((r) => r.entity_type === t && Number(r.entity_id) === id)

    record(
      'filme completo -> index',
      find('movie', 101)?.decision === 'index',
      `${find('movie', 101)?.decision} (${find('movie', 101)?.reason})`,
    )
    record(
      'filme SEM slug -> noindex/missing_slug',
      find('movie', 102)?.decision === 'noindex' && find('movie', 102)?.reason === 'missing_slug',
      `${find('movie', 102)?.decision} (${find('movie', 102)?.reason})`,
    )
    record(
      'pessoa COM credito publicavel -> index',
      find('person', 201)?.decision === 'index',
      `${find('person', 201)?.decision} (${find('person', 201)?.reason})`,
    )
    record(
      'pessoa SEM credito -> noindex/no_eligible_credit',
      find('person', 202)?.decision === 'noindex' &&
        find('person', 202)?.reason === 'no_eligible_credit',
      `${find('person', 202)?.decision} (${find('person', 202)?.reason})`,
    )

    // ---- (3) SEM CHURN: reexecutar nao grava --------------------------
    const rerun = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: false,
      now,
    })
    const afterRerun = await q<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM page_indexability_decisions',
    )
    record(
      'reexecucao NAO grava nada (sem churn)',
      rerun.written === 0 && rerun.unchanged === 4 && Number(afterRerun[0]?.n) === 4,
      `gravadas=${rerun.written} inalteradas=${rerun.unchanged} linhas=${afterRerun[0]?.n}`,
    )

    // ---- (4) decisao que MUDA supersede a anterior --------------------
    // Dar um credito publicavel a pessoa 202: ela passa a ser elegivel.
    await prisma.$executeRawUnsafe(
      `INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at)
       VALUES (202, 'movie', 101, now())`,
    )
    const changed = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: false,
      now,
    })
    record('mudanca de estado gera 1 gravacao', changed.written === 1, `gravadas=${changed.written}`)

    const person202 = await q<{ decision: string; is_current: boolean; supersedes_id: bigint | null }>(
      `SELECT decision::text AS decision, is_current, supersedes_id
         FROM page_indexability_decisions
        WHERE entity_type='person' AND entity_id=202 ORDER BY id`,
    )
    record(
      'historico encadeado: 2 linhas, 1 vigente, nova aponta para a antiga',
      person202.length === 2 &&
        person202.filter((r) => r.is_current).length === 1 &&
        person202[1]?.supersedes_id !== null,
      `linhas=${person202.length} vigentes=${person202.filter((r) => r.is_current).length} supersedes=${person202[1]?.supersedes_id}`,
    )
    record(
      'pessoa 202 agora indexa',
      person202.find((r) => r.is_current)?.decision === 'index',
      `${person202.find((r) => r.is_current)?.decision}`,
    )

    // ---- (5) nunca ha duas vigentes ----------------------------------
    const dupes = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT entity_type, entity_id, language_code FROM page_indexability_decisions
          WHERE is_current GROUP BY 1,2,3 HAVING COUNT(*) > 1) x`,
    )
    record('nenhuma entidade com 2 decisoes vigentes', Number(dupes[0]?.n) === 0, `${dupes[0]?.n}`)

    // ---- (6) versao da politica e origem gravadas ---------------------
    const meta = await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM page_indexability_decisions
        WHERE is_current AND policy_version IS NOT NULL AND decision_origin = 'catalog_policy_engine'`,
    )
    record(
      'toda decisao vigente tem policy_version e origem',
      Number(meta[0]?.n) === 4,
      `${meta[0]?.n}/4`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-idx-producer-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // UTF8 explicito: no Windows o initdb herda o locale do SO (WIN1252).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_idx`
  let started = false

  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_idx')

    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
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
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      /* o SO limpa */
    }
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK`)
  process.exitCode = passed === total ? 0 : 1
}

void main()
