/**
 * validate-omdb-candidate-order-real-postgres.ts — A ORDEM e a PARTICAO da
 * selecao de candidatos OMDb, contra PostgreSQL REAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * ============================================================================
 * POR QUE ISTO NAO PODE SER UM TESTE DE UNIDADE
 * ============================================================================
 * O enunciado foi explicito: "o teste tem que medir a ORDEM RESULTANTE, nao a
 * existencia da clausula — um teste que faz grep no SQL nao distingue mundo
 * nenhum". A ordem vive dentro de um `ORDER BY CASE ... END` construido por
 * concatenacao de string e executado pelo Postgres. Um fake em memoria provaria
 * a implementacao do fake; um `expect(sql).toContain('CASE')` passaria com a
 * clausula sintaticamente presente e semanticamente errada — indices trocados,
 * balde invertido, comparacao de data no fuso errado.
 *
 * Aqui o SQL de PRODUCAO (`createPrismaStaleEntityCandidates`) roda contra um
 * Postgres de verdade, sobre linhas plantadas com datas conhecidas, e o que se
 * afirma e a SEQUENCIA que volta.
 *
 * ============================================================================
 * O QUE ESTE VALIDADOR PROVA
 * ============================================================================
 *   1. `coverage` seleciona SO quem tem zero notas externas.
 *   2. `refresh` seleciona SO quem JA tem nota.
 *   3. Os dois conjuntos sao DISJUNTOS (nenhum titulo pago duas vezes no dia).
 *   4. A ordem e editorial: estreia recente > estreia proxima > serie no ar >
 *      popularidade > id.
 *   5. CONTROLE NEGATIVO da ordem antiga: o titulo que a ordem `id ASC` traria
 *      primeiro NAO vem primeiro, e o que `popularity DESC` puro traria
 *      primeiro tambem NAO vem primeiro. Sem estes dois, o check 4 passaria com
 *      a ordem antiga de pe em metade dos cenarios.
 *   6. `coverage` IGNORA a janela de frescor (era o defeito: um titulo nunca
 *      perguntado sendo filtrado por uma coleta que nao existe).
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO),
 * mesmo padrao dos demais `validate:*-real-postgres`.
 *
 * ENCODING: o cluster sobe no encoding DEFAULT, de proposito. Forcar
 * `--encoding=UTF8` quebra quando os binarios vivem sob caminho acentuado (o
 * checkout deste repo e um). Este cenario e 100% ASCII.
 *
 * Seguranca: ZERO rede (nenhuma chamada a OMDb); nenhum `DATABASE_URL`
 * persistido; Postgres derrubado e diretorio removido no `finally`.
 *
 * Uso: pnpm --filter @screena/ratings validate:omdb-order
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'

import { createPrismaStaleEntityCandidates } from '../src/persistence/stale-entity-candidates.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

const PROVIDER = 'omdb'
/** "Agora" FIXO. A ordem compara datas contra ele; um relogio real tornaria o
 *  cenario dependente do dia em que o validador roda. */
const NOW = new Date('2026-08-31T12:00:00.000Z')

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
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

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T[]>
}

