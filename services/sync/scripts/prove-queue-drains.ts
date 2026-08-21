#!/usr/bin/env node
/**
 * prove-queue-drains.ts — A PROVA QUE FALTAVA.
 *
 * ============================================================================
 * POR QUE ESTA PROVA EXISTE
 * ============================================================================
 * A leva #205 entregou 6.696 testes verdes, `prove:scheduler-service` 14/14 com
 * PostgreSQL real, `prove:scheduler-lock` 4/4 com SIGKILL, sete portoes verdes —
 * e ZERO linha de catalogo produzida. Tudo aquilo provou que o AGENDADOR
 * funciona. Nada provou que o TRABALHO acontece de ponta a ponta.
 *
 * A diferenca nao e academica: em 2026-08-21 mediu-se 534 jobs `pending` em
 * `catalog_jobs`, nenhum jamais processado, porque o servico consumidor
 * (`screen-catalog-worker`) nunca foi criado. Nenhuma das provas existentes
 * podia ter pego isso — todas param na borda do enfileiramento.
 *
 * Esta prova so fica verde quando um job SAI de `pending` E VIRA DADO NO BANCO.
 * Nao "o worker subiu". Nao "o job foi enfileirado". A linha na tabela final.
 *
 * ============================================================================
 * AS DUAS METADES, E POR QUE A PRIMEIRA E OBRIGATORIA
 * ============================================================================
 * (A) CONTROLE NEGATIVO — sem worker. O job fica `pending`, e o painel tem de
 *     ficar VERMELHO. Sem esta metade, a metade (B) passaria mesmo que
 *     `evaluateBacklog` devolvesse "drenada" para tudo, e a prova certificaria
 *     um painel cego. Uma prova que so testa o caminho feliz e um teste que
 *     mede a si mesmo.
 *
 * (B) O DRENO — com worker. O job vira `succeeded` E `movies` ganha a linha, E
 *     o painel volta a VERDE.
 *
 * ============================================================================
 * SEM REDE E SEM PRODUCAO
 * ============================================================================
 * PostgreSQL efemero (`embedded-postgres`) com as migrations REAIS, e um TMDB
 * FALSO em `127.0.0.1` (via `TMDB_API_BASE_URL`). Nenhuma chamada sai da
 * maquina, nenhuma cota e gasta e `.env` nunca e lido — o `DATABASE_URL` vai por
 * env explicito para o filho, e a env local aponta para PRODUCAO.
 *
 * NOTA DE AMBIENTE (Windows): o `initdb` do `embedded-postgres` falha em caminho
 * com acento. O diretorio de dados sai de `os.tmpdir()`; se o seu `TEMP` tiver
 * acento, aponte `TMPDIR`/`TEMP` para um caminho ASCII antes de rodar.
 *
 * Uso: pnpm --filter @screena/sync prove:queue-drains
 */

