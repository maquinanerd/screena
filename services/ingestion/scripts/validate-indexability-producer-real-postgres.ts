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
 *   4. `--dry-run` nao escreve nada;
 *   5. (v2) que os fatos de CONTEUDO saem das colunas certas — a sinopse de
 *      filme/serie de `entity_translations.summary`, a de temporada/episodio da
 *      PROPRIA linha, e a biografia so quando `biography_source_status` libera.
 *      So um banco real prova que a coluna existe e que o SQL a le.
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
 * Fixtures: so o que a decisao depende, um caso por gate.
 *
 *   movie 101   completo (slug + titulo + traducao com summary + poster) -> index
 *   movie 102   sem slug                                                 -> noindex
 *   movie 103   completo MENOS a sinopse                                 -> noindex
 *   tv 301      serie completa                                           -> index
 *   season 401  da serie 301, com sinopse e episodios                    -> index
 *   season 402  da serie 301, sem sinopse e SEM episodio (casca)         -> noindex
 *   episode 501 da season 401, COM sinopse                               -> index
 *   episode 502 da season 401, SEM sinopse                               -> noindex
 *   person 201  credito + bio LIBERADA + foto                            -> index
 *   person 202  sem credito nenhum                                       -> noindex
 *   person 203  credito + foto, bio com TEXTO mas status `unknown`       -> noindex
 */
async function seed(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO movies (id, tmdb_id, title_original, poster_path, updated_at) VALUES
             (101, 70101, 'Filme Publicavel', '/p101.jpg', now()),
             (102, 70102, 'Filme Sem Slug', '/p102.jpg', now()),
             (103, 70103, 'Filme Sem Sinopse', '/p103.jpg', now())`)
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, poster_path, updated_at) VALUES
             (301, 70301, 'Serie Publicavel', '/p301.jpg', now())`)
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, name, overview, poster_path, updated_at) VALUES
             (401, 301, 1, 'Temporada 1', 'Sinopse da temporada.', '/s401.jpg', now()),
             (402, 301, 2, 'Temporada 2', NULL, NULL, now())`)
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, overview, updated_at) VALUES
             (501, 401, 301, 1, 'Episodio Com Sinopse', 'Sinopse do episodio.', now()),
             (502, 401, 301, 2, 'Episodio Sem Sinopse', NULL, now())`)
  // A bio da 201/202 esta LIBERADA; a da 203 tem texto e continua no default
  // 'unknown' — texto sem liberacao nao aparece na tela e nao conta.
  await run(`INSERT INTO people (id, tmdb_id, name, profile_path, biography, biography_source_status, updated_at) VALUES
             (201, 70201, 'Pessoa Com Credito', '/f201.jpg', 'Biografia liberada.', 'third_party', now()),
             (202, 70202, 'Pessoa Sem Credito', '/f202.jpg', 'Biografia liberada.', 'third_party', now()),
             (203, 70203, 'Pessoa Bio Nao Liberada', '/f203.jpg', 'Biografia ingerida.', 'unknown', now())`)
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-publicavel', true, now()),
             ('movie', 103, 'pt-BR', 'filme-sem-sinopse', true, now()),
             ('tv', 301, 'pt-BR', 'serie-publicavel', true, now()),
             ('person', 201, 'pt-BR', 'pessoa-com-credito', true, now()),
             ('person', 202, 'pt-BR', 'pessoa-sem-credito', true, now()),
             ('person', 203, 'pt-BR', 'pessoa-bio-nao-liberada', true, now())`)
  // `summary` e a sinopse. O filme 103 TEM traducao e NAO tem summary: e o
  // controle que separa `missing_translation` de `no_synopsis`.
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'Filme Publicavel', 'Sinopse do filme.', now()),
             ('movie', 102, 'pt-BR', 'Filme Sem Slug', 'Sinopse do filme.', now()),
             ('movie', 103, 'pt-BR', 'Filme Sem Sinopse', NULL, now()),
             ('tv', 301, 'pt-BR', 'Serie Publicavel', 'Sinopse da serie.', now()),
             ('person', 201, 'pt-BR', 'Pessoa Com Credito', NULL, now()),
             ('person', 202, 'pt-BR', 'Pessoa Sem Credito', NULL, now()),
             ('person', 203, 'pt-BR', 'Pessoa Bio Nao Liberada', NULL, now())`)
  // So as pessoas 201 e 203 tem credito numa obra COM slug canonico.
  await run(`INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at) VALUES
             (201, 'movie', 101, now()),
             (203, 'movie', 101, now())`)
}

