/**
 * validate-index-decisions-cli-real-postgres.ts — A CLI `catalog
 * index-decisions` executada de ponta a ponta contra PostgreSQL 16 real.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * POR QUE ESTE ARQUIVO EXISTE (e por que os que ja existiam nao bastavam)
 * -----------------------------------------------------------------------
 * `validate-indexability-producer-real-postgres.ts` prova o PRODUTOR: chama
 * `produceIndexabilityDecisions({ dryRun: true })` e verifica que nada e
 * gravado. O docstring dele chega a dizer "`--dry-run` nao escreve nada" — mas
 * ele nunca passou por `--dry-run`. Chamou a funcao.
 *
 * Em 2026-08-27, contra producao, a FLAG fazia outra coisa:
 *
 *     $ pnpm catalog index-decisions --dry-run --json --confirm-production-read
 *     {"dryRun":true,"command":"index-decisions","plan":["index-decisions: sem efeito colateral"]}
 *
 * O `bin/` desviava `--dry-run` antes do dispatch e o produtor — testado, correto,
 * com censo completo — nunca era chamado. Dois validadores verdes, um comando
 * inutil: a distancia entre "a funcao honra dryRun" e "a flag honra dryRun".
 *
 * Entao este arquivo executa o BINARIO, com as FLAGS, contra um banco de
 * verdade, e afirma sobre o que sai no stdout e sobre o que sobra no banco.
 *
 * O QUE PROVA
 * -----------
 *   1. `--dry-run --json` devolve um CENSO real (contagens que batem com o
 *      fixture), e nao o plano generico;
 *   2. `--dry-run` nao grava NADA (a tabela continua vazia depois);
 *   3. o exit code do dry-run acompanha o freio: 5 quando bloquearia, 0 quando nao;
 *   4. `--entity movie --apply` grava SO decisoes de filme — nenhuma linha de
 *      serie, temporada, episodio ou pessoa aparece;
 *   5. e, por consequencia de (4), o gate do SITEMAP de serie continua
 *      DESARMADO: a aplicacao por tipo e de fato isolada.
 *
 * Uso: pnpm --filter @screena/ingestion validate:index-decisions-cli
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { SITEMAP_DECISION_GATE_MIN_ROWS } from '../../../apps/web/src/server/seo/sitemap-index.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')
const catalogBin = path.join(ingestionDir, 'bin', 'catalog.ts')

const LANGUAGE = 'pt-BR'

/**
 * Filmes do fixture. Acima de `SITEMAP_DECISION_GATE_MIN_ROWS` de proposito:
 * so assim a aplicacao por tipo consegue ARMAR o gate de filme, que e a metade
 * interessante do check de isolamento — armar um e nao armar o outro.
 */
const FILMES = SITEMAP_DECISION_GATE_MIN_ROWS + 20
/** Quantos deles nascem SEM sinopse (viram `noindex` por `no_synopsis`). */
const FILMES_SEM_SINOPSE = 300
const SERIES = 40

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