import { execFile, execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { BACKLOG_STALE_HOURS, evaluateBacklog, type JobBacklogCounts } from '../src/scheduler/backlog.js'
import { buildStatusReport, renderStatusText } from '../src/scheduler/status.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

/** Token FALSO. O TMDB desta prova e um servidor local; nao ha credencial real. */
const FAKE_TMDB_TOKEN = 'token-de-prova-nao-e-credencial'

/** O filme da prova. 603 = "Matrix" no TMDB; aqui e so um id estavel. */
const TMDB_ID = 603
const TITULO = 'Matrix (payload de prova)'

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function tsxBin(): string {
  return path.join(repoRoot, 'services', 'ingestion', 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

function prismaBin(): string {
  return path.join(dbDir, 'node_modules', 'prisma', 'build', 'index.js')
}

/**
 * O TMDB FALSO.
 *
 * Responde ao detalhe de filme com um payload minimo porem COMPLETO o bastante
 * para o normalizador aceitar, e devolve `{}` para qualquer outro caminho. O
 * `{}` e deliberado: se o worker pedir algo que esta prova nao previu, o job
 * falha em vez de passar com dado inventado.
 */
function startFakeTmdb(port: number, pedidos: string[]): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(port)}`)
    pedidos.push(url.pathname)
    res.setHeader('content-type', 'application/json; charset=utf-8')

    if (url.pathname === `/movie/${String(TMDB_ID)}`) {
      res.statusCode = 200
      res.end(
        JSON.stringify({
          id: TMDB_ID,
          title: TITULO,
          original_title: TITULO,
          original_language: 'en',
          overview: 'Sinopse de prova. Nunca sai desta maquina.',
          release_date: '1999-03-30',
          runtime: 136,
          status: 'Released',
          popularity: 42.5,
          vote_average: 8.2,
          vote_count: 1000,
          adult: false,
          poster_path: '/prova-poster.jpg',
          backdrop_path: '/prova-backdrop.jpg',
          // Sem genero/pais/idioma: as tres tabelas tem FK para dicionarios
          // semeados, e a prova nao e sobre elas. O que se prova aqui e que o
          // JOB sai de `pending` e vira LINHA — o caminho minimo.
          genres: [],
          production_countries: [],
          spoken_languages: [],
          credits: { cast: [], crew: [] },
          external_ids: { imdb_id: 'tt0133093' },
          images: { posters: [], backdrops: [], logos: [] },
          videos: { results: [] },
          'watch/providers': { results: {} },
          recommendations: { results: [] },
          similar: { results: [] },
          release_dates: { results: [] },
        }),
      )
      return
    }

    res.statusCode = 200
    res.end('{}')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

/**
 * Roda um comando da CLI do catalogo contra o banco efemero.
 *
 * ============================================================================
 * ASSINCRONO, E NAO E PREFERENCIA DE ESTILO
 * ============================================================================
 * A primeira versao usava `execFileSync` e a prova falhava com `JobTimeoutError`
 * sem que UMA requisicao chegasse ao TMDB falso. A causa nao estava no worker:
 * `execFileSync` BLOQUEIA o event loop do processo pai, e o TMDB falso roda
 * NESTE processo. O filho pedia, o servidor nao podia responder, e o job morria
 * no timeout.
 *
 * Ficou registrado aqui porque o sintoma aponta para o lugar errado com
 * confianca: "o worker nao pediu o detalhe" parece defeito do worker.
 *
 * `timeout` e `maxBuffer` explicitos: sem eles um worker que trava vira uma
 * PROVA QUE NUNCA TERMINA — indistinguivel de "ainda rodando" e por isso nunca
 * reprovada. Com teto, travar vira FALHA.
 */
async function catalog(
  url: string,
  tmdbBase: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ code: number; out: string }> {
  return await new Promise((resolve) => {
    execFile(
      process.execPath,
      [tsxBin(), path.join(repoRoot, 'services', 'ingestion', 'bin', 'catalog.ts'), ...args],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: url,
          TMDB_READ_ACCESS_TOKEN: FAKE_TMDB_TOKEN,
          TMDB_API_BASE_URL: tmdbBase,
          NODE_ENV: 'test',
        },
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : ((error as { code?: number }).code ?? 1)
        resolve({ code, out: `${stdout}\n${stderr}` })
      },
    )
  })
}


async function main(): Promise<number> {
  const pgPort = await freePort()
  const tmdbPort = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-drena-'))
  const database = 'cinerie_queue_proof'
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: pgPort,
    persistent: false,
  })

  const failures: string[] = []
  const check = (ok: boolean, label: string): void => {
    log(`   ${ok ? 'OK  ' : 'FALHA'} ${label}`)
    if (!ok) failures.push(label)
  }

  const pedidos: string[] = []
  let fake: Server | null = null
  let prisma: PrismaClient | null = null

  try {
    log('== subindo PostgreSQL 16 efemero ==')
    await pg.initialise()
    await pg.start()
    await pg.createDatabase(database)
    const url = `postgresql://postgres:postgres@127.0.0.1:${String(pgPort)}/${database}`

    log('== aplicando as migrations REAIS do screen-db ==')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      cwd: dbDir,
    })

    // O SEED VEM ANTES DA INGESTAO, e nao e opcional: `api_cache` e
    // `api_sync_logs` tem FK para `api_providers.key`, e sem a linha `tmdb` o
    // primeiro job morre em violacao de chave estrangeira. E a mesma
    // pre-condicao do runbook de bootstrap do catalogo.
    log('== semeando o registro de fornecedores (api_providers etc.) ==')
    execFileSync(
      process.execPath,
      [tsxBin(), path.join(dbDir, 'prisma', 'seed.ts')],
      { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', cwd: dbDir },
    )

    log('== subindo o TMDB FALSO em 127.0.0.1 ==')
    fake = await startFakeTmdb(tmdbPort, pedidos)
    const tmdbBase = `http://127.0.0.1:${String(tmdbPort)}`

    prisma = new PrismaClient({ datasources: { db: { url } } })
    const cliente = prisma
    const sql = async (text: string): Promise<Array<Record<string, unknown>>> =>
      await cliente.$queryRawUnsafe<Array<Record<string, unknown>>>(text)

    // ---- ENFILEIRA -------------------------------------------------------
    log('')
    log('== (0) enfileirando UM sync_details ==')
    const enq = await catalog(url, tmdbBase, [
      'enqueue',
      'sync_details',
      '--entity',
      'movie',
      '--id',
      String(TMDB_ID),
      // A CLI recusa mutar sem `--apply` (nem `--dry-run`), de proposito. O
      // worker e a excecao declarada: a acao DELE e processar.
      '--apply',
    ])
    if (enq.code !== 0) log(`   saida do enqueue: ${enq.out.slice(0, 1500)}`)
    check(enq.code === 0, 'o enqueue sai com codigo 0')

    const pendentes = await sql(
      `SELECT status::text AS status, COUNT(*)::int AS n FROM catalog_jobs GROUP BY status`,
    )
    check(
      pendentes.length === 1 && pendentes[0]?.status === 'pending' && pendentes[0]?.n === 1,
      'ha exatamente 1 job, e ele esta pending',
    )

    const filmesAntes = await sql(`SELECT COUNT(*)::int AS n FROM movies`)
    check(Number(filmesAntes[0]?.n ?? -1) === 0, 'movies esta VAZIA antes do dreno')

    // ---- (A) CONTROLE NEGATIVO: sem worker, o painel tem de ficar VERMELHO --
    log('')
    log('== (A) CONTROLE NEGATIVO: sem worker, o painel fica VERMELHO ==')
    const contagemAntes = await lerBacklog(sql)

    // O job foi criado agora; para provar o limiar sem esperar um dia, o
    // relatorio e montado com um `now` 25h a frente. `evaluateBacklog` recebe
    // `now` por parametro exatamente para isto ter teste em vez de esperar.
    const daquiA25h = new Date(Date.now() + (BACKLOG_STALE_HOURS + 1) * 60 * 60 * 1000)
    const painelVermelho = buildStatusReport({
      now: daquiA25h,
      startedAt: daquiA25h,
      schedules: [],
      alerts: [],
      quotas: [],
      backlog: evaluateBacklog(contagemAntes, daquiA25h),
      workerId: 'prova',
    })

    check(painelVermelho.overall === 'degraded', 'o painel fica DEGRADADO com a fila intacta')
    check(
      painelVermelho.backlog.rows.some((row) => row.state === 'REPRESADA'),
      'o tipo sync_details aparece como REPRESADA',
    )
    check(painelVermelho.backlog.neverDrained, 'o painel acusa "nenhum job jamais processado"')
    check(
      renderStatusText(painelVermelho).includes('NENHUM job jamais foi processado'),
      'a frase do produtor-sem-consumidor sai no texto da CLI',
    )

    // ---- (B) O DRENO ------------------------------------------------------
    log('')
    log('== (B) rodando o worker de verdade (o mesmo de producao) ==')
    const worker = await catalog(url, tmdbBase, [
      'worker',
      // Teto BAIXO de proposito: a prova precisa de UM job drenado, nao de um
      // catalogo. `--max-jobs 0` seria "sem teto" e o worker viraria servico.
      '--max-jobs',
      '6',
      '--concurrency',
      '1',
      '--timeout-ms',
      '15000',
    ])
    // A saida do worker sai SEMPRE, nao so em codigo != 0: o worker sai 0
    // mesmo quando todo job foi para retry, e foi exatamente esse desfecho que
    // escondeu a causa duas vezes nesta sessao.
    log(`   saida do worker:
${worker.out.slice(0, 4000)}`)
    check(worker.code === 0, 'o worker sai com codigo 0')

    check(
      pedidos.includes(`/movie/${String(TMDB_ID)}`),
      'o worker REALMENTE pediu o detalhe ao TMDB (falso)',
    )

    // A PROVA. Duas afirmacoes, e as duas tem de valer.
    const depois = await sql(
      `SELECT status::text AS status, COUNT(*)::int AS n FROM catalog_jobs GROUP BY status`,
    )
    const aindaPendentes = depois
      .filter((row) => row.status === 'pending')
      .reduce((sum, row) => sum + Number(row.n), 0)
    const concluidos = depois
      .filter((row) => row.status === 'succeeded')
      .reduce((sum, row) => sum + Number(row.n), 0)

    if (concluidos === 0) {
      // A coluna existe exatamente para isto: o log estruturado redige o erro
      // (`error_class: unknown`), e `last_error_safe` guarda a mensagem segura.
      const erros = await sql(
        `SELECT job_type::text AS job_type, status::text AS status,
                last_error_code AS code, last_error_safe AS safe
           FROM catalog_jobs WHERE last_error_code IS NOT NULL`,
      )
      for (const linha of erros) {
        log(`   erro do job ${String(linha.job_type)} (${String(linha.status)}): ` +
            `${String(linha.code)} — ${String(linha.safe)}`)
      }
    }
    if (concluidos === 0) {
      // Diagnostico SO-LEITURA. Rodar `catalog sync` aqui rodaria o mesmo
      // import e criaria a linha — e a checagem seguinte ("a linha existe em
      // movies") passaria pelo motivo errado, sem o worker ter drenado nada.
      const erros = await sql(
        `SELECT job_type::text AS job_type, status::text AS status,
                last_error_code AS code, last_error_safe AS safe
           FROM catalog_jobs WHERE last_error_code IS NOT NULL`,
      )
      for (const linha of erros) {
        log(
          `   erro do job ${String(linha.job_type)} (${String(linha.status)}): ` +
            `${String(linha.code)} — ${String(linha.safe)}`,
        )
      }
    }
    check(concluidos >= 1, 'ao menos um job SAIU de pending e virou succeeded')

    const filmes = await sql(
      `SELECT tmdb_id::int AS tmdb_id, title_original AS titulo FROM movies WHERE tmdb_id = ${String(TMDB_ID)}`,
    )
    check(
      filmes.length === 1 && Number(filmes[0]?.tmdb_id) === TMDB_ID,
      'E A LINHA EXISTE EM movies — o job virou DADO, nao so status',
    )

    // ---- o painel volta a verde ------------------------------------------
    log('')
    log('== (C) o painel volta a VERDE quando a fila drena ==')
    const contagemDepois = await lerBacklog(sql)
    const agoraDepois = new Date(Date.now() + (BACKLOG_STALE_HOURS + 1) * 60 * 60 * 1000)
    const painelDepois = buildStatusReport({
      now: agoraDepois,
      startedAt: agoraDepois,
      schedules: [],
      alerts: [],
      quotas: [],
      backlog: evaluateBacklog(contagemDepois, agoraDepois),
      workerId: 'prova',
    })
    check(!painelDepois.backlog.neverDrained, 'o painel deixa de acusar produtor-sem-consumidor')
    check(
      painelDepois.backlog.rows.some((row) => row.succeeded > 0),
      'o painel mostra job(s) concluido(s)',
    )
    // Jobs dependentes enfileirados pelo detalhe podem sobrar em `pending` se o
    // teto de `--max-jobs` for atingido; isso NAO e represamento (sao novos).
    // O que a prova exige e que o painel nao minta em nenhuma das duas direcoes.
    log(`   (informativo) pendentes remanescentes: ${String(aindaPendentes)}`)

    log('')
    if (failures.length === 0) {
      log(`PROVA COMPLETA: ${String(9 + 4)} verificacoes, nenhuma falha.`)
      log('O job saiu de pending E virou linha em movies. O painel acusou antes e liberou depois.')
      return 0
    }
    log(`FALHAS (${String(failures.length)}):`)
    for (const failure of failures) log(`  - ${failure}`)
    return 1
  } finally {
    await prisma?.$disconnect().catch(() => undefined)
    if (fake !== null) await new Promise<void>((resolve) => fake?.close(() => resolve()))
    await pg.stop().catch(() => undefined)
    // Best-effort: no Windows o PostgreSQL pode ainda segurar handles do
    // diretorio por alguns instantes apos o `stop`, e um EPERM na limpeza nao
    // pode transformar uma prova VERDE em falha.
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      log(`   (aviso) diretorio temporario nao removido: ${dataDir}`)
    }
  }
}

