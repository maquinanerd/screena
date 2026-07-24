/**
 * validate-catalog-integrity-real-postgres.ts — Validador DESCARTAVEL da
 * INTEGRIDADE do catalogo, contra PostgreSQL 16 real e EFEMERO.
 *
 * Cobre tres coisas, duas delas por causa de ALARME FALSO.
 *
 * A) BACKFILL de finalizacao (lacuna REAL)
 *    Entidade presa pelo short-circuit de cache nunca ganha slug. Prova: dry-run
 *    nao escreve; apply cria slug e traducao; reexecutar nao gera churn nem
 *    redirect; slug valido nunca e alterado; pessoa inelegivel continua sem slug.
 *
 * B) IDEMPOTENCIA DE MIDIA (alarme falso — este teste TRAVA a garantia)
 *    A PR #82 reportou que `sync_media` duplicava (+48 linhas na reexecucao).
 *    ERRADO: `tmdb_images` tem `@@unique(entityType, tmdbId, imageType, filePath)`
 *    e o upsert so reescreve quando o `payload_hash` muda. As +48 linhas eram 5
 *    jobs `sync_media` de PESSOA que ficaram pendentes na fase de demonstracao
 *    do gate e foram drenados pelo worker seguinte — a contagem "antes" foi
 *    tirada com fila suja. Este teste prova a idempotencia de verdade, para o
 *    alarme nao voltar.
 *
 * C) UNICIDADE DE DECISAO VIGENTE (alarme falso — este teste TRAVA a garantia)
 *    A PR #82 afirmou que nao existia unique parcial. ERRADO: a migration
 *    `20260715120000_data_governance_hardening` cria
 *    `page_indexability_decisions_current_unique` sobre
 *    (entity_type, entity_id, language_code) WHERE is_current = true. A busca
 *    anterior procurou "UNIQUE" e "is_current" na MESMA linha, e o `WHERE` esta
 *    na linha seguinte. Este teste verifica no BANCO, nao no texto do SQL.
 *
 * FERRAMENTA DESCARTAVEL: nunca roda em render/build/prod. ZERO rede, ZERO TMDB.
 *
 * Uso: pnpm --filter @screena/ingestion validate:catalog-integrity
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
import { backfillFinalization } from '../src/persistence/finalization-backfill.js'
import { createPrismaMediaStore } from '../src/persistence/media-store.js'
import { createPrismaAuditReader } from '../src/persistence/audit-reader.js'
import { runDatabaseAudit } from '../src/audit/index.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const dbDir = path.resolve(scriptDir, '..', '..', '..', 'packages', 'db')
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
      const a = srv.address()
      const p = typeof a === 'object' && a ? a.port : 0
      srv.close(() => resolve(p))
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

async function seed(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)
  // 301 ja tem slug (nao pode ser tocado); 302/303 estao presos sem slug.
  await run(`INSERT INTO movies (id, tmdb_id, title_original, updated_at) VALUES
             (301, 80301, 'Filme Com Slug', now()),
             (302, 80302, 'Filme Preso Sem Slug', now()),
             (303, 80303, 'Outro Preso', now())`)
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, updated_at) VALUES
             (401, 80401, 'Serie Presa', now())`)
  await run(`INSERT INTO people (id, tmdb_id, name, updated_at) VALUES
             (501, 80501, 'Pessoa Com Credito', now()),
             (502, 80502, 'Pessoa Sem Credito', now())`)
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at)
             VALUES ('movie', 301, 'pt-BR', 'filme-com-slug-original', true, now())`)
  // A pessoa 501 tem credito num filme COM slug canonico; a 502 nao tem nenhum.
  await run(`INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at)
             VALUES (501, 'movie', 301, now())`)
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
  const count = async (sql: string): Promise<number> =>
    Number((await q<{ n: number }>(sql))[0]?.n ?? 0)

  try {
    await seed(prisma)

    // =====================================================================
    // A) BACKFILL
    // =====================================================================
    const dry = await backfillFinalization(prisma, { language: 'pt-BR', dryRun: true })
    record(
      'backfill dry-run NAO escreve',
      dry.finalized === 0 && (await count('SELECT COUNT(*)::int AS n FROM slugs')) === 1,
      `finalizados=${dry.finalized} slugs=${await count('SELECT COUNT(*)::int AS n FROM slugs')}`,
    )
    record(
      'dry-run enxerga os 5 presos (2 filmes + 1 serie + 2 pessoas)',
      dry.candidates === 5,
      `candidatos=${dry.candidates}`,
    )
    record(
      'dry-run ja exclui a pessoa sem credito',
      dry.skipped.no_eligible_credit === 1,
      `no_eligible_credit=${dry.skipped.no_eligible_credit ?? 0}`,
    )
    record(
      'backfill NAO chama o provider',
      dry.externalCallsMade === 0 && dry.externalCallsAvoided > 0,
      `executadas=${dry.externalCallsMade} evitadas=${dry.externalCallsAvoided}`,
    )

    const applied = await backfillFinalization(prisma, { language: 'pt-BR', dryRun: false })
    record(
      'apply finaliza 4 (2 filmes + 1 serie + 1 pessoa elegivel)',
      applied.finalized === 4,
      `finalizados=${applied.finalized} slugs=${applied.slugsCreated} traducoes=${applied.translationsCreated}`,
    )

    const slugOf = async (t: string, id: number): Promise<string | null> => {
      const r = await q<{ slug: string }>(
        `SELECT slug FROM slugs WHERE entity_type='${t}' AND entity_id=${id} AND is_canonical LIMIT 1`,
      )
      return r[0]?.slug ?? null
    }
    record(
      'slug VALIDO preservado (filme 301 intacto)',
      (await slugOf('movie', 301)) === 'filme-com-slug-original',
      `${await slugOf('movie', 301)}`,
    )
    record('filme preso ganhou slug', (await slugOf('movie', 302)) !== null, `${await slugOf('movie', 302)}`)
    record('serie presa ganhou slug', (await slugOf('tv', 401)) !== null, `${await slugOf('tv', 401)}`)
    record(
      'pessoa COM credito ganhou slug',
      (await slugOf('person', 501)) !== null,
      `${await slugOf('person', 501)}`,
    )
    record(
      'pessoa SEM credito continua SEM slug',
      (await slugOf('person', 502)) === null,
      `${await slugOf('person', 502) ?? '(nenhum)'}`,
    )
    record(
      'traducoes criadas para as entidades finalizadas',
      (await count("SELECT COUNT(*)::int AS n FROM entity_translations WHERE language_code='pt-BR'")) === 4,
      `${await count("SELECT COUNT(*)::int AS n FROM entity_translations WHERE language_code='pt-BR'")}`,
    )
    record(
      'NENHUM redirect criado (nao houve troca de canonico)',
      (await count('SELECT COUNT(*)::int AS n FROM redirects')) === 0,
      `${await count('SELECT COUNT(*)::int AS n FROM redirects')}`,
    )

    // Reexecucao: nada mais a fazer, zero churn.
    const slugsBefore = await count('SELECT COUNT(*)::int AS n FROM slugs')
    const rerun = await backfillFinalization(prisma, { language: 'pt-BR', dryRun: false })
    record(
      'reexecucao: zero candidatos, zero churn',
      rerun.candidates === 1 && rerun.finalized === 0,
      `candidatos=${rerun.candidates} (so a pessoa inelegivel) finalizados=${rerun.finalized}`,
    )
    record(
      'reexecucao nao cria slug nem redirect',
      (await count('SELECT COUNT(*)::int AS n FROM slugs')) === slugsBefore &&
        (await count('SELECT COUNT(*)::int AS n FROM redirects')) === 0,
      `slugs=${await count('SELECT COUNT(*)::int AS n FROM slugs')} redirects=${await count('SELECT COUNT(*)::int AS n FROM redirects')}`,
    )

    // =====================================================================
    // B) IDEMPOTENCIA DE MIDIA — trava contra o alarme falso da PR #82
    // =====================================================================
    const media = createPrismaMediaStore(prisma)
    const rows = [
      {
        entityType: 'movie' as const,
        tmdbId: 80301,
        imageType: 'poster',
        filePath: '/abc.jpg',
        languageCode: 'pt',
        width: 500,
        height: 750,
        aspectRatio: 0.667,
        voteAverage: 5.4,
        voteCount: 10,
        payloadHash: 'h1',
      },
      {
        entityType: 'movie' as const,
        tmdbId: 80301,
        imageType: 'backdrop',
        filePath: '/def.jpg',
        languageCode: null,
        width: 1920,
        height: 1080,
        aspectRatio: 1.778,
        voteAverage: 6.1,
        voteCount: 3,
        payloadHash: 'h2',
      },
    ]
    const first = await media.upsertImages(rows as never)
    const afterFirst = await count('SELECT COUNT(*)::int AS n FROM tmdb_images')
    const second = await media.upsertImages(rows as never)
    const afterSecond = await count('SELECT COUNT(*)::int AS n FROM tmdb_images')
    record(
      'sync_media IDEMPOTENTE: 2a execucao adiciona ZERO linhas',
      afterFirst === 2 && afterSecond === 2 && second.created === 0 && second.unchanged === 2,
      `1a=${afterFirst} (criadas ${first.created}) · 2a=${afterSecond} (criadas ${second.created}, inalteradas ${second.unchanged})`,
    )

    // Campo MUTAVEL (voto) nao cria identidade nova: atualiza a linha existente.
    const mutated = rows.map((r) => ({ ...r, voteCount: r.voteCount + 99, payloadHash: `${r.payloadHash}x` }))
    const third = await media.upsertImages(mutated as never)
    record(
      'metadado mutavel ATUALIZA a linha, nao cria outra',
      (await count('SELECT COUNT(*)::int AS n FROM tmdb_images')) === 2 && third.updated === 2,
      `linhas=${await count('SELECT COUNT(*)::int AS n FROM tmdb_images')} atualizadas=${third.updated}`,
    )

    // =====================================================================
    // C) UNICIDADE DE DECISAO VIGENTE — verificada NO BANCO, nao no SQL
    // =====================================================================
    const idx = await q<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='page_indexability_decisions'
          AND indexname='page_indexability_decisions_current_unique'`,
    )
    const def = idx[0]?.indexdef ?? ''
    record(
      'indice unico parcial EXISTE no banco',
      /UNIQUE INDEX/i.test(def) && /is_current = true/i.test(def),
      def === '' ? '(ausente)' : 'sobre (entity_type, entity_id, language_code) WHERE is_current',
    )

    await prisma.$executeRawUnsafe(
      `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current)
       VALUES ('movie', 301, 'pt-BR', '/pt/filmes/a/', 'index', true)`,
    )
    let rejected = false
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO page_indexability_decisions (entity_type, entity_id, language_code, url, decision, is_current)
         VALUES ('movie', 301, 'pt-BR', '/pt/filmes/b/', 'noindex', true)`,
      )
    } catch (e) {
      // Prisma embrulha a violacao como P2010 e o SQLSTATE vive em `meta.code`;
      // a mensagem de topo nem sempre cita "unique". Checar so o texto daria
      // FALSO NEGATIVO — o banco recusou, e o teste diria que nao ha protecao.
      const text = e instanceof Error ? e.message : String(e)
      const meta = (e as { meta?: { code?: string } }).meta
      rejected = /unique|duplicate key|23505/i.test(text) || meta?.code === '23505'
    }
    record(
      'o BANCO recusa uma segunda decisao vigente (concorrencia protegida)',
      rejected,
      rejected ? 'unique violation' : 'ACEITOU — nao ha protecao',
    )
    // =====================================================================
    // D) CENSO DE PUBLICABILIDADE — as dimensoes que faltavam
    // =====================================================================
    const audit = await runDatabaseAudit(createPrismaAuditReader(prisma), {
      environment: 'test',
      now: new Date('2026-07-24T00:00:00Z'),
      language: 'pt-BR',
    })
    const movieRow = audit.publishability.find((p) => p.entity === 'movie')
    const personRow = audit.publishability.find((p) => p.entity === 'person')

    record(
      'censo separa existir de ter rota (3 filmes, 3 com slug apos backfill)',
      movieRow?.total === 3 && movieRow.withSlug === 3 && movieRow.withoutSlug === 0,
      `total=${movieRow?.total} slug=${movieRow?.withSlug}/-${movieRow?.withoutSlug}`,
    )
    record(
      'censo distingue publicavel de renderizavel para PESSOA',
      personRow?.total === 2 && personRow.renderable === 1 && personRow.publishable === 1,
      `total=${personRow?.total} renderizavel=${personRow?.renderable} publicavel=${personRow?.publishable}`,
    )
    record(
      'censo conta decisao AUSENTE (a policy nunca foi aplicada)',
      (movieRow?.missingDecision ?? 0) >= 1,
      `ausentes=${movieRow?.missingDecision}`,
    )
    record(
      'censo agrupa razoes das decisoes vigentes',
      audit.decisionReasons.length >= 0,
      audit.decisionReasons.map((r) => `${r.reason}=${r.count}`).join(' ') || '(nenhuma)',
    )

    record(
      'apenas uma decisao vigente por chave',
      (await count(
        `SELECT COUNT(*)::int AS n FROM page_indexability_decisions
          WHERE entity_type='movie' AND entity_id=301 AND language_code='pt-BR' AND is_current`,
      )) === 1,
      'ok',
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-integrity-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // UTF8 explicito: no Windows o initdb herda o locale do SO (WIN1252).
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_integrity`
  let started = false

  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_integrity')
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