/** Primeira linha da mensagem de erro (split devolve string | undefined). */
function primeiraLinha(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.split('\n')[0] ?? msg
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  // noUncheckedIndexedAccess: acesso indexado devolve string | undefined.
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

function tsxBin(): string {
  const pkgPath = require.resolve('tsx/package.json')
  return path.join(path.dirname(pkgPath), 'dist', 'cli.mjs')
}

interface CliRun {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** Executa a CLI DE VERDADE contra o banco efemero. */
function runCatalog(databaseUrl: string, args: readonly string[]): CliRun {
  const result = spawnSync(process.execPath, [tsxBin(), catalogBin, ...args], {
    cwd: ingestionDir,
    encoding: 'utf8',
    timeout: 300_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      // NAO `production`: o gate de producao exigiria --confirm-production-read
      // e --force, e o que se mede aqui e o comando, nao o gate.
      NODE_ENV: 'test',
    },
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** A ULTIMA linha de stdout que faz parse como objeto JSON. */
function parseJsonStdout(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Fixture: `FILMES` filmes completos (dos quais `FILMES_SEM_SINOPSE` sem
 * sinopse) e `SERIES` series completas. Todos com slug, titulo, traducao e
 * poster — os gates que a politica cobra.
 */
async function seed(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('${LANGUAGE}','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)

  await run(`INSERT INTO movies (tmdb_id, title_original, poster_path, updated_at)
             SELECT 98000000 + g, 'Filme ' || g, '/p' || g || '.jpg', NOW()
               FROM generate_series(1, ${FILMES}) g`)
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at)
             SELECT 'movie', m.id, '${LANGUAGE}', 'filme-' || m.tmdb_id, true, NOW()
               FROM movies m`)
  // A sinopse mora em `entity_translations.summary`. Os primeiros
  // `FILMES_SEM_SINOPSE` recebem a linha de traducao SEM summary: e exatamente a
  // populacao do censo de producao ("sem_sinopse"), que e o maior balde do
  // catalogo real.
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at)
             SELECT 'movie', m.id, '${LANGUAGE}', 'Filme ' || m.tmdb_id,
                    -- Corte com menor-ou-igual: os ids comecam em 98000001
                    -- (generate_series de 1), entao o menor-estrito produziria
                    -- 299 e nao 300 e o teste reprovaria a propria aritmetica.
                    CASE WHEN m.tmdb_id <= 98000000 + ${FILMES_SEM_SINOPSE}
                         THEN NULL ELSE 'Sinopse propria do filme.' END, NOW()
               FROM movies m`)

  await run(`INSERT INTO tv_shows (tmdb_id, name_original, poster_path, updated_at)
             SELECT 99000000 + g, 'Serie ' || g, '/s' || g || '.jpg', NOW()
               FROM generate_series(1, ${SERIES}) g`)
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at)
             SELECT 'tv', t.id, '${LANGUAGE}', 'serie-' || t.tmdb_id, true, NOW()
               FROM tv_shows t`)
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at)
             SELECT 'tv', t.id, '${LANGUAGE}', 'Serie ' || t.tmdb_id, 'Sinopse propria da serie.', NOW()
               FROM tv_shows t`)
}

async function contarPorTipo(prisma: PrismaClient): Promise<Record<string, number>> {
  const rows = await prisma.$queryRawUnsafe<{ entity_type: string; n: bigint }[]>(
    `SELECT entity_type::text AS entity_type, COUNT(*)::bigint AS n
       FROM page_indexability_decisions
      WHERE is_current AND language_code = $1
      GROUP BY 1`,
    LANGUAGE,
  )
  const out: Record<string, number> = {}
  for (const row of rows) out[row.entity_type] = Number(row.n)
  return out
}

async function runChecks(prisma: PrismaClient, url: string): Promise<void> {
  // ---- (0) CONTROLE POSITIVO: o fixture existe ---------------------------
  const filmes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM movies`,
  )
  record(
    'CONTROLE POSITIVO: o fixture tem filmes acima do piso do gate do sitemap',
    Number(filmes[0]?.n ?? 0) === FILMES && FILMES > SITEMAP_DECISION_GATE_MIN_ROWS,
    `filmes=${Number(filmes[0]?.n ?? 0)} · piso=${SITEMAP_DECISION_GATE_MIN_ROWS}`,
  )

  // ---- (1) O CENSO DO DRY-RUN --------------------------------------------
  // Tetos frouxos: aqui se mede o CENSO, nao o freio (o freio tem check proprio
  // logo abaixo). Sem afrouxar, `null -> noindex` em 300 filmes bloquearia.
  const dry = runCatalog(url, [
    'index-decisions',
    '--dry-run',
    '--json',
    '--max-flips',
    '100000',
    '--max-flip-percent',
    '100',
  ])
  const censo = parseJsonStdout(dry.stdout)

  record(
    'o --dry-run devolve JSON com censo (e nao o plano generico)',
    censo !== null && censo.plan === undefined && typeof censo.evaluated === 'number',
    censo === null ? `stdout nao e JSON: ${dry.stdout.slice(0, 120)}` : `chaves=${Object.keys(censo).join(',')}`,
  )

  // O NUMERO tem de bater com o fixture. Um censo que sai preenchido mas com
  // contagens erradas passaria no check acima e mentiria igual.
  const esperado = FILMES + SERIES
  record(
    'as contagens do censo batem com o fixture (nao e censo vazio nem inventado)',
    censo?.evaluated === esperado,
    `evaluated=${String(censo?.evaluated)} (esperado ${esperado})`,
  )

  const porTipoCenso = (censo?.byEntityType ?? {}) as Record<
    string,
    { evaluated?: number; byDecision?: Record<string, number>; writes?: Record<string, number> }
  >
  record(
    'o censo separa por TIPO de entidade',
    porTipoCenso.movie?.evaluated === FILMES && porTipoCenso.tv?.evaluated === SERIES,
    `movie=${String(porTipoCenso.movie?.evaluated)} · tv=${String(porTipoCenso.tv?.evaluated)}`,
  )

  // O balde `no_synopsis` do fixture reaparece no censo, no tipo certo: e a
  // prova de que a razao agregada e real e nao um rotulo generico.
  record(
    'o censo traz o veredito e o motivo por tipo (filmes sem sinopse viram noindex)',
    porTipoCenso.movie?.byDecision?.noindex === FILMES_SEM_SINOPSE &&
      porTipoCenso.movie?.byDecision?.index === FILMES - FILMES_SEM_SINOPSE,
    `movie noindex=${String(porTipoCenso.movie?.byDecision?.noindex)} · index=${String(
      porTipoCenso.movie?.byDecision?.index,
    )}`,
  )

  // Criadas x alteradas: a tabela esta vazia, entao TODAS nascem.
  record(
    'o censo separa criadas de alteradas (tabela vazia => tudo `created`)',
    porTipoCenso.movie?.writes?.created === FILMES && porTipoCenso.movie?.writes?.updated === 0,
    `created=${String(porTipoCenso.movie?.writes?.created)} · updated=${String(
      porTipoCenso.movie?.writes?.updated,
    )}`,
  )

  // ---- (2) O DRY-RUN NAO GRAVA -------------------------------------------
  const depoisDoDry = await contarPorTipo(prisma)
  record(
    'o --dry-run nao gravou NENHUMA linha',
    Object.keys(depoisDoDry).length === 0,
    `linhas=${JSON.stringify(depoisDoDry)}`,
  )

  // ---- (3) O EXIT CODE DO DRY-RUN ACOMPANHA O FREIO ----------------------
  record(
    'dry-run com tetos folgados sai 0',
    dry.status === 0,
    `exit=${String(dry.status)}`,
  )

  const freado = runCatalog(url, [
    'index-decisions',
    '--dry-run',
    '--json',
    '--max-flips',
    '5',
    '--max-flip-percent',
    '100',
  ])
  record(
    'dry-run que BLOQUEARIA sai 5 (o code que o help promete)',
    freado.status === 5,
    `exit=${String(freado.status)}`,
  )
  const censoFreado = parseJsonStdout(freado.stdout)
  record(
    'o dry-run bloqueado ainda entrega o censo (o freio nao apaga a informacao)',
    censoFreado !== null &&
      (censoFreado.massChange as { blocked?: boolean } | undefined)?.blocked === true &&
      censoFreado.evaluated === esperado,
    `blocked=${String((censoFreado?.massChange as { blocked?: boolean } | undefined)?.blocked)}`,
  )
  const semFreio = await contarPorTipo(prisma)
  record(
    'nada foi gravado tambem no caminho bloqueado',
    Object.keys(semFreio).length === 0,
    `linhas=${JSON.stringify(semFreio)}`,
  )

  // ---- (4) --entity movie --apply grava SO filme -------------------------
  const aplicado = runCatalog(url, [
    'index-decisions',
    '--entity',
    'movie',
    '--apply',
    '--json',
    '--max-flips',
    '100000',
    '--max-flip-percent',
    '100',
  ])
  record('a aplicacao por tipo sai 0', aplicado.status === 0, `exit=${String(aplicado.status)}`)

  const porTipo = await contarPorTipo(prisma)
  record(
    '--entity movie --apply grava SO decisoes de filme',
    porTipo.movie === FILMES && Object.keys(porTipo).length === 1,
    `no banco: ${JSON.stringify(porTipo)}`,
  )

  // ---- (5) O ISOLAMENTO DO GATE DO SITEMAP -------------------------------
  // A pergunta operacional: cortar por filme ARMA o gate de serie sem querer?
  // A cobertura e contada POR TIPO, entao a resposta tem de ser nao — e quem
  // responde e o banco, contando as linhas que existem.
  const coberturaFilme = porTipo.movie ?? 0
  const coberturaSerie = porTipo.tv ?? 0
  record(
    'o gate do sitemap de FILME arma (cobertura acima do piso)',
    coberturaFilme >= SITEMAP_DECISION_GATE_MIN_ROWS,
    `movie=${coberturaFilme} >= ${SITEMAP_DECISION_GATE_MIN_ROWS}`,
  )
  record(
    'o gate do sitemap de SERIE continua DESARMADO (a serie nao foi tocada)',
    coberturaSerie < SITEMAP_DECISION_GATE_MIN_ROWS && coberturaSerie === 0,
    `tv=${coberturaSerie} < ${SITEMAP_DECISION_GATE_MIN_ROWS}`,
  )

  // ---- (6) SEM CHURN: reexecutar nao grava de novo -----------------------
  const reexecucao = runCatalog(url, [
    'index-decisions',
    '--entity',
    'movie',
    '--apply',
    '--json',
    '--max-flips',
    '100000',
    '--max-flip-percent',
    '100',
  ])
  const censoReexec = parseJsonStdout(reexecucao.stdout)
  const depois = await contarPorTipo(prisma)
  record(
    'reexecutar o mesmo --apply nao cria linha nova (sem churn)',
    censoReexec?.written === 0 && depois.movie === FILMES,
    `written=${String(censoReexec?.written)} · linhas=${depois.movie ?? 0}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-idcli-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_idcli?schema=public`
  console.log(
    `\n=== Postgres efemero (embedded) :${port} | postgresql://postgres:****@127.0.0.1:${port}/cinerie_idcli ===\n`,
  )

  let started = false
  let prisma: PrismaClient | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_idcli')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })

    prisma = new PrismaClient({ datasources: { db: { url } } })
    await seed(prisma)
    await runChecks(prisma, url)
  } catch (e) {
    record('execucao', false, primeiraLinha(e))
    console.error(e)
  } finally {
    if (prisma !== undefined) await prisma.$disconnect()
    if (started) await pg.stop()
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch (e) {
      console.warn(`Aviso: dir temporario nao removido agora (${primeiraLinha(e)}).`)
    }
    console.log('\n=== Postgres efemero derrubado ===')
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK.`)
  if (passed !== total) {
    process.exit(1)
  }
  console.log(
    'Resultado: PASSOU. O --dry-run pre-checa de verdade e a aplicacao por --entity e isolada.',
  )
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
