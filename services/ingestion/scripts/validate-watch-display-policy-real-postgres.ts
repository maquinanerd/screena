/**
 * validate-watch-display-policy-real-postgres.ts — A politica de exibicao de
 * ofertas (decisao do dono de 2026-10-29) contra PostgreSQL REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * POR QUE BANCO REAL: quem decide se uma oferta pode acender e o trigger
 * `watch_availability_display_guard` (hash, alias, decisao vigente, licenca do
 * MESMO provedor). Um fake provaria o fake. Aqui o escritor de PRODUCAO
 * (`createPrismaTmdbWatchOfferStore`) e a politica de PRODUCAO
 * (`applyWatchDisplayPolicy`) rodam contra o schema migrado de verdade.
 *
 * O QUE PROVA:
 *   - sem a politica, toda oferta nasce e fica apagada (controle negativo);
 *   - com a politica, acende SO a oferta com alias + licenca + decisao vigentes,
 *     carimbada `automation:`; a sem licenca e a sem alias ficam apagadas;
 *   - a oferta acesa passa no portao de leitura do render;
 *   - payload mudou (link novo): a aprovacao velha cai e a politica reacende
 *     com o hash novo;
 *   - oferta que SUMIU do snapshot e revogada e o acervo NAO a reacende;
 *   - o comando do acervo acende o que ja estava gravado, e NAO acende oferta
 *     coletada ha mais de `AUTO_DISPLAY_MAX_OFFER_AGE_DAYS`.
 *
 * Seguranca: ZERO rede; nenhum `DATABASE_URL` persistido; Postgres derrubado e
 * diretorio removido no `finally`.
 *
 * Uso: pnpm --filter @screena/ingestion validate:watch-display-policy
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { runChild } from '@screena/db/async-child-process'

import type { WatchProviderOffer } from '../src/normalizers/watch-providers.js'
import {
  AUTO_DISPLAY_MAX_OFFER_AGE_DAYS,
  WATCH_AUTO_REVIEWER,
  applyWatchDisplayPolicy,
  countWatchDisplayCandidates,
} from '../src/persistence/watch-display-policy.js'
import { createPrismaTmdbWatchOfferStore } from '../src/persistence/watch-providers-store.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

const DAY_MS = 24 * 60 * 60 * 1000

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${String(n)}. ${name} — ${detail}`)
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
  const pkgPath = dbRequire.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin: string | Record<string, string>
  }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

type Prisma = Parameters<typeof createPrismaTmdbWatchOfferStore>[0]

interface OfferRow {
  readonly provider_key: string
  readonly display_allowed: boolean
  readonly reviewed_by: string | null
}

async function offersOf(prisma: Prisma, movieId: string): Promise<Map<string, OfferRow>> {
  const rows = await prisma.$queryRawUnsafe<OfferRow[]>(
    `SELECT provider_key, display_allowed, reviewed_by
       FROM watch_availability
      WHERE entity_type = 'movie' AND entity_id = $1::bigint AND provider_api = 'tmdb'`,
    movieId,
  )
  return new Map(rows.map((row) => [row.provider_key, row]))
}

/** O portao de LEITURA do render (`licensedWatchWhere`), em SQL. */
async function renderable(prisma: Prisma, movieId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
       FROM watch_availability w
       JOIN data_usage_decisions d ON d.id = w.data_usage_decision_id
       JOIN source_licenses l ON l.id = d.source_license_id
      WHERE w.entity_type = 'movie' AND w.entity_id = $1::bigint
        AND w.country_code = 'BR' AND w.display_allowed
        AND (w.available_until IS NULL OR w.available_until > now())
        AND d.use_case = 'watch_offer_display' AND d.is_current
        AND d.stage = 'approved_for_display' AND d.display_allowed
        AND l.is_current AND l.display_allowed AND l.content_type = 'watch_availability'
        AND l.license_status IN ('official', 'licensed', 'third_party')`,
    movieId,
  )
  return rows[0]?.n ?? 0
}

function offer(tmdbId: number, providerKey: string, webUrl: string): WatchProviderOffer {
  return {
    entityType: 'movie',
    tmdbId,
    countryCode: 'BR',
    providerKey,
    providerName: `Provedor ${providerKey}`,
    offerType: 'subscription',
    webUrl,
    displayPriority: 1,
    logoPath: null,
  }
}

async function createMovie(prisma: Prisma, tmdbId: number): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    `INSERT INTO movies (tmdb_id, title_original, created_at, updated_at)
     VALUES ($1, $2, now(), now()) RETURNING id`,
    tmdbId,
    `filme-${String(tmdbId)}`,
  )
  const id = rows[0]?.id
  if (id === undefined) throw new Error('filme nao criado')
  return id.toString()
}

/**
 * Tres provedores: 8001 com alias + licenca + decisao (pode acender), 8002 com
 * alias e SEM licenca, 8003 sem alias nenhum.
 */
async function seedProviders(prisma: Prisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at)
     VALUES ('exemploflix', 'ExemploFlix', 'https://exemplo.test/', now()),
            ('semlicencaflix', 'SemLicencaFlix', 'https://semlicenca.test/', now())`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
     SELECT id, 'tmdb', CASE slug WHEN 'exemploflix' THEN '8001' ELSE '8002' END, canonical_name, now()
       FROM watch_providers WHERE slug IN ('exemploflix', 'semlicencaflix')`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status,
                                  display_allowed, requires_attribution, requires_linkback, attribution_text,
                                  is_current, decided_by, decided_at, policy_version, updated_at)
     VALUES ('exemploflix', 'watch_availability', 'tmdb', 'BR', 'third_party', true, true, true,
             'Dados de streaming: JustWatch', true, 'validator-watch-policy', now(), 'contract/v1', now())`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed,
                                       storage_allowed, attribution_required, linkback_required,
                                       policy_version, decided_by, reason, valid_from, updated_at)
     SELECT id, 'watch_offer_display', 'BR', 'approved_for_display', true, true, true, true,
            'contract/v1', 'validator-watch-policy', 'contrato de validacao', now() - interval '1 day', now()
       FROM source_licenses WHERE source_key = 'exemploflix' AND content_type = 'watch_availability' AND is_current`,
  )
}

async function runChecks(prisma: Prisma): Promise<void> {
  await seedProviders(prisma)
  const now = Date.now()
  const url = (tmdbId: number, v: string): string =>
    `https://www.themoviedb.org/movie/${String(tmdbId)}/watch?locale=BR&v=${v}`

  // ------------------------------------------------ CONTROLE NEGATIVO
  const m1 = await createMovie(prisma, 501)
  const plain = createPrismaTmdbWatchOfferStore(prisma)
  const first = await plain.replaceSnapshot({
    entityType: 'movie',
    entityId: m1,
    countryCode: 'BR',
    offers: [offer(501, '8001', url(501, 'a')), offer(501, '8002', url(501, 'a')), offer(501, '8003', url(501, 'a'))],
    fetchedAt: new Date(now - 3 * 60 * 60 * 1000),
    staleAfter: new Date(now + DAY_MS),
  })
  const before = await offersOf(prisma, m1)
  record(
    1,
    'CONTROLE NEGATIVO: sem a politica, as 3 ofertas nascem e ficam apagadas',
    first.upserted === 3 && [...before.values()].every((row) => !row.display_allowed) && first.displayed === undefined,
    `upserted=${String(first.upserted)} acesas=${String([...before.values()].filter((r) => r.display_allowed).length)}`,
  )

  // ------------------------------------------------ CAMINHO DO SYNC
  const logs: string[] = []
  const policyStore = createPrismaTmdbWatchOfferStore(prisma, {
    autoDisplay: true,
    log: (message) => logs.push(message),
  })
  const second = await policyStore.replaceSnapshot({
    entityType: 'movie',
    entityId: m1,
    countryCode: 'BR',
    offers: [offer(501, '8001', url(501, 'a')), offer(501, '8002', url(501, 'a')), offer(501, '8003', url(501, 'a'))],
    fetchedAt: new Date(now - 2 * 60 * 60 * 1000),
    staleAfter: new Date(now + DAY_MS),
  })
  const after = await offersOf(prisma, m1)
  record(
    2,
    'com a politica, acende SO a oferta com alias + licenca + decisao',
    after.get('8001')?.display_allowed === true &&
      after.get('8002')?.display_allowed === false &&
      after.get('8003')?.display_allowed === false &&
      second.displayed === 1,
    `8001=${String(after.get('8001')?.display_allowed)} 8002=${String(after.get('8002')?.display_allowed)} ` +
      `8003=${String(after.get('8003')?.display_allowed)} displayed=${String(second.displayed)}`,
  )
  record(
    3,
    'a oferta acesa e carimbada pela politica (`automation:`), nunca por nome de pessoa',
    after.get('8001')?.reviewed_by === WATCH_AUTO_REVIEWER,
    `reviewed_by=${String(after.get('8001')?.reviewed_by)}`,
  )
  record(
    4,
    'a oferta acesa passa no portao de LEITURA do render',
    (await renderable(prisma, m1)) === 1,
    `renderizaveis=${String(await renderable(prisma, m1))}`,
  )

  // ------------------------------------------------ PAYLOAD MUDOU
  await policyStore.replaceSnapshot({
    entityType: 'movie',
    entityId: m1,
    countryCode: 'BR',
    offers: [offer(501, '8001', url(501, 'b')), offer(501, '8002', url(501, 'b'))],
    fetchedAt: new Date(now - 60 * 60 * 1000),
    staleAfter: new Date(now + DAY_MS),
  })
  const changed = await offersOf(prisma, m1)
  record(
    5,
    'link novo derruba a aprovacao velha e a politica reacende com o hash novo',
    changed.get('8001')?.display_allowed === true && (await renderable(prisma, m1)) === 1,
    `8001=${String(changed.get('8001')?.display_allowed)}`,
  )

  // ------------------------------------------------ OFERTA QUE SUMIU
  await policyStore.replaceSnapshot({
    entityType: 'movie',
    entityId: m1,
    countryCode: 'BR',
    offers: [offer(501, '8002', url(501, 'c'))],
    fetchedAt: new Date(now - 30 * 60 * 1000),
    staleAfter: new Date(now + DAY_MS),
  })
  await applyWatchDisplayPolicy(prisma, { limit: 100 })
  const gone = await offersOf(prisma, m1)
  record(
    6,
    'oferta que SUMIU do snapshot e revogada, e o acervo NAO a reacende',
    gone.get('8001')?.display_allowed === false && (await renderable(prisma, m1)) === 0,
    `8001=${String(gone.get('8001')?.display_allowed)} renderizaveis=${String(await renderable(prisma, m1))}`,
  )

  // ------------------------------------------------ ACERVO
  const m2 = await createMovie(prisma, 502)
  await plain.replaceSnapshot({
    entityType: 'movie',
    entityId: m2,
    countryCode: 'BR',
    offers: [offer(502, '8001', url(502, 'a')), offer(502, '8003', url(502, 'a'))],
    fetchedAt: new Date(now - 5 * DAY_MS),
    staleAfter: new Date(now + DAY_MS),
  })
  const m3 = await createMovie(prisma, 503)
  await plain.replaceSnapshot({
    entityType: 'movie',
    entityId: m3,
    countryCode: 'BR',
    offers: [offer(503, '8001', url(503, 'a'))],
    fetchedAt: new Date(now - (AUTO_DISPLAY_MAX_OFFER_AGE_DAYS + 10) * DAY_MS),
    staleAfter: new Date(now - DAY_MS),
  })
  const candidates = await countWatchDisplayCandidates(prisma, {})
  record(
    7,
    'o dry-run do acervo conta SO a oferta recente e pronta',
    candidates === 1,
    `candidatas=${String(candidates)} (esperado 1: a 8001 do filme 502)`,
  )
  const backlog = await applyWatchDisplayPolicy(prisma, { limit: 100 })
  record(
    8,
    'o comando do acervo acende o que ja estava gravado',
    backlog.displayed === 1 && (await renderable(prisma, m2)) === 1 && backlog.refusals.length === 0,
    `acesas=${String(backlog.displayed)} recusas=${String(backlog.refusals.length)}`,
  )
  record(
    9,
    `CONTROLE NEGATIVO: oferta coletada ha mais de ${String(AUTO_DISPLAY_MAX_OFFER_AGE_DAYS)} dias NAO acende`,
    (await renderable(prisma, m3)) === 0,
    `renderizaveis do filme 503=${String(await renderable(prisma, m3))}`,
  )
  record(
    10,
    'nenhuma recusa calada: o log da politica so fala quando ha recusa',
    logs.every((line) => line.includes('nao acendeu') || line.includes('falhou')),
    `${String(logs.length)} linhas de log`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-watch-policy-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_watch_policy'
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${dbName}?schema=public`
  console.log(`\n=== Postgres efemero (embedded) :${String(port)} ===\n`)

  let started = false
  let disconnect: (() => Promise<void>) | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase(dbName)

    process.env.DATABASE_URL = url
    const env = { ...process.env, DATABASE_URL: url }
    await runChild('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    await runChild('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })

    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => Prisma
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma
    await runChecks(dbServer.getPrismaClient())
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch (e) {
      console.warn(`Aviso: dir temporario nao removido agora (${(e as Error).message.split('\n')[0]}).`)
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`)
  const EXPECTED_CHECKS = 10
  if (results.length < EXPECTED_CHECKS) {
    console.error(
      `FALHA: apenas ${String(results.length)} checks executados (esperados ${String(EXPECTED_CHECKS)}).`,
    )
    process.exit(1)
  }
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${String(f.n)}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