/** Quantas entidades o produtor avalia com estas fixtures. */
const SEEDED = 11

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
      dry.evaluated === SEEDED && dry.written === 0 && Number(afterDry[0]?.n) === 0,
      `avaliadas=${dry.evaluated} gravadas=${dry.written} linhas=${afterDry[0]?.n}`,
    )

    // ---- (2) apply grava as decisoes corretas -------------------------
    const applied = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: false,
      now,
    })
    record(
      `apply grava ${SEEDED} decisoes`,
      applied.written === SEEDED,
      `gravadas=${applied.written}`,
    )

    const rows = await q<{ entity_type: string; entity_id: bigint; decision: string; reason: string }>(
      `SELECT entity_type::text AS entity_type, entity_id, decision::text AS decision, reason
         FROM page_indexability_decisions WHERE is_current ORDER BY entity_type, entity_id`,
    )
    const find = (t: string, id: number) =>
      rows.find((r) => r.entity_type === t && Number(r.entity_id) === id)

    const expectDecision = (
      label: string,
      type: string,
      id: number,
      decision: string,
      reason: string,
    ) => {
      const row = find(type, id)
      record(
        label,
        row?.decision === decision && row?.reason === reason,
        `${type}#${id} -> ${row?.decision} (${row?.reason}); esperado ${decision} (${reason})`,
      )
    }

    expectDecision('filme completo -> index', 'movie', 101, 'index', 'eligible')
    expectDecision('filme SEM slug -> noindex', 'movie', 102, 'noindex', 'missing_slug')
    // O 103 tem traducao: prova que `no_synopsis` e a causa lida da COLUNA
    // `summary`, e nao um efeito colateral de traducao ausente.
    expectDecision('filme com traducao e SEM sinopse -> noindex', 'movie', 103, 'noindex', 'no_synopsis')
    expectDecision('serie completa -> index', 'tv', 301, 'index', 'eligible')
    expectDecision('temporada com sinopse -> index', 'season', 401, 'index', 'eligible')
    expectDecision(
      'temporada sem sinopse e sem episodio -> noindex',
      'season',
      402,
      'noindex',
      'insufficient_data',
    )
    expectDecision('episodio COM sinopse -> index', 'episode', 501, 'index', 'eligible')
    expectDecision('episodio SEM sinopse -> noindex', 'episode', 502, 'noindex', 'no_synopsis')
    expectDecision('pessoa com credito, bio liberada e foto -> index', 'person', 201, 'index', 'eligible')
    expectDecision('pessoa SEM credito -> noindex', 'person', 202, 'noindex', 'no_eligible_credit')
    // O texto da bio existe; falta a LIBERACAO. A tela nao mostraria nada.
    expectDecision('pessoa com bio NAO liberada -> noindex', 'person', 203, 'noindex', 'no_biography')

    // A URL registrada de temporada/episodio deriva do slug da SERIE mais os
    // numeros — a coluna e NOT NULL e serve de pista em auditoria.
    const urls = await q<{ entity_type: string; entity_id: bigint; url: string }>(
      `SELECT entity_type::text AS entity_type, entity_id, url
         FROM page_indexability_decisions
        WHERE is_current AND entity_type IN ('season','episode') ORDER BY entity_id`,
    )
    const urlOf = (t: string, id: number) =>
      urls.find((r) => r.entity_type === t && Number(r.entity_id) === id)?.url
    record(
      'URL de temporada/episodio deriva do slug da serie',
      urlOf('season', 401) === '/pt/series/serie-publicavel/temporadas/1/' &&
        urlOf('episode', 501) === '/pt/series/serie-publicavel/temporadas/1/episodios/1/',
      `${urlOf('season', 401)} | ${urlOf('episode', 501)}`,
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
      rerun.written === 0 &&
        rerun.unchanged === SEEDED &&
        Number(afterRerun[0]?.n) === SEEDED,
      `gravadas=${rerun.written} inalteradas=${rerun.unchanged} linhas=${afterRerun[0]?.n}`,
    )

    // ---- (4) decisao que MUDA supersede a anterior --------------------
    // REVERSIBILIDADE contra o banco: dar um credito publicavel a pessoa 202
    // (ela ja tem bio liberada e foto) a torna elegivel sem nenhum deploy.
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
      Number(meta[0]?.n) === SEEDED,
      `${meta[0]?.n}/${SEEDED}`,
    )

    // ---- (7) o dado que faltava volta -> a pagina volta a indexar -----
    // O episodio 502 nao indexava por falta de sinopse. Preencher a COLUNA e o
    // unico passo: nenhuma mudanca de codigo, nenhum deploy.
    await prisma.$executeRawUnsafe(
      `UPDATE episodes SET overview = 'Sinopse chegou na Fase 5.' WHERE id = 502`,
    )
    const reversal = await produceIndexabilityDecisions(prisma, {
      language: 'pt-BR',
      dryRun: false,
      now,
    })
    const ep502 = await q<{ decision: string; reason: string }>(
      `SELECT decision::text AS decision, reason FROM page_indexability_decisions
        WHERE entity_type='episode' AND entity_id=502 AND is_current`,
    )
    record(
      'preencher a sinopse devolve o episodio ao indice (dirigido a dado)',
      reversal.written === 1 && ep502[0]?.decision === 'index',
      `gravadas=${reversal.written} decisao=${ep502[0]?.decision} (${ep502[0]?.reason})`,
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