/** Le as contagens de `catalog_jobs` no formato que `evaluateBacklog` espera. */
async function lerBacklog(
  sql: (text: string) => Promise<Array<Record<string, unknown>>>,
): Promise<readonly JobBacklogCounts[]> {
  const rows = await sql(
    `SELECT job_type::text AS job_type,
            COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending,
            COUNT(*) FILTER (WHERE status = 'claimed')::int     AS claimed,
            COUNT(*) FILTER (WHERE status = 'running')::int     AS running,
            COUNT(*) FILTER (WHERE status = 'retry_wait')::int  AS retry_wait,
            COUNT(*) FILTER (WHERE status = 'succeeded')::int   AS succeeded,
            COUNT(*) FILTER (WHERE status = 'failed')::int      AS failed,
            COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int   AS cancelled,
            MIN(created_at) FILTER (WHERE status = 'pending')   AS oldest_pending_at
       FROM catalog_jobs GROUP BY job_type`,
  )
  return rows.map((row) => ({
    jobType: String(row.job_type),
    pending: Number(row.pending),
    claimed: Number(row.claimed),
    running: Number(row.running),
    retryWait: Number(row.retry_wait),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    deadLetter: Number(row.dead_letter),
    cancelled: Number(row.cancelled),
    oldestPendingAt:
      row.oldest_pending_at === null || row.oldest_pending_at === undefined
        ? null
        : new Date(String(row.oldest_pending_at)),
  }))
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`prova falhou: ${String(error)}\n`)
    process.exit(1)
  })
