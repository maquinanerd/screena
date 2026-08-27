/**
 * validate-catalog-platform-real-postgres.ts — Validador DESCARTAVEL do Backend
 * A (fila duravel de jobs + busca PostgreSQL) em PostgreSQL 16 real e EFEMERO.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nunca roda no render/build/prod.
 * Motor: `embedded-postgres@16` (PG16 real, binario portatil, efemero). Nenhum
 * segredo/DATABASE_URL persistido; instancia derrubada no `finally`. Sem rede
 * externa: exercita os adapters Prisma reais contra o banco de verdade.
 *
 * Prova (§16): migration do zero; extensoes/funcao de busca; CatalogJob
 * (enqueue idempotente, claim FOR UPDATE SKIP LOCKED, heartbeat, retry->
 * retry_wait, dead-letter, reclaim de orfaos, replay, dead-letter list); busca
 * exact/alias/acento/prefixo/fuzzy + zero-results.
 *
 * Uso: pnpm --filter @screena/ingestion validate:catalog-platform-complete
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
import { createPrismaCatalogJobStore } from '../src/persistence/catalog-job-store.js'
import { createPrismaSearchStore } from '../src/persistence/search-store.js'
import { createPrismaDiscoverySnapshotStore } from '../src/persistence/discovery-snapshot-store.js'
import { createPrismaChangesCheckpoint } from '../src/persistence/changes-checkpoint-store.js'
import { createPrismaAuditReader } from '../src/persistence/audit-reader.js'
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { planFailure } from '../src/catalog-jobs/transitions.js'
import { buildSearchDocument } from '../src/search/projection.js'
import { createCatalogHandlerRegistry } from '../src/catalog-jobs/handlers/registry.js'
import { ALLOWED_METRIC_LABELS } from '../src/catalog-jobs/handlers/support.js'
import { runCatalogWorker } from '../src/catalog-jobs/worker.js'
import { CATALOG_JOB_TYPES } from '../src/catalog-jobs/types.js'
import { CATALOG_METRIC_NAMES, createInMemoryMetricsSink } from '../src/metrics/index.js'
import { evaluateAuditGate, formatAuditReport, runDatabaseAudit } from '../src/audit/index.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const results: CheckResult[] = []
let counter = 0
function record(name: string, ok: boolean, detail: string): void {
  counter += 1
  results.push({ n: counter, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${counter}. ${name} — ${detail}`)
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

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir} (deixado para o SO limpar).`)
}

/** Relogio controlavel: torna heartbeat/backoff/reclaim deterministicos. */
class Clock {
  private current: Date
  constructor(start: Date) {
    this.current = start
  }
  now = (): Date => this.current
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}

