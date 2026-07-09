#!/usr/bin/env node
/**
 * bin/sync-tmdb-raw.ts — Worker de RAW SYNC do TMDB (P0-00d). Worker-only/offline
 * — NUNCA no render.
 *
 * Consome a fila NDJSON do P0-00c (`.data/discovery-queue-*.ndjson`) e grava o
 * payload BRUTO do TMDB em `tmdb_raw` (base + append/translations, via o client
 * do P0-00b). Idempotencia por `payloadHash`: igual = skip (sem bump de
 * updatedAt); diferente = update; ausente = create.
 *
 * Fica em services/ingestion/bin: EXCLUIDO do typecheck e do bundle de render.
 * Usa o core PURO em ../src/raw-sync/* (typechecked + testado) e adiciona so o IO:
 * streaming da fila, client TMDB, upsert Prisma, log em api_sync_logs, relatorio.
 *
 * O QUE FAZ:
 *  - Dry-run (default): le a fila (scan inteiro, memoria limitada), reporta o
 *    PLANO (quantos movie/tv/person seriam buscados; quantos unsupported). ZERO
 *    rede, ZERO DB, ZERO quota.
 *  - --apply: busca detalhe de movie/tv/person (limite 100/100/100), grava
 *    tmdb_raw por hash, loga 1 linha-resumo em api_sync_logs e escreve o
 *    relatorio completo (breakdown por tipo) em .data/ (gitignored).
 *
 * NAO FAZ (fora de escopo P0-00d): tocar schema/migration; promover a tabelas
 * tipadas (movies/tv_shows/people); baixar imagem; usar api_cache (idempotencia
 * aqui e por tmdb_raw + payloadHash + piloto pequeno — api_cache fica p/ P0-00e);
 * sync em massa. ETag/Last-Modified ficam null (o client atual so expoe JSON).
 *
 * FAIL-CLOSED: aborta em producao; --apply exige DATABASE_URL (dev/staging) +
 * token TMDB + fila existente + idioma base pt-BR. Faltando qualquer um, o piloto
 * real NAO roda — o worker reporta o bloqueio, nunca simula sucesso.
 *
 * Uso (a partir da raiz). Resolva o cli do tsx e rode (dry-run sem --apply):
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/sync-tmdb-raw.ts
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/sync-tmdb-raw.ts --apply
 *   # flags:
 *   #   --apply              busca + grava (sem a flag = dry-run, nada tocado)
 *   #   --queue=<arquivo>    fila NDJSON (default: mais recente em .data/)
 *   #   --limit-movies=N     teto de filmes no piloto (default 100)
 *   #   --limit-tv=N         teto de series (default 100)
 *   #   --limit-people=N     teto de pessoas (default 100)
 *   #   --concurrency=N      pool (default 4; baixo e explicito)
 *   #   --report=<arquivo>   relatorio (.md ou .json; default em .data/, gitignored)
 */

import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { createTmdbClient } from '@screena/tmdb-client'
import { disconnectPrisma, getPrismaClient } from '@screena/db/server'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { createPrismaTmdbRawStore } from '../src/persistence/tmdb-raw-store.js'
import { describeRawSyncGateReason, evaluateRawSyncGate } from '../src/raw-sync/gate.js'
import {
  createPilotSelector,
  DEFAULT_PILOT_LIMITS,
  parseRawQueueLine,
} from '../src/raw-sync/queue.js'
import { DEFAULT_CONCURRENCY, runRawSyncPilot } from '../src/raw-sync/run.js'
import {
  deriveSyncStatus,
  processedOf,
  renderRawSyncReport,
  serializeRawSyncReportJson,
} from '../src/raw-sync/report.js'
import type { RawSyncReport } from '../src/raw-sync/types.js'

/** Idioma base exigido no piloto (invariante 7: pt-BR primeiro). */
const BASE_LANGUAGE = 'pt-BR'

function repoRoot() {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/ingestion/bin
  return path.resolve(dir, '..', '..', '..')
}