/** Dias a partir de `NOW`, em ISO date. Negativo = passado. */
function dayOffset(days: number): string {
  const d = new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

/**
 * O cenario de FILMES.
 *
 * Os `id` sao atribuidos na ordem de insercao, e os `popularity` sao escolhidos
 * para que a ordem editorial DISCORDE tanto de `id ASC` quanto de
 * `popularity DESC` puro. Sem essa discordancia deliberada, os tres criterios
 * concordariam e o validador nao distinguiria mundo nenhum.
 */
const MOVIES: readonly {
  key: string
  tmdbId: number
  releaseDate: string | null
  popularity: number
}[] = [
  // id 1, o MAIS POPULAR de todos, mas estreou ha 5 anos. Sob `popularity DESC`
  // puro ele seria o primeiro; sob a ordem editorial ele e balde 4.
  { key: 'antigo-popularissimo', tmdbId: 101, releaseDate: dayOffset(-1825), popularity: 9999 },
  // id 2, estreou ha 3 anos e e impopular. Sob `id ASC` (a ordem original) ele
  // viria antes de tudo que foi inserido depois.
  { key: 'antigo-obscuro', tmdbId: 102, releaseDate: dayOffset(-1100), popularity: 1 },
  // id 3 — balde 2 (estreia em 20 dias).
  { key: 'estreia-proxima', tmdbId: 103, releaseDate: dayOffset(20), popularity: 50 },
  // id 4 — balde 1 (estreou ha 10 dias). DEVE ser o primeiro de todos.
  { key: 'estreou-ontem', tmdbId: 104, releaseDate: dayOffset(-10), popularity: 5 },
  // id 5 — balde 1 tambem, e MAIS popular que o id 4: desempata na frente dele.
  { key: 'estreou-e-popular', tmdbId: 105, releaseDate: dayOffset(-40), popularity: 800 },
  // id 6 — balde 4: sem data. Nao pode ser promovido por acidente.
  { key: 'sem-data', tmdbId: 106, releaseDate: null, popularity: 700 },
  // id 7 — balde 4: estreia daqui a 2 anos, FORA da janela de 60 dias.
  { key: 'estreia-longinqua', tmdbId: 107, releaseDate: dayOffset(730), popularity: 600 },
  // id 8 — balde 4: estreou ha 200 dias, FORA da janela de 90 dias.
  { key: 'saiu-de-cartaz', tmdbId: 108, releaseDate: dayOffset(-200), popularity: 500 },
]

/** O cenario de SERIES — o balde 3 (`status` no ar) so existe aqui. */
const SHOWS: readonly {
  key: string
  tmdbId: number
  firstAirDate: string | null
  status: string | null
  popularity: number
}[] = [
  // id 1: no ar, sem data de estreia. A guarda de NULL que NAO existe e o que
  // permite ela chegar ao balde 3 em vez de cair no 4.
  { key: 'no-ar-sem-data', tmdbId: 201, firstAirDate: null, status: 'Returning Series', popularity: 10 },
  // id 2: encerrada e popularissima — balde 4, apesar da popularidade.
  { key: 'encerrada-popular', tmdbId: 202, firstAirDate: dayOffset(-3000), status: 'Ended', popularity: 9999 },
  // id 3: estreou ha 20 dias — balde 1, ganha de todo mundo.
  { key: 'estreou-agora', tmdbId: 203, firstAirDate: dayOffset(-20), status: 'Returning Series', popularity: 3 },
  // id 4: `Planned` NAO e "no ar" — e o recorte mais estreito que
  // AIRING_TV_STATUSES. Estreia daqui a 300 dias, entao balde 4.
  { key: 'planejada', tmdbId: 204, firstAirDate: dayOffset(300), status: 'Planned', popularity: 900 },
]

function lit(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`
}

/** Planta o cenario. Os ids saem sequenciais na ordem de insercao. */
async function seedScenario(prisma: PrismaLike): Promise<void> {
  for (const [index, movie] of MOVIES.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, release_date, popularity,
                           created_at, updated_at)
       VALUES (${String(movie.tmdbId)}, 'tt${String(9000000 + index)}', ${lit(movie.key)},
               ${movie.releaseDate === null ? 'NULL' : `${lit(movie.releaseDate)}::date`},
               ${String(movie.popularity)}, now(), now())`,
    )
  }
  for (const [index, show] of SHOWS.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO tv_shows (tmdb_id, imdb_id, name_original, first_air_date, status, popularity,
                             created_at, updated_at)
       VALUES (${String(show.tmdbId)}, 'tt${String(8000000 + index)}', ${lit(show.key)},
               ${show.firstAirDate === null ? 'NULL' : `${lit(show.firstAirDate)}::date`},
               ${lit(show.status)}, ${String(show.popularity)}, now(), now())`,
    )
  }
}

/**
 * Da uma nota externa a um filme, pelo `title_original`.
 *
 * A linha e minima e valida: `provider_api='omdb'` (fornecedor tecnico),
 * `rating_source='imdb'` (fonte editorial) e escala 10 — os tres exigidos pelo
 * `external_ratings_integrity_guard_trg`. `display_allowed` fica no default
 * `false`, e esta certo: a SELECAO nao olha exibicao, so existencia.
 */
async function giveRating(prisma: PrismaLike, key: string, fetchedAt: Date): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric,
                                   rating_value, rating_scale, provider_api, fetched_at,
                                   created_at, updated_at)
     SELECT 'movie'::"EntityType", m.id, 'imdb', 'IMDb Rating', 'user_rating',
            7.5, 10, ${lit(PROVIDER)}, ${lit(fetchedAt.toISOString())}::timestamptz AT TIME ZONE 'UTC',
            now(), now()
       FROM movies m WHERE m.title_original = ${lit(key)}`,
  )
}

/** Traduz ids devolvidos pela porta de volta para as chaves legiveis. */
async function keysOf(
  prisma: PrismaLike,
  table: 'movies' | 'tv_shows',
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return []
  const column = table === 'movies' ? 'title_original' : 'name_original'
  const rows = await prisma.$queryRawUnsafe<{ id: bigint; key: string }[]>(
    `SELECT id, ${column} AS key FROM ${table} WHERE id IN (${ids.join(',')})`,
  )
  const byId = new Map(rows.map((row) => [row.id.toString(), row.key]))
  return ids.map((id) => byId.get(id) ?? `?${id}`)
}