async function runChecks(url: string, readServerLog: () => string | null): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)

  try {
    // ---------------------------------------------------------------------
    // Extensoes e funcao de busca
    // ---------------------------------------------------------------------
    const exts = (
      await q<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('unaccent','pg_trgm')",
      )
    ).map((r) => r.extname)
    record('extensoes unaccent + pg_trgm instaladas', exts.length === 2, exts.join(','))

    const immutable = (
      await q<{ provolatile: string }>(
        "SELECT provolatile FROM pg_proc WHERE proname='immutable_unaccent'",
      )
    )[0]
    record(
      'funcao immutable_unaccent existe e e IMMUTABLE',
      immutable?.provolatile === 'i',
      `provolatile=${immutable?.provolatile}`,
    )

    // ---------------------------------------------------------------------
    // CatalogJob: fila duravel
    // ---------------------------------------------------------------------
    const clock = new Clock(new Date('2026-07-16T12:00:00.000Z'))
    const jobs = createPrismaCatalogJobStore(prisma, { now: clock.now, random: () => 0 })

    // enqueue idempotente
    const key = buildIdempotencyKey({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
    })
    const first = await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
      idempotencyKey: key,
    })
    const dup = await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
      idempotencyKey: key,
    })
    const count1 = Number(
      (
        await q<{ c: bigint }>(
          "SELECT count(*)::int AS c FROM catalog_jobs WHERE idempotency_key = '" + key + "'",
        )
      )[0].c,
    )
    record(
      'enqueue idempotente: mesma chave = noop (1 linha, created=false)',
      first.created === true && dup.created === false && dup.id === first.id && count1 === 1,
      `created1=${first.created}, created2=${dup.created}, linhas=${count1}`,
    )

    // -------------------------------------------------------------------
    // CONTROLE NEGATIVO do enqueue: o noop nao pode CUSTAR um erro.
    //
    // A idempotencia e rede de seguranca, e ate 2026-08-27 ela era paga com uma
    // EXCECAO: `create` + catch de P2002. O Postgres so conseguia contar que a
    // chave existia ABORTANDO a transacao implicita — e toda transacao abortada
    // escreve `ERROR: duplicate key value violates unique constraint
    // "catalog_jobs_idempotency_key_key"` no log do servidor. Como reenfileirar
    // a mesma dependencia e o caminho NORMAL (todo `sync_details` recoberto
    // reenfileira o seu `sync_media`), o log de producao enchia de ERROR para
    // descrever sucesso.
    //
    // Estes tres checks medem os dois lados do contrato:
    //  (a) chave NOVA continua criando a linha, com TODAS as colunas — o INSERT
    //      cru substituiu um `create` do Prisma, e SQL cru pode calar uma coluna
    //      sem que nada reclame;
    //  (b) chave EXISTENTE devolve noop;
    //  (c) o noop de (b) nao escreveu NADA no log do servidor. Este e o check
    //      que REPROVA se alguem voltar ao catch.
    // -------------------------------------------------------------------
    const controlKey = 'k-control-negativo-enqueue'
    const controlAvailableAt = new Date('2026-07-20T09:30:00.000Z')

    // FAIL-LOUD: sem log capturado nao ha o que medir. Um controle que se
    // degrada em silencio PASSA com o defeito de volta — que e exatamente o que
    // ele existe para impedir.
    const logAvailable = readServerLog() !== null
    record(
      'controle negativo: log do servidor disponivel para medicao',
      logAvailable,
      logAvailable
        ? 'stderr do processo do Postgres capturado'
        : 'stderr do Postgres NAO capturado — nada a medir',
    )
    const logBefore = readServerLog() ?? ''
    const rollbackBefore = Number(
      (
        await q<{ n: bigint }>(
          'SELECT xact_rollback AS n FROM pg_stat_database WHERE datname = current_database()',
        )
      )[0].n,
    )

    // (a) chave NOVA cria a linha — e a linha carrega tudo o que a porta pediu.
    const controlNew = await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'tv',
      externalId: '1399',
      idempotencyKey: controlKey,
      payload: { tmdbId: 1399, locale: 'pt-BR', entityType: 'tv' },
      priority: 70,
      maxAttempts: 3,
      availableAt: controlAvailableAt,
      runId: 'controle-negativo',
    })
    const controlRow = (
      await q<{
        id: bigint
        job_type: string
        status: string
        entity_type: string | null
        external_id: string | null
        payload: Record<string, unknown>
        attempts: number
        max_attempts: number
        priority: number
        available_at: Date
        run_id: string | null
        created_at: Date
        updated_at: Date
      }>(`SELECT * FROM catalog_jobs WHERE idempotency_key = '${controlKey}'`)
    )[0]
    record(
      'controle negativo (a): chave NOVA cria a linha com TODAS as colunas',
      controlNew.created === true &&
        controlRow !== undefined &&
        controlRow.id.toString() === controlNew.id &&
        controlRow.job_type === 'sync_media' &&
        controlRow.status === 'pending' &&
        controlRow.entity_type === 'tv' &&
        controlRow.external_id === '1399' &&
        controlRow.payload.tmdbId === 1399 &&
        controlRow.payload.locale === 'pt-BR' &&
        controlRow.attempts === 0 &&
        controlRow.max_attempts === 3 &&
        controlRow.priority === 70 &&
        controlRow.available_at.toISOString() === controlAvailableAt.toISOString() &&
        controlRow.run_id === 'controle-negativo' &&
        controlRow.updated_at instanceof Date &&
        controlRow.created_at instanceof Date,
      `created=${controlNew.created}, id=${controlNew.id}, status=${controlRow?.status}, ` +
        `entity=${controlRow?.entity_type}/${controlRow?.external_id}, prio=${controlRow?.priority}, ` +
        `maxAtt=${controlRow?.max_attempts}, availableAt=${controlRow?.available_at?.toISOString()}, ` +
        `runId=${controlRow?.run_id}, payload=${JSON.stringify(controlRow?.payload)}`,
    )

    // (b) chave EXISTENTE: noop, mesmo id, nenhuma linha nova, nada sobrescrito.
    const controlDup = await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'tv',
      externalId: '1399',
      idempotencyKey: controlKey,
      payload: { tmdbId: 1399, locale: 'pt-BR', entityType: 'tv' },
      priority: 70,
      maxAttempts: 3,
      availableAt: controlAvailableAt,
      runId: 'controle-negativo-2',
    })
    const controlCount = Number(
      (
        await q<{ c: number }>(
          `SELECT count(*)::int AS c FROM catalog_jobs WHERE idempotency_key = '${controlKey}'`,
        )
      )[0].c,
    )
    const controlAfterRow = (
      await q<{ run_id: string | null }>(
        `SELECT run_id FROM catalog_jobs WHERE idempotency_key = '${controlKey}'`,
      )
    )[0]
    record(
      'controle negativo (b): chave EXISTENTE = noop (mesmo id, 1 linha, nada sobrescrito)',
      controlDup.created === false &&
        controlDup.id === controlNew.id &&
        controlCount === 1 &&
        // DO NOTHING, nao DO UPDATE: o segundo enqueue nao pode reescrever o
        // primeiro — senao a colisao voltaria a custar escrita, so que silenciosa.
        controlAfterRow.run_id === 'controle-negativo',
      `created=${controlDup.created}, id=${controlDup.id}, linhas=${controlCount}, runId=${controlAfterRow?.run_id}`,
    )

    // (c) O DESFECHO QUE INTERESSA: o noop nao escreveu erro no log. Com o
    // `create` + catch antigo este check REPROVA — a colisao gera uma linha
    // `ERROR: duplicate key value violates unique constraint
    // "catalog_jobs_idempotency_key_key"`, identica a de producao.
    //
    // `xact_rollback` viaja junto como INFORMACAO, nunca como asserta. Medido em
    // 2026-08-27: com o codigo antigo o delta foi ZERO enquanto a linha de ERROR
    // apareceu. Ou seja, o contador nao acompanha este evento na janela em que se
    // le — quem o usasse como proxy mediria "zero duplicatas" com o defeito de
    // pe. Fica no relatorio so para que ninguem refaca a mesma aposta.
    const logAfter = readServerLog() ?? ''
    const logDelta = logAfter.slice(logBefore.length)
    const duplicateLines = logDelta
      .split(/\r?\n/)
      .filter((line) => /duplicate key value violates unique constraint/i.test(line))
    const rollbackAfter = Number(
      (
        await q<{ n: bigint }>(
          'SELECT xact_rollback AS n FROM pg_stat_database WHERE datname = current_database()',
        )
      )[0].n,
    )
    record(
      'controle negativo (c): o noop NAO escreveu ERROR no log do servidor',
      logAvailable && duplicateLines.length === 0,
      `linhas "duplicate key" no delta do log=${duplicateLines.length}, ` +
        `xact_rollback ${rollbackBefore}->${rollbackAfter} (informativo, NAO e o criterio)` +
        (duplicateLines.length > 0 ? ` | primeira: ${duplicateLines[0]!.slice(0, 160)}` : ''),
    )

    // prioridade: menor priority reivindicado primeiro
    await jobs.enqueue({
      jobType: 'sync_credits',
      entityType: 'movie',
      externalId: '900',
      idempotencyKey: 'k-lowprio',
      priority: 200,
    })
    await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'tv',
      externalId: '901',
      idempotencyKey: 'k-highprio',
      priority: 1,
    })
    const claimedHigh = await jobs.claimNext()
    record(
      'claim respeita prioridade (menor priority primeiro)',
      claimedHigh?.externalId === '901',
      `externalId=${claimedHigh?.externalId}`,
    )
    record(
      'claim incrementa attempts e retorna alvo',
      claimedHigh?.attempts === 1 && claimedHigh?.jobType === 'sync_details',
      `attempts=${claimedHigh?.attempts}`,
    )

    // heartbeat atualiza o carimbo
    clock.advanceMs(5_000)
    await jobs.heartbeat(claimedHigh!.id)
    const hb = (
      await q<{ heartbeat_at: Date }>(
        `SELECT heartbeat_at FROM catalog_jobs WHERE id = ${claimedHigh!.id}`,
      )
    )[0]
    record(
      'heartbeat atualiza heartbeat_at',
      hb.heartbeat_at.getTime() === clock.now().getTime(),
      `hb=${hb.heartbeat_at.toISOString()}`,
    )

    // complete
    await jobs.complete(claimedHigh!.id)
    const done = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${claimedHigh!.id}`)
    )[0]
    record('complete marca succeeded', done.status === 'succeeded', `status=${done.status}`)

    // claim avanca: reivindica o resto da fila; ids distintos; depois esgota.
    const drained = new Set<string>()
    let d = await jobs.claimNext()
    while (d) {
      drained.add(d.id)
      d = await jobs.claimNext()
    }
    const afterDrain = await jobs.claimNext()
    record(
      'claim avanca: jobs distintos ate esgotar (SKIP LOCKED nao re-entrega)',
      drained.size >= 2 && afterDrain === null,
      `distintos=${drained.size}, aposEsgotar=${afterDrain === null ? 'null' : 'nao-null'}`,
    )

    // fail -> retry_wait com backoff (job FRESCO, isolado do estado acumulado)
    await jobs.enqueue({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '800',
      idempotencyKey: 'k-retry',
    })
    const toFail = await jobs.claimNext()
    const failPlan = planFailure(
      { attempts: toFail!.attempts, maxAttempts: 5 },
      { code: 'tmdb_5xx', safe: 'upstream 503' },
      0,
    )
    const availableAt =
      failPlan.availableInMs === null
        ? null
        : new Date(clock.now().getTime() + failPlan.availableInMs)
    await jobs.applyFailure(toFail!.id, {
      status: failPlan.status,
      availableAt,
      lastErrorCode: failPlan.lastErrorCode,
      lastErrorSafe: failPlan.lastErrorSafe,
    })
    const retried = (
      await q<{ status: string; available_at: Date }>(
        `SELECT status, available_at FROM catalog_jobs WHERE id = ${toFail!.id}`,
      )
    )[0]
    const notClaimableNow = await jobs.claimNext()
    record(
      'falha com tentativas restantes -> retry_wait + backoff futuro (nao claimavel agora)',
      retried.status === 'retry_wait' &&
        retried.available_at.getTime() > clock.now().getTime() &&
        notClaimableNow === null,
      `status=${retried.status}, claimavelAgora=${notClaimableNow === null ? 'nao' : 'sim'}`,
    )

    // dead-letter: job que esgotou tentativas
    await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'movie',
      externalId: '950',
      idempotencyKey: 'k-dead',
      maxAttempts: 1,
    })
    const claimedDead = await jobs.claimNext() // attempts -> 1 == maxAttempts
    const deadPlan = planFailure(
      { attempts: claimedDead!.attempts, maxAttempts: claimedDead!.maxAttempts },
      { code: 'tmdb_404', safe: 'not found' },
      0,
    )
    await jobs.applyFailure(claimedDead!.id, {
      status: deadPlan.status,
      availableAt: null,
      lastErrorCode: deadPlan.lastErrorCode,
      lastErrorSafe: deadPlan.lastErrorSafe,
    })
    const dl = await jobs.listDeadLetter(10)
    record(
      'esgotar tentativas -> dead_letter + aparece no dead-letter list',
      deadPlan.status === 'dead_letter' && dl.some((j) => j.id === claimedDead!.id),
      `deadLetter=${dl.length}`,
    )

    // replay: dead_letter -> pending, attempts=0, claimavel de novo
    const replayed = await jobs.replayDeadLetter()
    const afterReplay = (
      await q<{ status: string; attempts: number }>(
        `SELECT status, attempts FROM catalog_jobs WHERE id = ${claimedDead!.id}`,
      )
    )[0]
    record(
      'replay: dead_letter -> pending (attempts=0)',
      replayed >= 1 && afterReplay.status === 'pending' && afterReplay.attempts === 0,
      `replayed=${replayed}, status=${afterReplay.status}, attempts=${afterReplay.attempts}`,
    )

    // replay com selecao VAZIA nao pode ressuscitar a fila inteira de poison.
    await jobs.enqueue({
      jobType: 'sync_media',
      entityType: 'tv',
      externalId: '951',
      idempotencyKey: 'k-dead2',
      maxAttempts: 1,
    })
    const claimedDead2 = await jobs.claimNext()
    const deadPlan2 = planFailure(
      { attempts: claimedDead2!.attempts, maxAttempts: claimedDead2!.maxAttempts },
      { code: 'x', safe: 'x' },
      0,
    )
    await jobs.applyFailure(claimedDead2!.id, {
      status: deadPlan2.status,
      availableAt: null,
      lastErrorCode: deadPlan2.lastErrorCode,
      lastErrorSafe: deadPlan2.lastErrorSafe,
    })
    const replayedEmpty = await jobs.replayDeadLetter([])
    const stillDead = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${claimedDead2!.id}`)
    )[0]
    record(
      'replay([]) e noop: selecao vazia NAO reprocessa a fila inteira',
      replayedEmpty === 0 && stillDead.status === 'dead_letter',
      `replayed=${replayedEmpty}, status=${stillDead.status}`,
    )

    // reclaim de orfao: job running com heartbeat expirado volta para a fila
    await jobs.enqueue({
      jobType: 'sync_lists',
      entityType: 'movie',
      externalId: '960',
      idempotencyKey: 'k-orphan',
    })
    // limpa a fila reivindicando tudo que estiver pendente ate achar o orfao alvo
    let orphan = await jobs.claimNext()
    while (orphan && orphan.externalId !== '960') orphan = await jobs.claimNext()
    record(
      'setup reclaim: job 960 reivindicado (running)',
      orphan?.externalId === '960',
      `claimed=${orphan?.externalId}`,
    )
    clock.advanceMs(120_000) // heartbeat fica velho
    const reclaim = await jobs.reclaimOrphans(30_000)
    const reclaimed = (
      await q<{ status: string }>(`SELECT status FROM catalog_jobs WHERE id = ${orphan!.id}`)
    )[0]
    record(
      'reclaim de orfao: running com heartbeat expirado -> requeue (retry_wait)',
      reclaim.requeued >= 1 && reclaimed.status === 'retry_wait',
      `requeued=${reclaim.requeued}, status=${reclaimed.status}`,
    )

    // ---------------------------------------------------------------------
    // Busca PostgreSQL
    // ---------------------------------------------------------------------
    const search = createPrismaSearchStore(prisma)
    const docs = [
      buildSearchDocument({
        entityType: 'movie',
        entityId: '603',
        locale: 'pt-BR',
        primaryText: 'Matrix',
        alternativeTitles: ['The Matrix'],
        year: 1999,
        popularity: 80,
      }),
      buildSearchDocument({
        entityType: 'movie',
        entityId: '604',
        locale: 'pt-BR',
        primaryText: 'Matrix Reloaded',
        year: 2003,
        popularity: 60,
      }),
      buildSearchDocument({
        entityType: 'person',
        entityId: '6384',
        locale: 'pt-BR',
        primaryText: 'Keanu Reeves',
        popularity: 90,
      }),
      buildSearchDocument({
        entityType: 'movie',
        entityId: '700',
        locale: 'pt-BR',
        primaryText: 'Amélie Poulain',
        year: 2001,
        popularity: 50,
      }),
      // Titulo LONGO com alias CURTO: a similaridade trgm do alias vs o
      // normalized_text concatenado (>130 chars) fica abaixo do limiar (0.3), entao
      // o casamento exato de alias DEVE vir do recall por normalized_aliases (a
      // regressao do bug: sem isso, buscar o alias exato dava zero resultados).
      buildSearchDocument({
        entityType: 'movie',
        entityId: '120',
        locale: 'pt-BR',
        primaryText: 'The Lord of the Rings The Fellowship of the Ring',
        alternativeTitles: [
          'A Sociedade do Anel',
          'El Senor de los Anillos La Comunidad del Anillo',
          'Le Seigneur des anneaux La Communaute de l Anneau',
        ],
        year: 2001,
        popularity: 70,
      }),
    ]
    for (const doc of docs) await search.upsertDocument(doc)
    // upsert idempotente: reprocessar nao duplica
    await search.upsertDocument(docs[0])
    const docCount = Number(
      (await q<{ c: bigint }>('SELECT count(*)::int AS c FROM search_documents'))[0].c,
    )
    record(
      'busca: upsert idempotente (5 documentos, sem duplicar)',
      docCount === 5,
      `docs=${docCount}`,
    )

    const exact = await search.search('Matrix', { locale: 'pt-BR' })
    record(
      'busca exact: "Matrix" -> titulo exato no topo (matchReason=exact)',
      exact[0]?.entityId === '603' && exact[0]?.matchReason === 'exact',
      `top=${exact[0]?.entityId}/${exact[0]?.matchReason}`,
    )

    const alias = await search.search('The Matrix', { locale: 'pt-BR' })
    record(
      'busca alias: "The Matrix" casa pelo titulo alternativo',
      alias.some(
        (r) => r.entityId === '603' && (r.matchReason === 'alias' || r.matchReason === 'exact'),
      ),
      `results=${alias.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    // Regressao do bug de recall: alias exato de titulo LONGO tem de casar como
    // 'alias' (nao pode ser filtrado pelo trgm do normalized_text concatenado).
    const longAlias = await search.search('A Sociedade do Anel', { locale: 'pt-BR' })
    record(
      'busca alias (titulo longo): "A Sociedade do Anel" casa como alias exato',
      longAlias.some((r) => r.entityId === '120' && r.matchReason === 'alias'),
      `results=${longAlias.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    const accent = await search.search('amelie', { locale: 'pt-BR' })
    record(
      'busca acento-insensivel: "amelie" encontra "Amélie Poulain"',
      accent.some((r) => r.entityId === '700'),
      `results=${accent.map((r) => r.entityId).join(',')}`,
    )

    const prefix = await search.search('Matr', { locale: 'pt-BR' })
    record(
      'busca prefixo: "Matr" retorna Matrix e Matrix Reloaded',
      prefix.some((r) => r.entityId === '603') && prefix.some((r) => r.entityId === '604'),
      `results=${prefix.map((r) => r.entityId).join(',')}`,
    )

    const fuzzy = await search.search('Keanu Reevs', { locale: 'pt-BR' })
    record(
      'busca fuzzy (trgm): "Keanu Reevs" (typo) encontra Keanu Reeves',
      fuzzy.some((r) => r.entityId === '6384'),
      `results=${fuzzy.map((r) => r.entityId + ':' + r.matchReason).join(',')}`,
    )

    const empty = await search.search('zzzqxwv-nao-existe', { locale: 'pt-BR' })
    record(
      'busca zero-results: termo inexistente retorna []',
      empty.length === 0,
      `results=${empty.length}`,
    )

    const blankTerm = await search.search('   ', { locale: 'pt-BR' })
    record(
      'busca: termo em branco nao toca o banco e retorna []',
      blankTerm.length === 0,
      `results=${blankTerm.length}`,
    )

    await runPipelineChecks(prisma, url)
    await runContractChecks(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Checks dos CONTRATOS PUBLICOS: semeia um catalogo minimo REAL (movie, tv,
 * season, episode, person, slugs, traducoes, midia com displayAllowed misto,
 * rating liberado + rating BLOQUEADO, oferta de streaming, snapshot, search
 * docs) e exercita os 10 getters de createPublicPayloadReader contra o
 * PostgreSQL de verdade. Prova o que os contract tests puros nao conseguem:
 * o WHERE dos gates de licenca roda no banco, nao num fake.
 */
async function runContractChecks(prisma: PrismaClient): Promise<void> {
  console.log('\n--- contratos publicos (getters reais) ---')

  // Dicionarios FK minimos (idempotentes).
  await prisma.language.upsert({
    where: { code: 'pt-BR' },
    create: { code: 'pt-BR', namePt: 'Portugues (Brasil)', nameEn: 'Portuguese (Brazil)', isPublished: true, indexDefault: true },
    update: {},
  })
  // 'pt' existe para o teste de prioridade de locale (pt-BR vence pt).
  await prisma.language.upsert({
    where: { code: 'pt' },
    create: { code: 'pt', namePt: 'Portugues', nameEn: 'Portuguese', isPublished: true, indexDefault: false },
    update: {},
  })
  await prisma.country.upsert({
    where: { code: 'BR' },
    create: { code: 'BR', namePt: 'Brasil', nameEn: 'Brazil' },
    update: {},
  })
  await prisma.ratingSource.upsert({
    where: { key: 'imdb' },
    create: { key: 'imdb', label: 'IMDb', scale: 10 },
    update: {},
  })
  await prisma.ratingSource.upsert({
    where: { key: 'rotten_tomatoes' },
    create: { key: 'rotten_tomatoes', label: 'Rotten Tomatoes', scale: 100 },
    update: {},
  })
  await prisma.apiProvider.upsert({
    where: { key: 'imdb236' },
    create: { key: 'imdb236', name: 'imdb236 (RapidAPI)', kind: 'ratings' },
    update: {},
  })
  // Backend B: watch_availability.provider_api virou FK real -> api_providers.
  await prisma.apiProvider.upsert({
    where: { key: 'streaming_availability' },
    create: { key: 'streaming_availability', name: 'Streaming Availability (RapidAPI)', kind: 'streaming' },
    update: {},
  })

  // --- catalogo minimo ------------------------------------------------------
  const movie = await prisma.movie.create({
    data: { tmdbId: 777001, titleOriginal: 'The Contract Movie', releaseDate: new Date('1999-03-31'), runtimeMinutes: 120, certification: '14', posterPath: '/contract-ok.jpg' },
  })
  const person = await prisma.person.create({
    data: { tmdbId: 777002, name: 'Contract Person' },
  })
  const show = await prisma.tvShow.create({
    data: { tmdbId: 777003, nameOriginal: 'The Contract Show', firstAirDate: new Date('2011-04-17'), numberOfSeasons: 1, numberOfEpisodes: 1 },
  })
  const season = await prisma.season.create({
    data: { tvShowId: show.id, seasonNumber: 1, name: 'Temporada 1', episodeCount: 1 },
  })
  const seededEpisode = await prisma.episode.create({
    data: { seasonId: season.id, tvShowId: show.id, tmdbId: 777004, episodeNumber: 1, name: 'Piloto', airDate: new Date('2011-04-17'), runtimeMinutes: 60 },
  })

  const slugRows = [
    { entityType: 'movie', entityId: movie.id, slug: 'contract-movie' },
    { entityType: 'tv', entityId: show.id, slug: 'contract-show' },
    { entityType: 'person', entityId: person.id, slug: 'contract-person' },
  ] as const
  for (const row of slugRows) {
    await prisma.slug.create({
      data: { entityType: row.entityType, entityId: row.entityId, languageCode: 'pt-BR', slug: row.slug, isCanonical: true },
    })
  }
  await prisma.entityTranslation.create({
    data: { entityType: 'movie', entityId: movie.id, languageCode: 'pt-BR', title: 'O Filme do Contrato', summary: 'Sinopse propria de teste.', metaTitle: 'Filme do Contrato', metaDescription: 'Ficha do filme.' },
  })
  await prisma.castMember.create({
    data: { personId: person.id, entityType: 'movie', entityId: movie.id, character: 'Protagonista', billingOrder: 1, creditId: 'contract-credit-1' },
  })
  const collection = await prisma.collection.create({ data: { tmdbId: 777005, name: 'Colecao do Contrato' } })
  await prisma.movieCollectionMembership.create({ data: { collectionId: collection.id, movieId: movie.id } })
  await prisma.entityAlternativeTitle.create({
    data: { entityType: 'movie', entityId: movie.id, title: 'Contract Movie Alias', normalized: 'contract movie alias' },
  })

  // Midia: liberada + BLOQUEADA com voto maior (o caso que viraria poster).
  await prisma.tmdbImage.createMany({
    data: [
      { entityType: 'movie', tmdbId: 777001, imageType: 'poster', filePath: '/contract-ok.jpg', voteAverage: 7, payloadHash: 'h1', displayAllowed: true },
      { entityType: 'movie', tmdbId: 777001, imageType: 'poster', filePath: '/contract-blocked.jpg', voteAverage: 9.9, payloadHash: 'h2', displayAllowed: false },
    ],
  })
  await prisma.tmdbVideo.createMany({
    data: [
      { entityType: 'movie', tmdbId: 777001, tmdbVideoId: 'ct1', site: 'YouTube', videoKey: 'okvideo', videoType: 'Trailer', official: true, payloadHash: 'h3', displayAllowed: true },
      { entityType: 'movie', tmdbId: 777001, tmdbVideoId: 'ct2', site: 'YouTube', videoKey: 'blockedvid', videoType: 'Clip', payloadHash: 'h4', displayAllowed: false },
    ],
  })

  // Ratings: liberado + BLOQUEADO por licenca (o segundo NAO pode aparecer).
  // Nascem display_allowed=false (default seguro). O trigger fail-closed do
  // Backend B (external_ratings_display_guard) rejeita insercao direta de
  // display_allowed=true — ele bloqueou a primeira versao deste seed, exatamente
  // como o guard da Fase 2 bloqueou o seed de watch_availability logo abaixo:
  // governanca funcionando. A promocao do IMDb passa pela cadeia governada:
  // licenca de rating + DataUsageDecision vigente + fingerprint (no banco) +
  // revisor humano.
  await prisma.externalRating.createMany({
    data: [
      { entityType: 'movie', entityId: movie.id, ratingSource: 'imdb', ratingLabel: 'IMDb Rating', metric: 'user_rating', scoreType: 'audience', ratingValue: 8.4, ratingScale: 10, providerApi: 'imdb236', licenseStatus: 'licensed', requiresAttribution: true, requiresLinkback: true, attributionText: 'Nota fornecida por IMDb', attributionUrl: 'https://www.imdb.com/title/tt777001/' },
      { entityType: 'movie', entityId: movie.id, ratingSource: 'rotten_tomatoes', ratingLabel: 'Tomatometer', metric: 'tomatometer', scoreType: 'critics', ratingValue: 95, ratingScale: 100, providerApi: 'imdb236', licenseStatus: 'unknown' },
    ],
  })
  await prisma.$executeRawUnsafe(
    `INSERT INTO source_licenses (source_key, content_type, rating_source_key, provider_key, license_status, display_allowed, score_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
     VALUES ('imdb','rating','imdb','imdb236','licensed',true,true,true,true,'Nota fornecida por IMDb',true,'validator-contract-check',now(),'contract/v1',now())`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at)
     SELECT id, 'rating_display', 'approved_for_display', true, true, true, true, 'contract/v1', 'validator-contract-check', 'contrato de validacao', now()
       FROM source_licenses WHERE source_key='imdb' AND content_type='rating' AND provider_key='imdb236' AND is_current`,
  )
  await prisma.$executeRawUnsafe(
    `UPDATE external_ratings r
        SET display_allowed = true,
            reviewed_at = now(),
            reviewed_by = 'validator-contract-check',
            data_usage_decision_id = (
              SELECT d.id FROM data_usage_decisions d
                JOIN source_licenses l ON l.id = d.source_license_id
               WHERE d.use_case = 'rating_display' AND d.is_current AND d.stage = 'approved_for_display'
                 AND l.content_type = 'rating' AND l.rating_source_key = 'imdb' LIMIT 1),
            approved_payload_hash = external_rating_payload_fingerprint_v1(
              r.entity_type, r.entity_id, r.rating_source, r.metric, r.score_type, r.rating_label,
              r.rating_value, r.rating_scale, r.rating_count, r.rating_url, r.provider_api,
              r.license_status, r.requires_attribution, r.requires_linkback, r.attribution_text, r.attribution_url)
      WHERE r.entity_id = $1 AND r.rating_source = 'imdb'`,
    movie.id,
  )
  // Ofertas nascem display_allowed=false (default seguro). A promocao passa
  // pelo MESMO caminho do CLI humano: UPDATE com o fingerprint computado NO
  // BANCO (watch_offer_payload_fingerprint_v1) + reviewed_at/reviewed_by —
  // o trigger fail-closed da Fase 2 rejeita qualquer atalho (ele bloqueou a
  // primeira versao deste seed, que tentava inserir display_allowed=true
  // direto: governanca funcionando).
  //
  // Backend B endureceu esse guard: exibir passou a exigir tambem provedor
  // CANONICO (resolvido por alias, nunca pelo nome) + DataUsageDecision vigente
  // de watch_offer_display cuja licenca seja a daquele provedor (source_key =
  // slug). ExemploFlix ganha essa cadeia; PirataFlix fica sem alias/licenca e
  // por isso permanece bloqueado (o resultado que este check ja provava).
  await prisma.watchAvailability.createMany({
    data: [
      { entityType: 'movie', entityId: movie.id, countryCode: 'BR', providerKey: 'exemploflix', providerName: 'ExemploFlix', offerType: 'subscription', deepLink: 'https://exemplo.test/contract', providerApi: 'streaming_availability', licenseStatus: 'licensed', attributionText: 'Oferta via ExemploFlix', attributionUrl: 'https://exemplo.test/contract' },
      { entityType: 'movie', entityId: movie.id, countryCode: 'BR', providerName: 'PirataFlix', offerType: 'subscription', deepLink: 'https://pirata.test/contract' },
    ],
  })
  await prisma.$executeRawUnsafe(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('exemploflix','ExemploFlix','https://exemplo.test/', now())`)
  await prisma.$executeRawUnsafe(
    `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
     SELECT id, 'streaming_availability', 'exemploflix', 'ExemploFlix', now() FROM watch_providers WHERE slug='exemploflix'`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
     VALUES ('exemploflix','watch_availability','streaming_availability','BR','official',true,true,true,'Oferta via ExemploFlix',true,'validator-contract-check',now(),'contract/v1',now())`,
  )
  await prisma.$executeRawUnsafe(
    `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at)
     SELECT id, 'watch_offer_display', 'BR', 'approved_for_display', true, true, true, true, 'contract/v1', 'validator-contract-check', 'contrato de validacao', now()
       FROM source_licenses WHERE source_key='exemploflix' AND content_type='watch_availability' AND is_current`,
  )
  await prisma.$executeRawUnsafe(
    `UPDATE watch_availability w
        SET display_allowed = true,
            reviewed_at = now(),
            reviewed_by = 'validator-contract-check',
            watch_provider_id = (SELECT id FROM watch_providers WHERE slug = 'exemploflix'),
            data_usage_decision_id = (
              SELECT d.id FROM data_usage_decisions d
                JOIN source_licenses l ON l.id = d.source_license_id
               WHERE d.use_case = 'watch_offer_display' AND d.is_current AND d.stage = 'approved_for_display'
                 AND l.content_type = 'watch_availability' AND l.source_key = 'exemploflix' LIMIT 1),
            approved_payload_hash = watch_offer_payload_fingerprint_v1(
              w.provider_api, w.external_offer_id, w.entity_type, w.entity_id,
              w.country_code, w.offer_type, w.provider_key, w.provider_name,
              w.package, w.quality, w.price, w.currency, w.deep_link, w.web_url,
              w.available_from, w.available_until, w.license_status,
              w.requires_attribution, w.requires_linkback, w.attribution_text,
              w.attribution_url)
      WHERE w.provider_name = 'ExemploFlix' AND w.entity_id = $1`,
    movie.id,
  )

  // Snapshot de descoberta + search docs.
  const snapshots = createPrismaDiscoverySnapshotStore(prisma)
  await snapshots.saveSnapshot({
    // Identidade SEM country/window: e a identidade canonica que os getters de
    // home/descoberta consultam (readLatestValid com country=null/window=null).
    listType: 'trending', entityType: 'movie', locale: 'pt-BR', country: null, window: null,
    capturedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000), provider: 'tmdb', payloadHash: 'contract-snap',
    items: [{ entityTmdbId: 777001, position: 0, providerScore: 9 }],
  })
  const search = createPrismaSearchStore(prisma)
  await search.upsertDocument(
    buildSearchDocument({
      entityType: 'movie', entityId: movie.id.toString(), locale: 'pt-BR',
      primaryText: 'O Filme do Contrato', alternativeTitles: ['Contract Movie Alias'],
      year: 1999, popularity: 9, imagePath: '/contract-ok.jpg',
      canonicalUrl: '/pt/filmes/contract-movie/', subtitle: 'Filme · 1999',
    }),
  )

  // --- getters --------------------------------------------------------------
  const { createPublicPayloadReader } = await import('../src/persistence/public-payload-reader.js')
  const reader = createPublicPayloadReader(prisma, {
    siteOrigin: 'https://cinerie.com',
    locale: 'pt-BR',
    // Adapter de ratings injetado (a porta existe porque services/ingestion NAO
    // pode referenciar ratings — inv. 1/2; o dominio de ratings fornece isto).
    ratings: {
      async readApproved(entityType, entityId) {
        const rows = await prisma.externalRating.findMany({
          where: { entityType, entityId, displayAllowed: true, licenseStatus: { notIn: ['unknown', 'blocked'] } },
          orderBy: { id: 'asc' },
        })
        return rows.map((r) => ({
          source: r.ratingSource, label: r.ratingLabel, value: Number(r.ratingValue), scale: r.ratingScale,
          url: r.ratingUrl, attributionText: r.attributionText, attributionUrl: r.attributionUrl,
        }))
      },
    },
  })

  const movieDetail = await reader.getMovieDetailPayload('contract-movie')
  record('contract movie: getter produz payload validado', movieDetail !== null && movieDetail.title === 'O Filme do Contrato' && movieDetail.canonicalUrl === 'https://cinerie.com/pt/filmes/contract-movie/', `title=${movieDetail?.title}`)
  record('contract movie: midia bloqueada NAO chega (nem como poster de maior voto)', movieDetail !== null && movieDetail.media.poster?.url === 'https://image.tmdb.org/t/p/w500/contract-ok.jpg' && !JSON.stringify(movieDetail.media).includes('blocked'), `poster=${movieDetail?.media.poster?.url}`)
  record('contract movie: rating com licenca bloqueada NAO chega (inv. 6)', movieDetail !== null && movieDetail.ratings.length === 1 && movieDetail.ratings[0]?.source === 'imdb' && !JSON.stringify(movieDetail.ratings).includes('tomatometer'.toUpperCase()) && !JSON.stringify(movieDetail.ratings).toLowerCase().includes('rotten'), `ratings=${movieDetail?.ratings.map((r) => r.source).join(',')}`)
  record('contract movie: oferta nao liberada NAO chega (inv. 6/8)', movieDetail !== null && movieDetail.streaming.length === 1 && movieDetail.streaming[0]?.provider === 'ExemploFlix', `streaming=${movieDetail?.streaming.map((s) => s.provider).join(',')}`)
  record('contract movie: sem raw TMDB nem file_path cru no payload', movieDetail !== null && !JSON.stringify(movieDetail).includes('file_path') && !JSON.stringify(movieDetail).includes('"/contract-ok.jpg"'), 'payload limpo')
  record('contract movie: JSON-safe (BigInt/Date nao vazam)', movieDetail !== null && typeof JSON.stringify(movieDetail) === 'string' && typeof movieDetail.id === 'string' && movieDetail.releaseDate === '1999-03-31', `id=${typeof movieDetail?.id} date=${movieDetail?.releaseDate}`)

  const tvDetail = await reader.getTvDetailPayload('contract-show')
  record('contract tv: payload com temporadas e rota composta', tvDetail !== null && tvDetail.seasons.length === 1 && tvDetail.seasons[0]?.canonicalUrl === 'https://cinerie.com/pt/series/contract-show/temporadas/1/', `seasons=${tvDetail?.seasons.length}`)

  const seasonDetail = await reader.getSeasonDetailPayload('contract-show', 1)
  record('contract season: payload com episodios ordenados', seasonDetail !== null && seasonDetail.episodes[0]?.episodeNumber === 1 && seasonDetail.series.kind === 'tv', `episodes=${seasonDetail?.episodes.length}`)

  const episodeDetail = await reader.getEpisodeDetailPayload('contract-show', 1, 1)
  record('contract episode: payload validado com URL composta e id do banco', episodeDetail !== null && episodeDetail.canonicalUrl.endsWith('/temporadas/1/episodios/1/') && episodeDetail.id === seededEpisode.id.toString(), `url=${episodeDetail?.canonicalUrl}`)

  const personDetail = await reader.getPersonDetailPayload('contract-person')
  record('contract person: payload validado (bio bloqueada = null)', personDetail !== null && personDetail.name === 'Contract Person' && personDetail.biography === null, `name=${personDetail?.name}`)

  const home = await reader.getHomePayload()
  record('contract home: trending vem do snapshot governado', home.trending.length === 1 && home.trending[0]?.title === 'O Filme do Contrato' && home.trending[0]?.image?.url.startsWith('https://image.tmdb.org/'), `trending=${home.trending.length}`)

  const discovery = await reader.getDiscoveryPayload('trending', 'movie')
  record('contract discovery: snapshot -> payload com capturedAt ISO', discovery !== null && discovery.items.length === 1 && typeof discovery.capturedAt === 'string', `items=${discovery?.items.length}`)

  const searchPayload = await reader.getSearchPayload('o filme do contrato')
  record('contract search: resultado real + superficie noindex', searchPayload.results.length >= 1 && searchPayload.index === false && searchPayload.results[0]?.canonicalUrl.startsWith('https://cinerie.com/'), `results=${searchPayload.results.length}`)

  const mediaPayload = await reader.getMediaPayload('movie', 777001, 'O Filme do Contrato')
  record('contract media: fail-closed no getter dedicado', mediaPayload.images.every((i) => i.displayAllowed) && !JSON.stringify(mediaPayload).includes('blocked'), `images=${mediaPayload.images.length}`)

  const status = await reader.getCatalogStatusPayload()
  record('contract status: contagens da fila real', typeof status.counts.pending === 'number' && Array.isArray(status.deadLetter), `pending=${status.counts.pending}`)

  const missing = await reader.getMovieDetailPayload('slug-que-nao-existe')
  record('contract 404 tecnico: slug inexistente devolve null (nunca payload pela metade)', missing === null, `missing=${String(missing)}`)

  // --- indexabilidade: decisao autoritativa, fail-closed --------------------
  // O filme semeado NAO tem decisao registrada: o contrato NAO pode indexa-lo
  // so porque ele tem slug e traducao.
  record(
    'indexabilidade: sem decisao vigente => index=false (fail-closed)',
    movieDetail !== null && movieDetail.seo.index === false && movieDetail.seo.robots === 'noindex,follow',
    `index=${movieDetail?.seo.index} robots=${movieDetail?.seo.robots}`,
  )
  record(
    'indexabilidade: slug + traducao presentes NAO implicam index=true',
    movieDetail !== null && movieDetail.canonicalUrl.includes('/contract-movie/') && movieDetail.title === 'O Filme do Contrato' && movieDetail.seo.index === false,
    'slug e rota; indexabilidade e decisao',
  )

  /** Grava a decisao vigente do filme e devolve o SEO projetado pelo getter. */
  async function seoWithDecision(decision: string, reason: string) {
    await prisma.pageIndexabilityDecision.deleteMany({ where: { entityType: 'movie', entityId: movie.id } })
    await prisma.pageIndexabilityDecision.create({
      data: {
        entityType: 'movie', entityId: movie.id, languageCode: 'pt-BR',
        url: 'https://cinerie.com/pt/filmes/contract-movie/',
        decision: decision as never, reason, isCurrent: true,
        decisionOrigin: 'validator', policyVersion: '2026-07', decidedAt: new Date(),
      },
    })
    const payload = await reader.getMovieDetailPayload('contract-movie')
    return payload?.seo ?? null
  }

  const seoIndex = await seoWithDecision('index', 'entidade completa')
  record(
    'indexabilidade: decisao "index" => index=true, index,follow',
    seoIndex?.index === true && seoIndex.robots === 'index,follow',
    `index=${seoIndex?.index} robots=${seoIndex?.robots}`,
  )

  const seoThin = await seoWithDecision('noindex', 'conteudo fino (thin)')
  record(
    'indexabilidade: noindex (thin) => index=false, noindex,nofollow',
    seoThin?.index === false && seoThin.robots === 'noindex,nofollow',
    `index=${seoThin?.index} robots=${seoThin?.robots}`,
  )

  const seoBlocked = await seoWithDecision('blocked', 'licenca bloqueada')
  record(
    'indexabilidade: blocked (licenca) => index=false, noindex,nofollow',
    seoBlocked?.index === false && seoBlocked.robots === 'noindex,nofollow',
    `index=${seoBlocked?.index} robots=${seoBlocked?.robots}`,
  )

  const seoStale = await seoWithDecision('stale', 'retirado do indice ate revalidar')
  record(
    'indexabilidade: stale (retirado) => index=false, noindex,follow',
    seoStale?.index === false && seoStale.robots === 'noindex,follow',
    `index=${seoStale?.index} robots=${seoStale?.robots}`,
  )

  const seoDraft = await seoWithDecision('draft', 'idioma nao publicado')
  record(
    'indexabilidade: draft => index=false, noindex,follow',
    seoDraft?.index === false && seoDraft.robots === 'noindex,follow',
    `index=${seoDraft?.index} robots=${seoDraft?.robots}`,
  )

  // Decisao NAO vigente (is_current=false) nao governa: volta ao fail-closed.
  await prisma.pageIndexabilityDecision.updateMany({
    where: { entityType: 'movie', entityId: movie.id },
    data: { decision: 'index', isCurrent: false },
  })
  const seoSuperseded = (await reader.getMovieDetailPayload('contract-movie'))?.seo
  record(
    'indexabilidade: decisao NAO vigente (is_current=false) nao indexa',
    seoSuperseded?.index === false,
    `index=${seoSuperseded?.index}`,
  )

  record(
    'indexabilidade: index e robots nunca se contradizem',
    [seoIndex, seoThin, seoBlocked, seoStale, seoDraft, seoSuperseded ?? null].every(
      (seo) => seo === null || seo.robots.startsWith('index,') === seo.index,
    ),
    'consistencia verificada nas 6 projecoes',
  )

  // --- prioridade deterministica de locale (pt-BR > pt) ---------------------
  // Ordem de insercao ADVERSARIAL: pt-BR PRIMEIRO, pt DEPOIS. O Postgres tende
  // a devolver na ordem fisica, entao `new Map(rows.map(...))` — que deixa a
  // ULTIMA linha vencer — daria 'pt'. So a prioridade EXPLICITA de
  // `pickByLocale` faz pt-BR ganhar. (A ordem oposta tornaria o check vacuo:
  // o codigo bugado passaria por acidente.)
  const dual = await prisma.movie.create({
    data: { tmdbId: 777006, titleOriginal: 'Dual Locale', releaseDate: new Date('2020-01-01'), posterPath: '/contract-ok.jpg' },
  })
  await prisma.slug.create({
    data: { entityType: 'movie', entityId: dual.id, languageCode: 'pt-BR', slug: 'dual-locale-ptbr', isCanonical: true },
  })
  await prisma.slug.create({
    data: { entityType: 'movie', entityId: dual.id, languageCode: 'pt', slug: 'dual-locale-pt', isCanonical: true },
  })
  await prisma.entityTranslation.create({
    data: { entityType: 'movie', entityId: dual.id, languageCode: 'pt-BR', title: 'Titulo PT-BR' },
  })
  await prisma.entityTranslation.create({
    data: { entityType: 'movie', entityId: dual.id, languageCode: 'pt', title: 'Titulo PT' },
  })
  await prisma.pageIndexabilityDecision.createMany({
    data: [
      { entityType: 'movie', entityId: dual.id, languageCode: 'pt-BR', url: 'x', decision: 'index', isCurrent: true },
      { entityType: 'movie', entityId: dual.id, languageCode: 'pt', url: 'x', decision: 'blocked', isCurrent: true },
    ],
  })

  const dualDetail = await reader.getMovieDetailPayload('dual-locale-ptbr')
  record(
    'locale: traducao pt-BR vence pt (linhas inseridas na ordem inversa)',
    dualDetail?.title === 'Titulo PT-BR',
    `title=${dualDetail?.title}`,
  )
  record(
    'locale: decisao pt-BR vence pt (index, nao blocked)',
    dualDetail?.seo.index === true && dualDetail.seo.robots === 'index,follow',
    `index=${dualDetail?.seo.index} robots=${dualDetail?.seo.robots}`,
  )

  // Card (lote): o mesmo empate resolvido em cardsOf/personSlugs.
  await snapshots.saveSnapshot({
    listType: 'popular', entityType: 'movie', locale: 'pt-BR', country: null, window: null,
    capturedAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000), provider: 'tmdb', payloadHash: 'dual-snap',
    items: [{ entityTmdbId: 777006, position: 0, providerScore: 5 }],
  })
  const dualDiscovery = await reader.getDiscoveryPayload('popular', 'movie')
  record(
    'locale em LOTE: card usa titulo/slug pt-BR (cardsOf deterministico)',
    dualDiscovery?.items[0]?.title === 'Titulo PT-BR' && dualDiscovery.items[0]?.href.includes('/dual-locale-ptbr/'),
    `title=${dualDiscovery?.items[0]?.title} href=${dualDiscovery?.items[0]?.href}`,
  )
}

/**
 * Checks do PIPELINE OPERACIONAL: registry completo, worker executando handlers
 * REAIS contra o banco real, bootstrap idempotente/resume, changes com commit e
 * rollback transacional, snapshots com hash-noop e auditoria read-only.
 *
 * Nenhum destes toca TMDB/RapidAPI/Gemini: os servicos entram por fakes
 * determinísticos. O que se prova aqui e a fronteira com o PostgreSQL — claim
 * concorrente, transacao, unique, checkpoint — que so o banco real garante.
 */
async function runPipelineChecks(prisma: PrismaClient, url: string): Promise<void> {
  const store = createPrismaCatalogJobStore(prisma)
  const snapshots = createPrismaDiscoverySnapshotStore(prisma)
  const checkpoint = createPrismaChangesCheckpoint(prisma)
  const metrics = createInMemoryMetricsSink()

  console.log('\n--- pipeline operacional (handlers reais) ---')

  // Os checks da fila (1-15) deixam jobs de sonda em `pending`/`retry_wait` — e
  // `retry_wait` E claimable. Sem limpar, o worker deste bloco reivindicaria
  // aquelas sondas (payload de teste) em vez dos jobs do pipeline, e o resultado
  // seria ruido, nao sinal. Banco efemero: truncar aqui e seguro e deixa os
  // checks abaixo determinísticos.
  await prisma.catalogJob.deleteMany({})
  await prisma.discoverySnapshot.deleteMany({})
  await prisma.tmdbSyncCheckpoint.deleteMany({})

  // Servicos fake: determinísticos, sem rede. O alvo do teste e o caminho ate o
  // banco, nao o provider.
  const calls = { detail: 0, media: 0, lists: 0, changes: 0 }
  const deps = {
    store,
    detailSync: {
      async syncDetail({ tmdbId }: { tmdbId: number }) {
        calls.detail += 1
        return {
          created: true,
          updated: false,
          unchanged: false,
          entityId: String(tmdbId),
          skipped: false,
          skipReason: null,
        }
      },
    },
    creditsSync: {
      async syncCredits() {
        return { cast: 1, crew: 1, guestStars: 0, skipped: false, skipReason: null }
      },
    },
    externalIdsSync: {
      async syncExternalIds() {
        return { upserted: 1, changed: 0, skipped: false, skipReason: null }
      },
    },
    mediaSync: {
      async syncMedia() {
        calls.media += 1
        return { images: 2, videos: 1, skipped: false, skipReason: null }
      },
    },
    seasonsSync: {
      async syncSeasons() {
        return { seasons: 1, episodes: 0, seasonNumbers: [1], skipped: false, skipReason: null }
      },
    },
    episodesSync: {
      async syncEpisodes() {
        return {
          episodes: 1,
          cast: 1,
          guestStars: 1,
          crew: 1,
          externalIds: 1,
          stills: 1,
          skippedNoTmdbId: 0,
          skipped: false,
          skipReason: null,
        }
      },
    },
    discovery: {
      async discover() {
        return { discovered: 2, accepted: 2, rejectedAdult: 1, duplicate: 0, ids: [603, 604] }
      },
    },
    reprocessRaw: {
      async reprocess() {
        return { scanned: 0, promoted: 0, unchanged: 0, skipped: 0, failed: 0, dryRun: true }
      },
    },
    listFetch: {
      async fetchPage({ page }: { page: number }) {
        calls.lists += 1
        return page === 1
          ? { results: [{ id: 603, popularity: 9 }, { id: 604, popularity: 8 }], page: 1, total_pages: 1 }
          : { results: [], page, total_pages: 1 }
      },
    },
    snapshots,
    changes: {
      async fetchChanges(_kind: string, params: { page: number }) {
        calls.changes += 1
        return { results: [{ id: 603 }, { id: 604 }], page: params.page, total_pages: 1 }
      },
      checkpoint,
      now: () => new Date('2026-07-16T00:00:00.000Z'),
    },
    search: {
      async reindexEntity() {},
    },
    now: () => new Date('2026-07-16T12:00:00.000Z'),
  }

  const registry = createCatalogHandlerRegistry(deps as never)
  record(
    'registry de producao registra os 11 tipos do enum',
    registry.types().length === 11 && CATALOG_JOB_TYPES.every((t) => registry.has(t)),
    `types=${registry.types().length}`,
  )

  // --- bootstrap: enfileira e retoma sem duplicar -------------------------
  const bootstrapJob = await store.enqueue({
    jobType: 'bootstrap',
    idempotencyKey: buildIdempotencyKey({ jobType: 'bootstrap', discriminator: 'validator' }),
    payload: { strategy: 'daily-exports', entityTypes: ['movie'], locale: 'pt-BR' },
    runId: 'validator-run',
  })
  record('bootstrap enfileirado', bootstrapJob.created, `id=${bootstrapJob.id}`)

  const worker1 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 1, maxJobs: 1, drain: true, runId: 'validator' },
  )
  record(
    'worker executa o bootstrap real (handler, nao no_handler)',
    worker1.succeeded === 1 && worker1.deadLettered === 0,
    `ok=${worker1.succeeded} dead=${worker1.deadLettered}`,
  )

  const afterBootstrap = await prisma.catalogJob.count({ where: { jobType: 'discover_ids' } })
  record(
    'bootstrap enfileirou discover_ids de verdade',
    afterBootstrap === 1,
    `discover_ids=${afterBootstrap}`,
  )

  const listJobs = await prisma.catalogJob.count({ where: { jobType: 'sync_lists' } })
  record('bootstrap enfileirou snapshots de lista', listJobs > 0, `sync_lists=${listJobs}`)

  // Resume: mesmo requestId => tudo vira noop idempotente (nenhuma duplicata).
  const replayBootstrap = await store.enqueue({
    jobType: 'bootstrap',
    idempotencyKey: buildIdempotencyKey({ jobType: 'bootstrap', discriminator: 'validator' }),
    payload: {},
  })
  record(
    'bootstrap idempotente: mesma chave nao duplica',
    !replayBootstrap.created,
    `created=${replayBootstrap.created}`,
  )

  // --- cascata: discover_ids -> sync_details -> sync_media ----------------
  const worker2 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 2, maxJobs: 40, drain: true, runId: 'validator' },
  )
  record(
    'worker drena a cascata sem dead-letter',
    worker2.deadLettered === 0,
    `claimed=${worker2.claimed} ok=${worker2.succeeded} dead=${worker2.deadLettered}`,
  )
  record(
    'discover_ids enfileirou sync_details reais',
    (await prisma.catalogJob.count({ where: { jobType: 'sync_details' } })) === 2,
    `sync_details=${await prisma.catalogJob.count({ where: { jobType: 'sync_details' } })}`,
  )
  record(
    'sync_details chamou o servico e enfileirou sync_media',
    calls.detail === 2 && (await prisma.catalogJob.count({ where: { jobType: 'sync_media' } })) === 2,
    `detail=${calls.detail} media_jobs=${await prisma.catalogJob.count({ where: { jobType: 'sync_media' } })}`,
  )
  record('sync_media executou o servico real', calls.media === 2, `media=${calls.media}`)

  // --- snapshot: criado, e hash-noop na repeticao -------------------------
  const snapshotRows = await prisma.discoverySnapshot.count()
  record('sync_lists persistiu snapshot no banco', snapshotRows > 0, `snapshots=${snapshotRows}`)

  const listsHandler = registry.get('sync_lists')
  const listCtx = {
    jobId: 'inline', requestId: 'validator', attempt: 1,
    signal: new AbortController().signal,
    heartbeat: async () => {}, log: { log: () => {} }, metrics,
  }
  const firstSnap = await listsHandler!.execute(
    listCtx as never,
    listsHandler!.validateInput({ listType: 'popular', entityType: 'movie', locale: 'pt-BR' }) as never,
  )
  const secondSnap = await listsHandler!.execute(
    listCtx as never,
    listsHandler!.validateInput({ listType: 'popular', entityType: 'movie', locale: 'pt-BR' }) as never,
  )
  record(
    'snapshot hash-noop: lista inalterada nao cria snapshot novo',
    (secondSnap as { created: boolean }).created === false,
    `first=${(firstSnap as { created: boolean }).created} second=${(secondSnap as { created: boolean }).created}`,
  )

  // --- changes: commit atomico, checkpoint e retomada ---------------------
  const changesHandler = registry.get('sync_changes')
  const changesCtx = { ...listCtx, jobId: 'inline-changes' }
  const changesReport = (await changesHandler!.execute(
    changesCtx as never,
    changesHandler!.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }) as never,
  )) as { totalEnqueued: number }
  record(
    'changes executa e enfileira re-sync dos ids alterados',
    changesReport.totalEnqueued > 0,
    `enqueued=${changesReport.totalEnqueued}`,
  )

  const cp = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:movie' } })
  record(
    'checkpoint de changes gravado apos o commit',
    cp !== null && cp.done === true,
    `job=${cp?.job} lastPage=${cp?.lastPage} done=${cp?.done}`,
  )

  const replayChanges = (await changesHandler!.execute(
    changesCtx as never,
    changesHandler!.validateInput({ kinds: ['movie'], from: '2026-07-15', to: '2026-07-16' }) as never,
  )) as { kinds: readonly { skipped: boolean }[] }
  record(
    'changes: janela ja concluida e noop na reexecucao',
    replayChanges.kinds[0]?.skipped === true,
    `skipped=${replayChanges.kinds[0]?.skipped}`,
  )

  // ROLLBACK: o commit e uma transacao unica (jobs + checkpoint). Se ela falha,
  // o checkpoint NAO pode avancar — senao a janela seria dada como processada
  // sem os jobs existirem, e a retomada pularia dados de verdade.
  const before = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:tv' } })
  let rolledBack = false
  try {
    await checkpoint.commit({
      job: 'changes:tv',
      paramsHash: '2026-07-15:2026-07-16',
      lastPage: 1,
      totalPages: 1,
      done: true,
      cursor: '2026-07-15:2026-07-16',
      // idempotencyKey null viola NOT NULL => a transacao inteira aborta.
      enqueue: [{ jobType: 'sync_details', idempotencyKey: null as never, entityType: 'tv', externalId: '1' }],
    })
  } catch {
    rolledBack = true
  }
  const after = await prisma.tmdbSyncCheckpoint.findFirst({ where: { job: 'changes:tv' } })
  record(
    'changes rollback: falha no lote NAO avanca o checkpoint',
    rolledBack && after?.lastPage === before?.lastPage,
    `rolledBack=${rolledBack} before=${before?.lastPage ?? 'null'} after=${after?.lastPage ?? 'null'}`,
  )

  // --- metricas ----------------------------------------------------------
  const jobsTotal = metrics
    .samples()
    .filter((s) => s.name === CATALOG_METRIC_NAMES.jobsTotal)
    .reduce((sum, s) => sum + s.value, 0)
  record('metricas emitidas no fluxo real', jobsTotal > 0, `catalog_jobs_total=${jobsTotal}`)

  const labelKeys = new Set<string>()
  for (const sample of metrics.samples()) for (const k of Object.keys(sample.labels)) labelKeys.add(k)
  const forbidden = [...labelKeys].filter(
    (k) => !(ALLOWED_METRIC_LABELS as readonly string[]).includes(k),
  )
  record(
    'nenhuma label de metrica de alta cardinalidade',
    forbidden.length === 0,
    forbidden.length === 0 ? `labels=${[...labelKeys].join(',')}` : `proibidas=${forbidden.join(',')}`,
  )

  // --- dead-letter: payload invalido vira dead-letter, e replay volta -----
  // Limpa a fila: os checks acima deixam jobs de /changes pendentes, e o teste
  // abaixo conta dead-letters — precisa de estado conhecido.
  await prisma.catalogJob.deleteMany({})
  await store.enqueue({
    jobType: 'reprocess_raw',
    idempotencyKey: 'validator:dead-letter-probe',
    payload: { entityType: 'nope' }, // input invalido => falha PERMANENTE
    maxAttempts: 3,
  })
  const worker3 = await runCatalogWorker(
    { store, registry, metrics },
    { concurrency: 1, maxJobs: 5, drain: true, runId: 'validator' },
  )
  record(
    'payload invalido vai DIRETO para dead-letter (sem gastar retry)',
    worker3.deadLettered === 1 && worker3.failedPermanently === 1,
    `dead=${worker3.deadLettered} permanent=${worker3.failedPermanently}`,
  )

  const dl = await store.listDeadLetter(10)
  record('dead-letter listado', dl.length === 1, `entries=${dl.length}`)

  const replayedNone = await store.replayDeadLetter([])
  record(
    'replayDeadLetter([]) e noop (nao reprocessa tudo por engano)',
    replayedNone === 0,
    `replayed=${replayedNone}`,
  )

  const replayed = await store.replayDeadLetter(dl.map((d) => d.id))
  record('replay reenfileira o dead-letter', replayed === 1, `replayed=${replayed}`)

  // --- auditoria: read-only ----------------------------------------------
  const auditBefore = await prisma.catalogJob.count()
  const report = await runDatabaseAudit(createPrismaAuditReader(prisma) as never, {
    environment: 'test',
    now: new Date('2026-07-16T12:00:00.000Z'),
  })
  const auditAfter = await prisma.catalogJob.count()
  record(
    'audit-database e read-only (nao muta nada)',
    auditBefore === auditAfter,
    `jobs before=${auditBefore} after=${auditAfter}`,
  )
  record(
    'audit-database reporta contagens reais do banco',
    report.entities.length > 0 && report.jobs.length > 0,
    `entities=${report.entities.length} jobStatuses=${report.jobs.length} deadLetters=${report.deadLetters}`,
  )
  record(
    'audit-database nunca expoe DATABASE_URL',
    !formatAuditReport(report).includes(url) && !JSON.stringify(report).includes(url),
    'relatorio sem credencial',
  )

  const gateProd = evaluateAuditGate({
    environment: 'production',
    confirmProductionRead: false,
    hasDatabaseUrl: true,
  })
  record(
    'audit-database em producao exige --confirm-production-read',
    !gateProd.allowed,
    `allowed=${gateProd.allowed}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-catalog-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_catalog?schema=public`
  console.log(
    `\n=== Backend A — Postgres efemero (embedded) :${port} | postgresql://postgres:****@127.0.0.1:${port} ===\n`,
  )

  // O LOG DO SERVIDOR e o artefato que o controle negativo do enqueue mede: um
  // `ERROR: duplicate key ...` so pode ser provado AUSENTE se houver onde ele
  // apareceria.
  //
  // NAO se liga `logging_collector` para isso. Tentamos: com o coletor ligado, a
  // linha `database system is ready to accept connections` passa a ir para o
  // ARQUIVO — e `EmbeddedPostgres.start()` resolve justamente esperando essa
  // linha no STDERR do processo. O validador ficava pendurado para sempre, sem
  // erro. O log fica onde ja estava (stderr) e nos e que passamos a escutar.
  let serverLog = ''
  let serverLogAttached = false

  let started = false
  try {
    await pg.initialise()
    await pg.start()
    started = true

    // O `stderr` do processo do Postgres E o log do servidor. `EmbeddedPostgres`
    // nao expoe o filho na API publica, entao a leitura e declaradamente por
    // dentro — e se a forma mudar, `serverLogAttached` continua false e o
    // controle negativo REPROVA em vez de passar sem medir.
    const child = (pg as unknown as { process?: { stderr?: NodeJS.ReadableStream | null } }).process
    if (child?.stderr) {
      child.stderr.on('data', (chunk: Buffer | string) => {
        serverLog += chunk.toString()
      })
      serverLogAttached = true
    }
    await pg.createDatabase('screena_catalog')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy (do zero) ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record('migrate deploy aplica do zero sem erro', true, 'ok')

    console.log('\n--- checks no banco real ---')
    await runChecks(url, () => (serverLogAttached ? serverLog : null))
  } catch (e) {
    // Erros do Prisma comecam com '\n': a primeira linha e vazia e some do
    // relatorio. Compacta para uma linha util e loga o stack completo.
    console.error('[execucao] erro completo:', e)
    record('execucao', false, (e as Error).message.replace(/\s+/g, ' ').trim().slice(0, 300))
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split('\n')[0]}`)
      }
    }
    await safeRm(dataDir)
    console.log('\n=== Backend A: Postgres efemero derrubado e dir temporario removido ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(
    `\nRESUMO (Backend A / catalog-platform): ${results.length - failed.length}/${results.length} checks OK.`,
  )
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Fila de jobs + busca validadas em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