function loadRepoEnv() {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

function flagValue(argv: string[], name: string): string | null {
  const prefix = `--${name}=`
  const hit = argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

/** Le um inteiro positivo de flag; cai no default se ausente/invalido. */
function intFlag(argv: string[], name: string, fallback: number): number {
  const raw = flagValue(argv, name)
  if (raw === null) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const dataDir = () => path.join(repoRoot(), 'services', 'ingestion', '.data')

/** Fila mais recente em .data/ (por mtime), ou null se nenhuma existir. */
function newestQueueFile(): string | null {
  const dir = dataDir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  const candidates = entries
    .filter((f) => f.startsWith('discovery-queue-') && f.endsWith('.ndjson'))
    .map((f) => path.join(dir, f))
  if (candidates.length === 0) return null
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0]
}

/** Resolve o arquivo de fila: --queue explicito ou o mais recente em .data/. */
function resolveQueueFile(argv: string[]): string | null {
  const explicit = flagValue(argv, 'queue')
  if (explicit !== null) {
    const abs = path.isAbsolute(explicit) ? explicit : path.resolve(process.cwd(), explicit)
    return existsSync(abs) ? abs : null
  }
  return newestQueueFile()
}

/** Streaming da fila -> seletor (memoria limitada; scan inteiro). */
async function selectFromQueue(queueFile: string, limits: typeof DEFAULT_PILOT_LIMITS) {
  const selector = createPilotSelector(limits)
  const rl = createInterface({ input: createReadStream(queueFile), crlfDelay: Infinity })
  for await (const line of rl) {
    const item = parseRawQueueLine(line)
    if (item !== null) selector.offer(item)
  }
  return selector.result()
}

/** Caminho default do relatorio (gitignored, em .data/). */
function defaultReportPath(queueFile: string): string {
  const stem = path.basename(queueFile).replace(/^discovery-queue-/, '').replace(/\.ndjson$/, '')
  return path.join(dataDir(), `raw-sync-report-${stem || 'latest'}.md`)
}

/** Escreve o relatorio (markdown ou JSON conforme a extensao). */
function writeReport(report: RawSyncReport, reportPath: string): void {
  mkdirSync(path.dirname(reportPath), { recursive: true })
  const body = reportPath.endsWith('.json')
    ? serializeRawSyncReportJson(report)
    : renderRawSyncReport(report)
  writeFileSync(reportPath, `${body}\n`)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Source/store de guarda para dry-run: nunca devem ser chamados (fail-loud). */
const dryRunSource = {
  getMovie: () => Promise.reject(new Error('dry-run nunca busca (getMovie)')),
  getTvShow: () => Promise.reject(new Error('dry-run nunca busca (getTvShow)')),
  getPerson: () => Promise.reject(new Error('dry-run nunca busca (getPerson)')),
}
const dryRunStore = {
  readHash: () => Promise.reject(new Error('dry-run nunca le store')),
  create: () => Promise.reject(new Error('dry-run nunca grava (create)')),
  update: () => Promise.reject(new Error('dry-run nunca grava (update)')),
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const limits = {
    movie: intFlag(argv, 'limit-movies', DEFAULT_PILOT_LIMITS.movie),
    tv: intFlag(argv, 'limit-tv', DEFAULT_PILOT_LIMITS.tv),
    person: intFlag(argv, 'limit-people', DEFAULT_PILOT_LIMITS.person),
  }
  const concurrency = intFlag(argv, 'concurrency', DEFAULT_CONCURRENCY)

  loadRepoEnv()
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())
  const hasToken = Boolean(
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim(),
  )
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

  console.log('== Screen · TMDB raw sync (P0-00d) ==')
  console.log(`Modo: ${apply ? 'APPLY (grava tmdb_raw)' : 'dry-run (nada tocado)'}`)
  console.log(`Limites: movie=${limits.movie}, tv=${limits.tv}, person=${limits.person}`)

  const queueFile = resolveQueueFile(argv)

  // Gate de seguranca (fail-closed, testado em raw-sync-gate.test.ts): decide
  // permitir/bloquear a partir dos sinais do ambiente. O maior risco do P0-00d e
  // rodar no banco errado — a decisao e centralizada e nunca simula sucesso.
  const gate = evaluateRawSyncGate({
    apply,
    isProd,
    hasDb,
    hasToken,
    queueFound: queueFile !== null,
  })
  if (!gate.allowed) {
    console.error(describeRawSyncGateReason(gate.reason!))
    process.exitCode = 1
    return
  }
  // Gate permitiu -> fila garantidamente existe (exigida nos dois modos).
  console.log(`Fila: ${queueFile}`)

  const reportPath = flagValue(argv, 'report') ?? defaultReportPath(queueFile!)

  // ---- Dry-run: so plano (sem rede, sem DB, sem log). ----
  if (!apply) {
    const selection = await selectFromQueue(queueFile, limits)
    const report = await runRawSyncPilot({
      selection,
      source: dryRunSource,
      store: dryRunStore,
      baseLanguage: BASE_LANGUAGE,
      limits,
      now: () => new Date(),
      dryRun: true,
      concurrency,
      retry: { maxAttempts: 1, sleep },
    })
    writeReport(report, reportPath)
    console.log(
      `Plano: a processar movie=${report.perKindSelected.movie}, tv=${report.perKindSelected.tv}, person=${report.perKindSelected.person}.`,
    )
    console.log(
      `Fila escaneada: ${report.scanned} · unsupportedSkipped: ${report.unsupportedSkipped}.`,
    )
    console.log(`Relatorio (gitignored): ${reportPath}`)
    console.log('Dry-run: NADA foi buscado nem gravado. Use --apply para o piloto real.')
    return
  }

  // ---- Apply: piloto real. Gate ja garantiu nao-prod + fila + DB + token. ----
  const client = createTmdbClient()
  if (client.config.defaultLanguage !== BASE_LANGUAGE) {
    console.error(
      `Piloto real NAO executado: idioma base do client e "${client.config.defaultLanguage}", mas o piloto exige ${BASE_LANGUAGE} (ajuste TMDB_DEFAULT_LANGUAGE).`,
    )
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  const store = createPrismaTmdbRawStore(prisma)
  const syncLog = createPrismaSyncLog(prisma)

  try {
    const selection = await selectFromQueue(queueFile, limits)
    console.log(
      `Selecionados: movie=${selection.perKindSelected.movie}, tv=${selection.perKindSelected.tv}, person=${selection.perKindSelected.person} · unsupportedSkipped=${selection.unsupportedSkipped}.`,
    )

    const report = await runRawSyncPilot({
      selection,
      source: client.endpoints,
      store,
      baseLanguage: BASE_LANGUAGE,
      limits,
      now: () => new Date(),
      dryRun: false,
      concurrency,
      retry: { maxAttempts: 2, sleep, backoffMs: (attempt) => 500 * attempt },
      onItem: (item, outcome) => {
        if (outcome === 'failed') console.warn(`  ${item.kind} ${item.tmdbId}: FALHOU.`)
      },
    })

    const processed = processedOf(report.totals)
    const status = deriveSyncStatus(report)
    await syncLog.write({
      endpoint: 'raw-sync',
      status,
      errorCode: status === 'failed' ? 'raw_sync_failed' : null,
      itemsProcessed: processed,
      itemsCreated: report.totals.created,
      itemsUpdated: report.totals.updated,
      durationMs: report.durationMs,
      quotaCost: processed + report.retries,
      payloadHash: null,
    })

    writeReport(report, reportPath)
    const t = report.totals
    console.log(
      `Raw sync (${status}): created=${t.created}, updated=${t.updated}, skipped=${t.skipped}, failed=${t.failed} · retries=${report.retries} (429=${report.rate429}).`,
    )
    console.log(`Log em api_sync_logs (1 linha-resumo) · relatorio completo: ${reportPath}`)
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error('Falha no raw sync:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
