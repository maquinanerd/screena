/**
 * validate-stores-real-postgres.ts — Teste de INTEGRACAO dos stores REAIS de
 * streaming contra PostgreSQL 16 efemero (Prompt 2, 2a revisao de banco, §3.3).
 *
 * Nao testa SQL sintetico: exercita os adapters Prisma de verdade
 * (`createPrismaWatchStore`, `createPrismaReviewStore`) sobre um banco com a
 * migration da Fase 2 aplicada — o mesmo trigger permanente e as mesmas funcoes
 * de identidade/payload que a producao usaria.
 *
 * Ferramenta DESCARTAVEL (nunca em produto/render/prod). Motor: embedded-postgres
 * (PostgreSQL 16 real, efemero). Sem segredo; instancia derrubada no finally.
 *
 * Uso: pnpm --filter @screena/streaming validate:stores
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { createPrismaWatchStore } from '../src/persistence/watch-store.js'
import { createPrismaReviewStore } from '../src/persistence/watch-review-store.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
      srv.close()
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

/** Uma oferta de sync (formato WatchOfferRow), com defaults sensatos. */
function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entityType: 'movie',
    entityId: '', // preenchido no main com o movieId real
    countryCode: 'BR',
    providerKey: 'netflix',
    providerName: 'Netflix',
    offerType: 'subscription',
    deepLink: 'https://netflix/x',
    price: null,
    currency: null,
    quality: 'hd',
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-stores-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_stores?schema=public`
  console.log(`\n=== stores integration — Postgres efemero :${port} ===\n`)

  let started = false
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('screena_stores')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })

    // Referencia minima + um filme real (a FK de entities exige entidade real).
    await prisma.$executeRawUnsafe(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default) VALUES ('pt-BR','Portugues','Portuguese',true,true)`)
    await prisma.$executeRawUnsafe(`INSERT INTO countries (code, name_pt, name_en) VALUES ('BR','Brasil','Brazil')`)
    const movie = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (800001,'Store Movie',now()) RETURNING id`)
    const movieId = movie[0]!.id.toString()

    const watchStore = createPrismaWatchStore(prisma as never)
    const reviewStore = createPrismaReviewStore(prisma as never)
    const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
    const fetched1 = new Date('2026-07-15T10:00:00.000Z')
    const stale1 = new Date('2026-07-16T10:00:00.000Z')

    // 1. sync inicial cria ofertas com display_allowed=false.
    const r1 = await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId }), offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' })],
      fetchedAt: fetched1, staleAfter: stale1,
    } as never)
    const afterSync1 = (await q<{ c: number; d: number }>(`SELECT count(*)::int AS c, count(*) FILTER (WHERE display_allowed)::int AS d FROM watch_availability WHERE entity_id=${movieId}`))[0]!
    record(1, 'sync inicial cria ofertas com display_allowed=false', afterSync1.c === 2 && afterSync1.d === 0, `linhas=${afterSync1.c}, display=${afterSync1.d}, created=${r1.created}`)

    // 2. segundo sync IDENTICO nao duplica (mesma identidade).
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId }), offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' })],
      fetchedAt: new Date('2026-07-15T11:00:00.000Z'), staleAfter: stale1,
    } as never)
    const afterSync2 = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM watch_availability WHERE entity_id=${movieId}`))[0]!.c)
    record(2, 'segundo sync identico nao duplica (upsert por identidade)', afterSync2 === 2, `linhas=${afterSync2}`)

    // Descobre o id da oferta Netflix (governanca sera setada nela).
    const netflixId = (await q<{ id: bigint }>(`SELECT id FROM watch_availability WHERE entity_id=${movieId} AND provider_key='netflix'`))[0]!.id.toString()

    // 3. promocao SEM revisor lanca (identidade humana obrigatoria).
    let noReviewerThrew = false
    try { await reviewStore.promote([netflixId], '   ') } catch { noReviewerThrew = true }
    record(3, 'promocao sem revisor humano lanca (reviewed_by obrigatorio)', noReviewerThrew, `threw=${noReviewerThrew}`)

    // 4. promocao de oferta INCOMPLETA (sem licenca/atribuicao) nao promove (fail-closed).
    const incomplete = await reviewStore.promote([netflixId], 'ana@screen')
    const netflixDisplayA = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${netflixId}`))[0]!.display_allowed
    record(4, 'promocao de oferta sem licenca/atribuicao e fail-closed (nao promove)', incomplete.updated === 0 && netflixDisplayA === false, `updated=${incomplete.updated}, display=${netflixDisplayA}`)

    // Governanca minima (passo humano simulado): licenca + atribuicao.
    await prisma.$executeRawUnsafe(`UPDATE watch_availability SET license_status='official', attribution_text='Movie of the Night', attribution_url='https://motn/x', requires_attribution=true, requires_linkback=true WHERE id=${netflixId}`)

    // 5. promocao GOVERNADA: display=true + reviewed_by + approved_payload_hash.
    const promoted = await reviewStore.promote([netflixId], 'ana@screen')
    const netflixRow = (await q<{ display_allowed: boolean; reviewed_by: string | null; approved_payload_hash: string | null }>(`SELECT display_allowed, reviewed_by, approved_payload_hash FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(5, 'promocao governada liga display + grava reviewed_by + approved_payload_hash', promoted.updated === 1 && netflixRow.display_allowed === true && netflixRow.reviewed_by === 'ana@screen' && netflixRow.approved_payload_hash !== null, `updated=${promoted.updated}, display=${netflixRow.display_allowed}, revisor=${netflixRow.reviewed_by}`)

    // 6. sync com PAYLOAD alterado (nova qualidade) na MESMA oferta -> revoga
    //    a aprovacao (subscription nao pode ter preco; qualidade e payload valido).
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [
        offer({ entityId: movieId, quality: '4k' }), // Netflix, quality mudou -> payload mudou
        offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' }),
      ],
      fetchedAt: new Date('2026-07-15T12:00:00.000Z'), staleAfter: stale1,
    } as never)
    const netflixAfterChange = (await q<{ display_allowed: boolean; quality: string | null }>(`SELECT display_allowed, quality FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(6, 'mudanca de payload (qualidade) revoga a aprovacao no sync (display volta false)', netflixAfterChange.display_allowed === false && netflixAfterChange.quality === '4k', `display=${netflixAfterChange.display_allowed}, quality=${netflixAfterChange.quality}`)

    // 7. oferta que SUMIU do snapshot -> revogada + stale, NAO apagada.
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId, quality: '4k' })], // so Netflix; Max sumiu
      fetchedAt: new Date('2026-07-15T13:00:00.000Z'), staleAfter: stale1,
    } as never)
    const maxRow = (await q<{ c: number; display_allowed: boolean; stale_after: Date | null }>(`SELECT count(*)::int AS c, bool_or(display_allowed) AS display_allowed, max(stale_after) AS stale_after FROM watch_availability WHERE entity_id=${movieId} AND provider_key='max'`))[0]!
    record(7, 'oferta sumida do snapshot: revogada + stale, NAO apagada', maxRow.c === 1 && maxRow.display_allowed === false && maxRow.stale_after !== null, `linhas=${maxRow.c}, display=${maxRow.display_allowed}, stale=${maxRow.stale_after !== null}`)

    // 8. o BANCO rejeita display_allowed=true com hash invalido (trigger permanente).
    let dbRejected = false
    try { await prisma.$executeRawUnsafe(`UPDATE watch_availability SET display_allowed=true, approved_payload_hash='HASH_FALSO', reviewed_at=now(), reviewed_by='x' WHERE id=${netflixId}`) } catch { dbRejected = true }
    record(8, 'banco rejeita display_allowed=true com hash invalido (trigger permanente)', dbRejected, `rejected=${dbRejected}`)
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    await prisma.$disconnect()
    if (started) {
      try { await pg.stop() } catch { /* best-effort */ }
    }
    await safeRm(dataDir)
    console.log('\n=== stores integration: Postgres efemero derrubado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO (stores integration): ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Stores reais governanca-compativeis em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