async function runChecks(prisma: PrismaLike): Promise<void> {
  await seedScenario(prisma)
  record(3, 'cenario plantado (8 filmes, 4 series, ids sequenciais)', true, 'ok')

  const port = createPrismaStaleEntityCandidates(prisma as never)
  const cutoff = new Date(NOW.getTime() - 168 * 60 * 60 * 1000)

  // ---------------------------------------------------------------- ORDEM
  const coverage = await port.selectStaleByType({
    entityType: 'movie',
    limit: 20,
    providerApi: PROVIDER,
    cutoff,
    mode: 'coverage',
    now: NOW,
  })
  const order = await keysOf(
    prisma,
    'movies',
    coverage.candidates.map((c) => c.entityId),
  )
  console.log(`    ordem devolvida: ${order.join(' > ')}`)

  record(
    4,
    'balde 1 primeiro, e por popularidade dentro do balde',
    order[0] === 'estreou-e-popular' && order[1] === 'estreou-ontem',
    `1o=${order[0] ?? '-'} 2o=${order[1] ?? '-'} (esperado estreou-e-popular > estreou-ontem)`,
  )
  record(
    5,
    'balde 2 (estreia proxima) vem DEPOIS do balde 1 e ANTES do resto',
    order[2] === 'estreia-proxima',
    `3o=${order[2] ?? '-'} (esperado estreia-proxima)`,
  )
  record(
    6,
    'o resto ordena por popularidade DESC',
    order.slice(3).join(',') ===
      ['antigo-popularissimo', 'sem-data', 'estreia-longinqua', 'saiu-de-cartaz', 'antigo-obscuro'].join(
        ',',
      ),
    order.slice(3).join(' > '),
  )

  // ------------------------------------------------ CONTROLES NEGATIVOS
  // Sem estes dois, o check 4 passaria com a ordem ANTIGA de pe em qualquer
  // cenario onde os criterios concordassem por acaso.
  record(
    7,
    'CONTROLE NEGATIVO: NAO e `id ASC` (o 1o inserido nao vem primeiro)',
    order[0] !== 'antigo-popularissimo',
    `sob id ASC o 1o seria "antigo-popularissimo"; veio "${order[0] ?? '-'}"`,
  )
  record(
    8,
    'CONTROLE NEGATIVO: NAO e `popularity DESC` puro (o mais popular nao vem primeiro)',
    order[0] !== 'antigo-popularissimo' && order.indexOf('estreou-ontem') < order.indexOf('sem-data'),
    `"antigo-popularissimo" (pop 9999) ficou na posicao ${String(order.indexOf('antigo-popularissimo') + 1)}`,
  )

  // ----------------------------------------------------------- SERIES
  const tvCoverage = await port.selectStaleByType({
    entityType: 'tv',
    limit: 20,
    providerApi: PROVIDER,
    cutoff,
    mode: 'coverage',
    now: NOW,
  })
  const tvOrder = await keysOf(
    prisma,
    'tv_shows',
    tvCoverage.candidates.map((c) => c.entityId),
  )
  console.log(`    ordem devolvida (tv): ${tvOrder.join(' > ')}`)
  record(
    9,
    'serie: estreia recente > NO AR (balde 3) > o resto por popularidade',
    tvOrder.join(',') ===
      ['estreou-agora', 'no-ar-sem-data', 'encerrada-popular', 'planejada'].join(','),
    tvOrder.join(' > '),
  )
  record(
    10,
    'serie NO AR sem data de estreia chega ao balde 3 (a guarda de NULL nao a rebaixa)',
    tvOrder.indexOf('no-ar-sem-data') < tvOrder.indexOf('encerrada-popular'),
    `"no-ar-sem-data" (pop 10) ficou a frente de "encerrada-popular" (pop 9999)? ${String(
      tvOrder.indexOf('no-ar-sem-data') < tvOrder.indexOf('encerrada-popular'),
    )}`,
  )
  record(
    11,
    'CONTROLE NEGATIVO: `Planned` NAO conta como no ar',
    tvOrder[tvOrder.length - 1] === 'planejada',
    `ultimo=${tvOrder[tvOrder.length - 1] ?? '-'} (esperado planejada)`,
  )

  // -------------------------------------------------- COBERTURA x REFRESH
  // Duas notas: uma ANTIGA (fora da janela -> candidata a refresh) e uma
  // RECENTE (dentro -> pulada por frescor).
  await giveRating(prisma, 'antigo-obscuro', new Date(NOW.getTime() - 300 * 60 * 60 * 1000))
  await giveRating(prisma, 'saiu-de-cartaz', new Date(NOW.getTime() - 2 * 60 * 60 * 1000))

  const cov2 = await port.selectStaleByType({
    entityType: 'movie',
    limit: 20,
    providerApi: PROVIDER,
    cutoff,
    mode: 'coverage',
    now: NOW,
  })
  const covKeys = await keysOf(
    prisma,
    'movies',
    cov2.candidates.map((c) => c.entityId),
  )
  const ref2 = await port.selectStaleByType({
    entityType: 'movie',
    limit: 20,
    providerApi: PROVIDER,
    cutoff,
    mode: 'refresh',
    now: NOW,
  })
  const refKeys = await keysOf(
    prisma,
    'movies',
    ref2.candidates.map((c) => c.entityId),
  )
  console.log(`    cobertura: ${covKeys.join(', ')}`)
  console.log(`    atualizacao: ${refKeys.join(', ')}`)

  record(
    12,
    'cobertura exclui quem JA tem nota (de qualquer provider)',
    !covKeys.includes('antigo-obscuro') && !covKeys.includes('saiu-de-cartaz'),
    `cobertura tem ${String(covKeys.length)} titulos, nenhum deles com nota`,
  )
  record(
    13,
    'atualizacao inclui SO quem tem nota, e so a vencida',
    refKeys.join(',') === 'antigo-obscuro',
    `atualizacao=[${refKeys.join(', ')}] (esperado so "antigo-obscuro"; "saiu-de-cartaz" e fresco)`,
  )
  record(
    14,
    'os dois conjuntos sao DISJUNTOS (nenhum titulo pago duas vezes no dia)',
    covKeys.every((key) => !refKeys.includes(key)),
    `intersecao = [${covKeys.filter((k) => refKeys.includes(k)).join(', ')}]`,
  )
  record(
    15,
    '`skippedFresh` conta o pulado por frescor no refresh, e e 0 na cobertura',
    ref2.skippedFresh === 1 && cov2.skippedFresh === 0,
    `refresh.skippedFresh=${String(ref2.skippedFresh)} coverage.skippedFresh=${String(cov2.skippedFresh)}`,
  )

  // O DEFEITO ORIGINAL, nomeado: a janela de frescor nao pode alcancar quem
  // nunca foi coletado.
  record(
    16,
    'cobertura IGNORA a janela de frescor (era o defeito de 99% do catalogo)',
    covKeys.length === MOVIES.length - 2,
    `${String(covKeys.length)} candidatos de ${String(MOVIES.length - 2)} sem nota — o cutoff nao os filtrou`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-omdb-order-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_omdb_order'
  const url = `postgresql://postgres:postgres@127.0.0.1:${String(port)}/${dbName}?schema=public`
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${String(port)}/${dbName}?schema=public`
  console.log(`\n=== Postgres efemero (embedded) :${String(port)} | ${maskedUrl} ===\n`)

  let started = false
  let disconnect: (() => Promise<void>) | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase(dbName)

    process.env.DATABASE_URL = url
    const env = { ...process.env, DATABASE_URL: url }

    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(1, 'migrate deploy aplica sem erro', true, 'ok')

    console.log('--- prisma db seed (fontes/providers) ---')
    execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(2, 'db:seed roda sem erro (inclui o provider "omdb")', true, 'ok')

    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => PrismaLike
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma
    await runChecks(dbServer.getPrismaClient())
  } catch (e) {
    // Uma excecao aqui NAO pode virar "passou". Um validador que MORRE antes dos
    // checks tem `results` curto, e sem esta linha o resumo diria "0/0 OK".
    record(0, 'execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch (e) {
      console.warn(
        `Aviso: dir temporario nao removido agora (${(e as Error).message.split('\n')[0]}); sera limpo pelo SO.`,
      )
    }
    console.log('\n=== Postgres efemero derrubado e dir temporario liberado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO: ${String(results.length - failed.length)}/${String(results.length)} checks OK.`)
  // Um numero de checks MENOR que o esperado significa que o validador morreu no
  // meio — e morrer no meio nao e passar.
  const EXPECTED_CHECKS = 16
  if (results.length < EXPECTED_CHECKS) {
    console.error(
      `FALHA: apenas ${String(results.length)} checks executados (esperados ${String(EXPECTED_CHECKS)}) — o validador morreu no meio.`,
    )
    process.exit(1)
  }
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${String(f.n)}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log(
    'Resultado: PASSOU. A ordem e editorial (estreia > proxima > no ar > popularidade > id), ' +
      'cobertura e atualizacao sao disjuntas, e a cobertura ignora a janela de frescor.',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
