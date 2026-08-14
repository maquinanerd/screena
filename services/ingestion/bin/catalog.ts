#!/usr/bin/env node
/**
 * bin/catalog.ts — CLI unificada do catalogo. Worker-only/offline — NUNCA no
 * render.
 *
 * Fora do `tsconfig.json` principal (depende do Prisma Client gerado), mas
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck:catalog-runtime`, gate no
 * CI apos o db:generate). Nao ha regiao sem tipo: era exatamente aqui que erros
 * de assinatura chegavam ao runtime.
 *
 * Entrada UNICA para operar o catalogo: bootstrap, enqueue, worker, sync,
 * changes, discovery, media, episodes, search-reindex, search-status, status,
 * audit-database e dead-letter. Todos os comandos usam os MESMOS handlers da
 * fila — nao ha caminho paralelo "so do CLI" que possa divergir do que o worker
 * executa em producao.
 *
 * O nucleo PURO (parser, ajuda, exit codes, gate) vive em ../src/cli/* e e
 * testado sem banco. Aqui fica so o IO: env, Prisma, TMDB, sinais, saida.
 *
 * Uso (a partir da raiz):
 *   pnpm catalog --help
 *   pnpm catalog bootstrap --strategy daily-exports --entity movie,tv,person --limit 1000 --apply
 *   pnpm catalog worker --concurrency 4 --max-jobs 0
 *   pnpm catalog status --json
 *
 * Se `pnpm catalog` falhar com "tsx not found" neste layout pnpm, use o cli
 * RESOLVIDO do tsx, como os demais bins do repo:
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/catalog.ts --help
 */

import { gunzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { createTmdbClient } from '@screena/tmdb-client'
import { createTmdbCatalogEndpoints } from '@screena/tmdb-client'
import { disconnectPrisma } from '@screena/db/server'
import {
  EXIT_CODES,
  evaluateCatalogGate,
  parseCatalogArgs,
  redactSecrets,
  renderHelp,
  isReadOnlyCommand,
} from '../src/cli/index.js'
import { createCatalogHandlerRegistry, validateJobPayload } from '../src/catalog-jobs/handlers/index.js'
import { buildIdempotencyKey } from '../src/catalog-jobs/idempotency.js'
import { runCatalogWorker } from '../src/catalog-jobs/worker.js'
import { CATALOG_JOB_TYPES } from '../src/catalog-jobs/types.js'
import { createStructuredLogMetricsSink, createInMemoryMetricsSink } from '../src/metrics/index.js'
import { reindexAll, reindexEntity } from '../src/search-projection/index.js'
import { evaluateAuditGate, formatAuditReport, runDatabaseAudit } from '../src/audit/index.js'
import {
  assertPlannableStrategy,
  DEFAULT_ASSUMPTIONS,
  estimateScenarios,
  evaluateBudget,
  largestAffordablePrefix,
  type BootstrapBudget,
  type DiscoveryCost,
  type PlannedTitle,
} from '../src/planning/index.js'
import { createCatalogServices } from '../src/persistence/catalog-services.js'
import { createPrismaAuditReader } from '../src/persistence/audit-reader.js'
import {
  DECIDABLE_ENTITY_TYPES,
  produceIndexabilityDecisions,
} from '../src/persistence/indexability-writer.js'
import {
  BACKFILLABLE_TYPES,
  backfillFinalization,
} from '../src/persistence/finalization-backfill.js'
import { createPersistence } from '../src/persistence/index.js'
import { createPrismaCatalogJobStore } from '../src/persistence/catalog-job-store.js'
import { createPrismaSearchStore } from '../src/persistence/search-store.js'
import { createPrismaSearchProjectionSource } from '../src/persistence/search-projection-source.js'

import type { CatalogFlags, CatalogCommand, DeadLetterSubcommand } from '../src/cli/index.js'
import type { CatalogJobRegistry, StructuredLogger, LogLevel } from '../src/catalog-jobs/handler.js'
import type { CatalogJobType } from '../src/catalog-jobs/types.js'
import type { MetricsSink } from '../src/metrics/index.js'
import type { CatalogServices } from '../src/persistence/catalog-services.js'
import type {
  CatalogBootstrapReport,
  SyncChangesResult,
  SyncDetailsResult,
  SyncEpisodesResult,
  SyncListsResult,
  SyncMediaResult,
  SyncSeasonsResult,
} from '../src/catalog-jobs/handlers/index.js'
import type { CatalogEntityKind } from '../src/catalog-jobs/types.js'
import type { SearchEntityType } from '../src/search/projection.js'
import type { TmdbCatalogEndpoints } from '@screena/tmdb-client'
import type { TmdbReadPort } from '../src/ports.js'

/** Runtime so-de-banco (comandos que nao precisam de TMDB). */
interface DbOnlyRuntime {
  readonly prisma: CatalogServices['prisma']
  readonly store: CatalogServices['store']
  readonly searchStore: CatalogServices['searchStore']
  readonly searchSource: CatalogServices['searchSource']
  readonly now: () => Date
}

/** Deps de uma execucao inline de handler. */
interface InlineDeps {
  readonly requestId: string
  readonly log: StructuredLogger
  readonly metrics: MetricsSink
}

const DEFAULT_LOCALE = 'pt-BR'

/** Logger estruturado (uma linha JSON por evento; nunca imprime segredo). */
function createCliLogger(verbose: boolean): StructuredLogger {
  return {
    log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) {
      if (!verbose && level === 'debug') return
      const line = JSON.stringify({ level, event, ...fields })
      process.stderr.write(`${redactSecrets(line)}\n`)
    },
  }
}

/** Escreve o resultado no formato pedido. */
function emit(flags: CatalogFlags, payload: unknown, humanLines: readonly string[]): void {
  if (flags.json) {
    process.stdout.write(`${redactSecrets(JSON.stringify(payload, jsonSafe, 2))}\n`)
    return
  }
  for (const line of humanLines) process.stdout.write(`${redactSecrets(line)}\n`)
}

/** `JSON.stringify` lanca em BigInt: os PKs do schema sao BigInt. */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/** Predicado: o texto e um tipo de job valido. */
function isCatalogJobType(value: string): value is CatalogJobType {
  return (CATALOG_JOB_TYPES as readonly string[]).includes(value)
}

/** Kinds aceitos na coluna `entity_type` de catalog_jobs. */
const CATALOG_ENTITY_KINDS: readonly CatalogEntityKind[] = [
  'movie',
  'tv',
  'season',
  'episode',
  'person',
  'collection',
  'network',
  'company',
  'keyword',
]

/**
 * Estreita `--entity` para o enum da coluna.
 *
 * `null` e legitimo (jobs sem alvo, ex.: bootstrap). Um valor fora do dominio
 * seria erro de FK/enum no insert — falhar aqui e mais claro que no driver.
 */
function narrowCatalogEntityKind(value: string | null): CatalogEntityKind | null {
  if (value === null) return null
  if (!(CATALOG_ENTITY_KINDS as readonly string[]).includes(value)) {
    throw new Error(`--entity invalido: "${value}". Use um de: ${CATALOG_ENTITY_KINDS.join(', ')}.`)
  }
  return value as CatalogEntityKind
}

/** Estreita `--entity` para os tipos indexaveis na busca (movie|tv|person). */
function narrowSearchEntityTypes(values: string[] | null): SearchEntityType[] | undefined {
  if (values === null) return undefined
  const allowed: readonly SearchEntityType[] = ['movie', 'tv', 'person']
  const out: SearchEntityType[] = []
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(`--entity invalido para busca: "${value}". Use: ${allowed.join(', ')}.`)
    }
    out.push(value as SearchEntityType)
  }
  return out
}

/**
 * Mensagem segura de um erro desconhecido.
 *
 * `catch (error)` da `unknown`: ler `.message` direto nao compila, e
 * `String(error)` num objeto vira "[object Object]".
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Lista separada por virgula -> array limpo. */
function splitList(value: string | null): string[] | null {
  if (value === null) return null
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Le ids de um arquivo (um por linha), ignorando vazios/comentarios. */
async function readIdsFile(file: string): Promise<number[]> {
  const { readFile } = await import('node:fs/promises')
  const text = await readFile(file, 'utf8')
  const ids: number[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(`--ids-file: linha invalida "${trimmed}" (esperado inteiro por linha).`)
    }
    ids.push(Number(trimmed))
  }
  return ids
}

/**
 * Executa UM job em processo (sem passar pela fila).
 *
 * Usado pelos comandos diretos (sync/media/episodes/discovery/changes): o
 * operador quer o resultado AGORA, mas o codigo executado e exatamente o mesmo
 * handler que o worker roda — sem caminho paralelo que possa divergir.
 */
async function runHandlerInline<TResult>(
  registry: CatalogJobRegistry,
  jobType: CatalogJobType,
  payload: Record<string, unknown>,
  deps: InlineDeps,
): Promise<TResult> {
  const handler = registry.get(jobType)
  if (handler === undefined) throw new Error(`sem handler para ${jobType}`)
  const input = handler.validateInput(payload)

  const controller = new AbortController()
  const context = {
    jobId: `inline:${jobType}`,
    requestId: deps.requestId,
    attempt: 1,
    signal: controller.signal,
    heartbeat: async () => {},
    log: deps.log,
    metrics: deps.metrics,
  }
  // O registry e heterogeneo (`CatalogJobHandler<never, unknown>`): o par I/O de
  // cada handler nao e recuperavel pelo tipo. `TResult` e a forma que o chamador
  // sabe que aquele jobType devolve.
  return (await handler.execute(context, input as never)) as TResult
}

/**
 * Comandos que NAO precisam de credencial TMDB.
 *
 * `createTmdbClient()` lanca `TmdbConfigError` quando falta o token. Montar o
 * runtime completo para um `status`/`audit-database` fazia um comando puramente
 * de banco morrer por falta de uma credencial que ele nunca usaria — e num host
 * de operacao (onde se audita) o token TMDB muitas vezes nem existe.
 */
const DB_ONLY_COMMANDS = new Set(['status', 'search-status', 'audit-database', 'dead-letter', 'enqueue', 'index-decisions', 'backfill-finalization'])

/** Monta so a camada de banco (sem TMDB). */
function createDbOnlyRuntime() {
  const persistence = createPersistence({ ttlMs: 0 })
  return {
    prisma: persistence.prisma,
    store: createPrismaCatalogJobStore(persistence.prisma),
    searchStore: createPrismaSearchStore(persistence.prisma),
    searchSource: createPrismaSearchProjectionSource(persistence.prisma),
    now: () => new Date(),
  }
}

/** Monta runtime (TMDB + Prisma + servicos + registry). */
function createRuntime() {
  const client = createTmdbClient()
  const catalogEndpoints = createTmdbCatalogEndpoints(client.http, client.config)
  const services = createCatalogServices({
    tmdb: client.endpoints,
    catalogEndpoints,
    cacheTtlMs: client.config.cacheTtlMs,
    fetchText: async (url: string) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`export HTTP ${response.status}`)
      // Os Daily ID Exports sao arquivos .json.gz SERVIDOS COMO CORPO BINARIO —
      // nao ha `content-encoding: gzip`, entao `fetch` NAO descompacta e
      // `response.text()` devolveria bytes gzip interpretados como UTF-8. O
      // parser entao descartaria toda linha como JSON invalido e a descoberta
      // reportaria "0 ids" com sucesso — silenciosamente, na estrategia DEFAULT.
      const buffer = Buffer.from(await response.arrayBuffer())
      const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
      return isGzip ? gunzipSync(buffer).toString('utf8') : buffer.toString('utf8')
    },
  })
  const registry = createCatalogHandlerRegistry(services)
  return { client, catalogEndpoints, services, registry }
}

/** main. */
async function main() {
  const parsed = parseCatalogArgs(process.argv.slice(2))

  if (!parsed.ok) {
    process.stderr.write(`erro: ${parsed.error}\n`)
    return EXIT_CODES.usage
  }
  if (parsed.help) {
    process.stdout.write(`${renderHelp(parsed.command)}\n`)
    return EXIT_CODES.ok
  }

  const { command, subcommand, flags } = parsed.invocation
  const mutates = flags.apply && !isReadOnlyCommand(command)

  const gate = evaluateCatalogGate({
    env: process.env,
    mutates,
    confirmProductionRead: flags.confirmProductionRead,
    force: flags.force,
  })
  if (!gate.ok) {
    process.stderr.write(`bloqueado (${gate.reason}): ${gate.message}\n`)
    return EXIT_CODES.blocked
  }

  const log = createCliLogger(false)
  const metrics = flags.json ? createInMemoryMetricsSink() : createStructuredLogMetricsSink((line) => {
    process.stderr.write(`${JSON.stringify({ metric: line.metric, value: line.value, labels: line.labels })}\n`)
  })
  // O bootstrap poe o requestId na chave de idempotencia dos filhos. Um default
  // CONSTANTE (`cli-bootstrap`) faria o 1o run enfileirar e TODOS os seguintes
  // colidirem na mesma chave => noop silencioso, para sempre. Por isso o
  // bootstrap ganha um id unico por execucao quando o operador nao passa um; e
  // `--request-id` continua sendo o jeito de RETOMAR uma execucao especifica.
  const requestId =
    flags.requestId ?? (command === 'bootstrap' ? `bootstrap-${randomUUID()}` : `cli-${command}`)
  const locale = flags.locale ?? DEFAULT_LOCALE

  // Dry-run NAO monta o runtime: nao abre Prisma, nao cria client TMDB, nao
  // gasta cota. "Dry-run nao toca nada" e garantido por construcao, nao por
  // disciplina espalhada em cada comando.
  if (flags.dryRun) {
    const plan = describePlan(command, subcommand, flags, locale)
    emit(flags, { dryRun: true, command, subcommand, plan }, [
      `[dry-run] ${command}${subcommand ? ` ${subcommand}` : ''}`,
      ...plan.map((line) => `  - ${line}`),
      '',
      'Nada foi tocado (sem Prisma, sem TMDB, sem cota). Use --apply para executar.',
    ])
    return EXIT_CODES.ok
  }

  // Comandos so-de-banco nao montam o client TMDB (nao precisam do token).
  if (DB_ONLY_COMMANDS.has(command)) {
    const db = createDbOnlyRuntime()
    try {
      switch (command) {
        case 'enqueue':
          return await cmdEnqueue(db, flags, locale)
        case 'search-status':
          return await cmdSearchStatus(db, flags, locale)
        case 'status':
          return await cmdStatus(db, flags)
        case 'audit-database':
          return await cmdAuditDatabase(db, flags)
        case 'index-decisions':
          return await cmdIndexDecisions(db, flags, locale)
        case 'backfill-finalization':
          return await cmdBackfillFinalization(db, flags, locale)
        case 'dead-letter':
          return await cmdDeadLetter(db, subcommand, flags)
        default:
          process.stderr.write(`comando nao implementado: ${command}\n`)
          return EXIT_CODES.usage
      }
    } finally {
      await disconnectPrisma()
    }
  }

  // `plan-bootstrap` precisa do TMDB mas NAO do banco: planejar tem que ser
  // possivel de um host de operacao sem PostgreSQL. Montar o runtime completo
  // exigiria DATABASE_URL para um comando que nao escreve nada.
  if (command === 'plan-bootstrap') {
    const client = createTmdbClient()
    const endpoints = createTmdbCatalogEndpoints(client.http, client.config)
    return await cmdPlanBootstrap(endpoints, client.endpoints, flags, locale)
  }

  const { services, registry } = createRuntime()
  const inlineDeps = { requestId, log, metrics }

  try {
    switch (command) {
      case 'bootstrap':
        return await cmdBootstrap(registry, flags, locale, inlineDeps)
      case 'worker':
        return await cmdWorker(services, registry, flags, log, metrics, requestId)
      case 'sync':
        return await cmdSync(registry, flags, locale, inlineDeps)
      case 'changes':
        return await cmdChanges(registry, flags, inlineDeps)
      case 'discovery':
        return await cmdDiscovery(registry, flags, locale, inlineDeps)
      case 'media':
        return await cmdMedia(registry, flags, locale, inlineDeps)
      case 'episodes':
        return await cmdEpisodes(registry, flags, locale, inlineDeps)
      case 'search-reindex':
        return await cmdSearchReindex(services, flags, locale, log, metrics)
      default:
        process.stderr.write(`comando nao implementado: ${command}\n`)
        return EXIT_CODES.usage
    }
  } finally {
    await disconnectPrisma()
  }
}

/** Descreve o plano de um comando, sem tocar em nada (dry-run). */
function describePlan(
  command: CatalogCommand,
  subcommand: string | null,
  flags: CatalogFlags,
  locale: string,
): string[] {
  const entity = splitList(flags.entity)
  switch (command) {
    case 'bootstrap':
      return [
        `estrategia: ${flags.strategy ?? 'daily-exports'}`,
        `tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`,
        `locale: ${locale}${flags.country ? ` · pais: ${flags.country}` : ''}`,
        `limite por tipo: ${flags.limit ?? 'sem teto'}`,
        `enfileiraria: 1 discover_ids por tipo + snapshots de lista por movie/tv`,
        `request-id: ${flags.requestId ?? '(gerado)'} — reusar o mesmo retoma sem duplicar`,
      ]
    case 'sync':
      return [
        `entidade: ${flags.entity}`,
        flags.id !== null ? `tmdb id: ${flags.id}` : `ids de: ${flags.idsFile}`,
        `sincronizaria o detalhe e enfileiraria sync_media (+sync_seasons se tv)`,
      ]
    case 'changes':
      return [
        `tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`,
        `janela: ${flags.from ?? '(to - 1 dia)'} .. ${flags.to ?? '(hoje)'}`,
        `resume: ${flags.resume ? 'sim' : 'nao'} · checkpoint so avanca apos commit`,
      ]
    case 'discovery':
      return [
        `lista: ${flags.list} · entidade: ${flags.entity}`,
        `paginas: ate ${flags.maxPages ?? 5} · locale: ${locale}`,
        `gravaria snapshot (hash-noop se a lista nao mudou)`,
      ]
    case 'media':
      return [`entidade: ${flags.entity} ${flags.id}`, 'sincronizaria imagens/videos (display_allowed=false)']
    case 'episodes':
      return [
        `serie: ${flags.id}${flags.season !== null ? ` · temporada ${flags.season}` : ' · todas as temporadas'}`,
        'sincronizaria creditos, guest stars, ids externos e stills',
      ]
    case 'search-reindex':
      return [`tipos: ${(entity ?? ['movie', 'tv', 'person']).join(', ')}`, `locale: ${locale}`]
    case 'enqueue':
      return [`enfileiraria o job "${flags.positionals[0]}"`]
    case 'dead-letter':
      return [`${subcommand} de dead-letters${flags.limit !== null ? ` (limite ${flags.limit})` : ''}`]
    default:
      return [`${command}: sem efeito colateral`]
  }
}

/** bootstrap. */
async function cmdBootstrap(registry: CatalogJobRegistry, flags: CatalogFlags, locale: string, deps: InlineDeps): Promise<number> {
  const report = await runHandlerInline<CatalogBootstrapReport>(
    registry,
    'bootstrap',
    {
      strategy: flags.strategy ?? 'daily-exports',
      entityTypes: splitList(flags.entity),
      locale,
      country: flags.country,
      limit: flags.limit,
      mode: flags.mode ?? 'enqueue-only',
    },
    deps,
  )
  emit(flags, report, [
    `bootstrap ${report.requestId} · estrategia ${report.strategy}`,
    `  planejado: ${report.planned} · enfileirado: ${report.enqueued} · ja existia: ${report.alreadyQueued}`,
    ...report.stages.map((s) => `  etapa ${s.stage}: +${s.enqueued} (${s.alreadyQueued} ja existiam)`),
    '',
    'Jobs enfileirados != catalogo preenchido. Rode "pnpm catalog worker" para processar.',
  ])
  return EXIT_CODES.ok
}

/**
 * plan-bootstrap — estima o custo REAL antes de persistir.
 *
 * Nao toca banco (nem PrismaClient): planejar deve ser possivel de um host de
 * operacao sem acesso ao PostgreSQL. Le a lista de descoberta e, para cada
 * SERIE candidata, busca `/tv/{id}` — e dali sai `number_of_seasons` e
 * `number_of_episodes`, que sao o custo real. Filme nao precisa de detalhe: seu
 * custo e fixo.
 *
 * Exit code 4 (`failed`) quando o orcamento estoura: um planejador que so
 * informa e um relatorio; um que RECUSA e um gate.
 */
async function cmdPlanBootstrap(
  catalogEndpoints: TmdbCatalogEndpoints,
  tmdb: TmdbReadPort,
  flags: CatalogFlags,
  locale: string,
): Promise<number> {
  const kinds = (splitList(flags.entity) ?? ['movie', 'tv']).filter(
    (k): k is 'movie' | 'tv' => k === 'movie' || k === 'tv',
  )
  if (kinds.length === 0) {
    process.stderr.write('erro: --entity precisa conter movie e/ou tv\n')
    return EXIT_CODES.usage
  }
  const limit = flags.limit ?? 20
  const maxPages = flags.maxPages ?? 5
  const strategy = flags.strategy ?? 'popular'

  // A guarda vive em `src/planning/strategies.ts` (puro e testado), nao aqui:
  // `bin/` e excluido do typecheck e nao tem teste proprio, e foi exatamente
  // por isso que a ausencia de validacao passou despercebida.
  try {
    assertPlannableStrategy(strategy)
  } catch (error) {
    process.stderr.write(`erro: ${error instanceof Error ? error.message : String(error)}\n`)
    return EXIT_CODES.usage
  }

  const budget: BootstrapBudget = {
    ...(flags.maxTitles !== null ? { maxTitles: flags.maxTitles } : {}),
    ...(flags.maxSeries !== null ? { maxSeries: flags.maxSeries } : {}),
    ...(flags.maxSeasons !== null ? { maxSeasons: flags.maxSeasons } : {}),
    ...(flags.maxEpisodes !== null ? { maxEpisodes: flags.maxEpisodes } : {}),
    ...(flags.maxJobs !== null ? { maxJobs: flags.maxJobs } : {}),
    ...(flags.maxApiCalls !== null ? { maxApiCalls: flags.maxApiCalls } : {}),
    ...(flags.maxDurationMinutes !== null
      ? { maxDurationMinutes: flags.maxDurationMinutes }
      : {}),
    ...(flags.maxMediaItems !== null ? { maxMediaItems: flags.maxMediaItems } : {}),
  }

  // ---- coleta dos candidatos --------------------------------------------
  let listPagesFetched = 0
  const candidates: { kind: 'movie' | 'tv'; tmdbId: number; title: string }[] = []

  for (const kind of kinds) {
    for (let page = 1; page <= maxPages; page += 1) {
      if (candidates.filter((c) => c.kind === kind).length >= limit) break
      const params = { page, language: locale }
      const resp =
        kind === 'movie'
          ? strategy === 'now_playing'
            ? await catalogEndpoints.getNowPlayingMovies(params)
            : strategy === 'top_rated'
              ? await catalogEndpoints.getTopRatedMovies(params)
              : await catalogEndpoints.getPopularMovies(params)
          : strategy === 'on_the_air'
            ? await catalogEndpoints.getOnTheAirTvShows(params)
            : strategy === 'top_rated'
              ? await catalogEndpoints.getTopRatedTvShows(params)
              : await catalogEndpoints.getPopularTvShows(params)
      listPagesFetched += 1
      const results = (resp as { results?: unknown[] }).results ?? []
      for (const raw of results) {
        const item = raw as { id?: number; title?: string; name?: string }
        if (typeof item.id !== 'number') continue
        if (candidates.filter((c) => c.kind === kind).length >= limit) break
        candidates.push({
          kind,
          tmdbId: item.id,
          title: String(item.title ?? item.name ?? `#${item.id}`),
        })
      }
      if (results.length === 0) break
    }
  }

  // ---- fatos de custo por titulo ----------------------------------------
  // Serie precisa do detalhe: e ali que vivem os contadores que `--limit` nao
  // expressa. Filme tem custo fixo — nao gastamos cota com ele.
  const titles: PlannedTitle[] = []
  let detailCalls = 0
  for (const c of candidates) {
    if (c.kind === 'movie') {
      titles.push({ kind: 'movie', tmdbId: c.tmdbId, title: c.title, seasons: 0, episodes: 0 })
      continue
    }
    try {
      const detail = await tmdb.getTvShow(c.tmdbId)
      detailCalls += 1
      const seasons = detail.number_of_seasons ?? 0
      const episodes = detail.number_of_episodes ?? 0
      titles.push({
        kind: 'tv',
        tmdbId: c.tmdbId,
        title: c.title,
        seasons,
        episodes,
        ...(seasons > 0 && episodes > 0 ? {} : { factsMissing: true }),
      })
    } catch {
      // Provider falhou para este titulo: nao inventamos numero — marcamos a
      // incerteza e o fallback conservador entra no lugar.
      detailCalls += 1
      titles.push({
        kind: 'tv',
        tmdbId: c.tmdbId,
        title: c.title,
        seasons: 0,
        episodes: 0,
        factsMissing: true,
      })
    }
  }

  const discovery: DiscoveryCost = {
    // O bootstrap captura 5 listas por tipo de entidade.
    listCount: kinds.length * 5,
    listPagesFetched,
    entityKinds: kinds.length,
  }

  const scenarios = estimateScenarios(titles, discovery)
  const decision = evaluateBudget(scenarios.expected, budget)
  const affordable = largestAffordablePrefix(titles, discovery, budget)

  const heaviest = [...titles]
    .filter((t) => t.kind === 'tv')
    .sort((a, b) => b.episodes - a.episodes)
    .slice(0, 5)

  const report = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'development',
    strategy,
    locale,
    entityKinds: kinds,
    requestedLimit: limit,
    endpointsUsed: {
      lists: kinds.map((k) => `${k}:${strategy}`),
      detailCalls,
      listPagesFetched,
    },
    assumptions: DEFAULT_ASSUMPTIONS,
    budget,
    scenarios,
    decision,
    affordable: {
      titles: affordable.titles.length,
      movies: affordable.estimate.movies,
      series: affordable.estimate.series,
      seasons: affordable.estimate.seasons,
      episodes: affordable.estimate.episodes,
      jobs: affordable.estimate.jobsTotal,
    },
    heaviestSeries: heaviest.map((t) => ({
      tmdbId: t.tmdbId,
      title: t.title,
      seasons: t.seasons,
      episodes: t.episodes,
    })),
  }

  const e = scenarios.expected
  emit(flags, report, [
    `plano de bootstrap · estrategia ${strategy} · locale ${locale}`,
    `  candidatos: ${e.titles} titulos (${e.movies} filmes, ${e.series} series)`,
    `  temporadas: ${e.seasons} · episodios: ${e.episodes}`,
    `  jobs: ${e.jobsTotal} (${Object.entries(e.jobsByType)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')})`,
    `  chamadas TMDB: ${e.apiCalls} · midia: ${e.mediaItems} itens (~${Math.round(e.mediaBytes / 1024)} KiB de metadado)`,
    `  duracao estimada: ${e.durationMinutes} min (otimista ${scenarios.optimistic.durationMinutes} · conservador ${scenarios.conservative.durationMinutes})`,
    `    rede ${e.duration.networkMinutes} min · escrita de episodios ${e.duration.episodeWriteMinutes} min · midia ${e.duration.mediaWriteMinutes} min`,
    `    fator dominante: ${e.duration.dominantFactor} · confianca: ${e.duration.confidence}`,
    ...e.duration.caveats.map((c) => `    ressalva: ${c}`),
    e.titlesWithMissingFacts > 0
      ? `  ATENCAO: ${e.titlesWithMissingFacts} titulo(s) sem contadores do provider — estimativa menos confiavel`
      : '  todos os contadores vieram do provider (estimativa exata, nao presumida)',
    '',
    '  series mais caras:',
    ...heaviest.map((t) => `    ${t.title} — ${t.seasons} temporadas, ${t.episodes} episodios`),
    '',
    `  orcamento: ${decision.summary}`,
    ...decision.violations.map(
      (v) => `    ESTOUROU ${v.dimension}: ${v.estimated} > ${v.limit} (+${v.overBy})`,
    ),
    `  cabe no orcamento: ${affordable.titles.length} de ${titles.length} titulo(s)`,
    '',
    decision.withinBudget
      ? 'Dentro do orcamento. Rode o bootstrap com --apply.'
      : `RECUSADO: reduza --limit para ~${affordable.titles.length} ou aumente os tetos.`,
  ])

  return decision.withinBudget ? EXIT_CODES.ok : EXIT_CODES.failed
}

/**
 * backfill-finalization — cria slug/traducao de entidades presas pelo cache.
 *
 * So-de-banco: nao monta client TMDB porque nao chama o provider.
 */
async function cmdBackfillFinalization(
  services: DbOnlyRuntime,
  flags: CatalogFlags,
  locale: string,
): Promise<number> {
  const requested = splitList(flags.entity)
  const types =
    requested === null
      ? BACKFILLABLE_TYPES
      : requested.filter((t): t is 'movie' | 'tv' | 'person' =>
          (BACKFILLABLE_TYPES as readonly string[]).includes(t),
        )
  if (types.length === 0) {
    process.stderr.write(`erro: --entity precisa conter um de: ${BACKFILLABLE_TYPES.join(', ')}\n`)
    return EXIT_CODES.usage
  }

  const report = await backfillFinalization(services.prisma, {
    language: locale,
    entityTypes: types,
    ...(flags.limit !== null ? { limit: flags.limit } : {}),
    dryRun: !flags.apply,
  })

  emit(flags, report, [
    `backfill de finalizacao · ${report.language} · ${report.dryRun ? 'DRY-RUN' : 'APLICADO'}`,
    `  candidatos: ${report.candidates} · elegiveis: ${report.eligible} · finalizados: ${report.finalized} · falhas: ${report.failed}`,
    `  slugs criados: ${report.slugsCreated} · traducoes criadas: ${report.translationsCreated}`,
    `  chamadas TMDB evitadas: ${report.externalCallsAvoided} · executadas: ${report.externalCallsMade}`,
    '',
    Object.keys(report.skipped).length > 0 ? '  ignorados:' : '  nenhum ignorado.',
    ...Object.entries(report.skipped).map(([k, v]) => `    ${k.padEnd(24)} ${v}`),
    '',
    Object.keys(report.byType).length > 0 ? '  finalizados por tipo:' : '',
    ...Object.entries(report.byType).map(([k, v]) => `    ${k.padEnd(10)} ${v}`),
    '',
    report.samples.length > 0 ? '  amostra:' : '',
    ...report.samples.slice(0, 10).map((s) => `    ${s.entityType}#${s.entityId} -> ${s.slug}`),
    '',
    report.dryRun
      ? 'Nada foi gravado. Use --apply para finalizar.'
      : 'Finalizacao aplicada. A indexacao publica CONTINUA desligada.',
  ])
  return EXIT_CODES.ok
}

/**
 * index-decisions — produz `page_indexability_decisions`.
 *
 * A tabela e lida pelo sitemap e pelos loaders publicos, e nunca teve produtor.
 * `--dry-run` mostra o diff antes de mexer nela; `--apply` grava.
 */
async function cmdIndexDecisions(
  services: DbOnlyRuntime,
  flags: CatalogFlags,
  locale: string,
): Promise<number> {
  const requested = splitList(flags.entity)
  const types =
    requested === null
      ? DECIDABLE_ENTITY_TYPES
      : requested.filter((t): t is 'movie' | 'tv' | 'person' =>
          (DECIDABLE_ENTITY_TYPES as readonly string[]).includes(t),
        )
  if (types.length === 0) {
    process.stderr.write(
      `erro: --entity precisa conter um de: ${DECIDABLE_ENTITY_TYPES.join(', ')}\n`,
    )
    return EXIT_CODES.usage
  }

  const summary = await produceIndexabilityDecisions(services.prisma, {
    language: locale,
    entityTypes: types,
    ...(flags.limit !== null ? { limit: flags.limit } : {}),
    dryRun: !flags.apply,
    now: services.now,
  })

  emit(flags, summary, [
    `decisoes de indexabilidade · ${summary.language} · ${summary.dryRun ? 'DRY-RUN' : 'APLICADO'}`,
    `  avaliadas: ${summary.evaluated} · gravadas: ${summary.written} · inalteradas: ${summary.unchanged}`,
    '',
    '  por decisao:',
    ...Object.entries(summary.byDecision).map(([k, v]) => `    ${k.padEnd(10)} ${v}`),
    '',
    '  por razao:',
    ...Object.entries(summary.byReason).map(([k, v]) => `    ${k.padEnd(24)} ${v}`),
    '',
    summary.changes.length > 0 ? '  mudancas (amostra):' : '  nenhuma mudanca.',
    ...summary.changes
      .slice(0, 15)
      .map((c) => `    ${c.entityType}#${c.entityId}: ${c.from ?? '(nova)'} -> ${c.to} (${c.reason})`),
    '',
    summary.dryRun
      ? 'Nada foi gravado. Use --apply para persistir.'
      : 'Decisoes persistidas. A indexacao publica CONTINUA desligada.',
  ])
  return EXIT_CODES.ok
}

/** enqueue. */
async function cmdEnqueue(services: DbOnlyRuntime, flags: CatalogFlags, locale: string): Promise<number> {
  const requested = flags.positionals[0]
  // `includes` num readonly array nao estreita o tipo: sem o predicado, `jobType`
  // seguiria `string | undefined` ate o enqueue.
  if (requested === undefined || !isCatalogJobType(requested)) {
    process.stderr.write(`erro: job desconhecido "${requested ?? ''}". Use um de: ${CATALOG_JOB_TYPES.join(', ')}.\n`)
    return EXIT_CODES.usage
  }
  const jobType: CatalogJobType = requested

  const payload = {
    entityType: flags.entity,
    tmdbId: flags.id,
    seasonNumber: flags.season,
    locale,
  }

  // Valida ANTES de gravar, com o MESMO validador que o worker usara. Sem isto,
  // `enqueue sync_details` sem --entity/--id era aceito, reportava "enfileirado"
  // e criava um dead-letter garantido: o erro so apareceria minutos depois, na
  // fila, longe de quem digitou o comando.
  try {
    validateJobPayload(jobType, payload)
  } catch (error) {
    process.stderr.write(`erro: payload invalido para "${jobType}": ${redactSecrets(errorMessage(error))}\n`)
    return EXIT_CODES.usage
  }

  const externalId = flags.id === null ? null : String(flags.id)
  // O payload ja passou pelo validador do job; a COLUNA entity_type usa o enum
  // do banco, entao um --entity fora do dominio nao pode chegar ao insert.
  const entityType = narrowCatalogEntityKind(flags.entity)
  const result = await services.store.enqueue({
    jobType,
    entityType,
    externalId,
    idempotencyKey: buildIdempotencyKey({
      jobType,
      entityType,
      externalId,
      discriminator: flags.season !== null ? `s${flags.season}:${locale}` : locale,
    }),
    payload: {
      entityType: flags.entity,
      tmdbId: flags.id,
      seasonNumber: flags.season,
      locale,
    },
    runId: flags.requestId ?? 'cli-enqueue',
  })
  emit(flags, result, [
    result.created
      ? `job ${jobType} enfileirado (id ${result.id}).`
      : `job ${jobType} JA estava na fila (noop idempotente).`,
  ])
  return EXIT_CODES.ok
}

/** worker. */
async function cmdWorker(
  services: CatalogServices,
  registry: CatalogJobRegistry,
  flags: CatalogFlags,
  log: StructuredLogger,
  metrics: MetricsSink,
  runId: string,
): Promise<number> {
  const controller = new AbortController()
  let shuttingDown = false

  // Shutdown gracioso: para de reivindicar e drena o que esta em voo. Um
  // segundo sinal e do operador com pressa — ai sai na hora.
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      process.stderr.write(`\n${signal} de novo: saindo imediatamente.\n`)
      process.exit(EXIT_CODES.error)
    }
    shuttingDown = true
    process.stderr.write(`\n${signal} recebido: drenando os jobs em voo (repita para forcar).\n`)
    controller.abort()
  }
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))

  const maxJobs = flags.maxJobs ?? 0

  // Reclaim de orfaos: `reclaimOrphans` existia, era testado e NAO tinha
  // chamador em producao. Um worker morto por SIGKILL/OOM deixa suas linhas em
  // `running`; `claimNext` so seleciona pending|retry_wait, entao ninguem mais
  // as pegava — perdidas ate um UPDATE manual. Um tick periodico fecha o buraco.
  // Roda ANTES de comecar (recupera o que o processo anterior deixou) e depois
  // a cada `reclaimIntervalMs` enquanto o worker vive.
  const orphanTimeoutMs = Math.max((flags.timeoutMs ?? 120_000) * 2, 60_000)
  const reclaimIntervalMs = Math.max(orphanTimeoutMs / 2, 30_000)
  const reclaimOnce = async () => {
    try {
      const result = await services.store.reclaimOrphans(orphanTimeoutMs)
      if (result.requeued > 0 || result.deadLettered > 0) {
        log.log('warn', 'catalog_worker_reclaimed_orphans', {
          requeued: result.requeued,
          deadLettered: result.deadLettered,
        })
      }
    } catch (error) {
      // Reclaim e best-effort: uma falha aqui nao pode derrubar o worker.
      log.log('warn', 'catalog_worker_reclaim_failed', { error: String(error) })
    }
  }
  await reclaimOnce()
  const reclaimTimer = setInterval(() => void reclaimOnce(), reclaimIntervalMs)
  reclaimTimer.unref()

  const report = await runCatalogWorker(
    { store: services.store, registry, metrics, log, shutdownSignal: controller.signal },
    {
      concurrency: flags.concurrency ?? 4,
      jobTimeoutMs: flags.timeoutMs ?? 120_000,
      idleSleepMs: flags.pollIntervalMs ?? 1_000,
      // maxJobs=0 significa "sem teto": fica pollando (servico). Com teto, drena e sai.
      maxJobs: maxJobs === 0 ? undefined : maxJobs,
      drain: maxJobs !== 0,
      runId,
    },
  )
  clearInterval(reclaimTimer)

  emit(flags, report, [
    `worker finalizado: ${report.claimed} reivindicados · ${report.succeeded} ok · ${report.retried} retry · ${report.deadLettered} dead-letter`,
  ])
  return report.deadLettered > 0 ? EXIT_CODES.failed : EXIT_CODES.ok
}

/** sync. */
async function cmdSync(registry: CatalogJobRegistry, flags: CatalogFlags, locale: string, deps: InlineDeps): Promise<number> {
  // O parser ja exige --id OU --ids-file para ; a guarda torna isso prova.
  const ids =
    flags.id !== null
      ? [flags.id]
      : flags.idsFile !== null
        ? await readIdsFile(flags.idsFile)
        : []
  const results: SyncDetailsResult[] = []
  let failed = 0

  for (const tmdbId of ids) {
    try {
      results.push(
        await runHandlerInline<SyncDetailsResult>(
          registry,
          'sync_details',
          { entityType: flags.entity, tmdbId, locale, enqueueDependencies: true },
          deps,
        ),
      )
    } catch (error) {
      failed += 1
      // Um id ruim nao derruba o lote inteiro; o erro fica visivel e contado.
      process.stderr.write(`falha em ${flags.entity} ${tmdbId}: ${redactSecrets(String(error))}\n`)
    }
  }

  emit(flags, { processed: results.length, failed, results }, [
    `sync ${flags.entity}: ${results.length} ok · ${failed} falhou`,
    ...results.map(
      (r) =>
        `  ${r.tmdbId}: ${r.created ? 'criado' : r.updated ? 'atualizado' : 'inalterado'}` +
        `${r.enqueued > 0 ? ` (+${r.enqueued} jobs)` : ''}`,
    ),
  ])
  return failed > 0 ? EXIT_CODES.failed : EXIT_CODES.ok
}

/** changes. */
async function cmdChanges(registry: CatalogJobRegistry, flags: CatalogFlags, deps: InlineDeps): Promise<number> {
  const report = await runHandlerInline<SyncChangesResult>(
    registry,
    'sync_changes',
    {
      kinds: splitList(flags.entity),
      from: flags.from,
      to: flags.to,
      maxPages: flags.maxPages,
      resume: flags.resume,
    },
    deps,
  )
  emit(flags, report, [
    `changes ${report.window.from} .. ${report.window.to} · ${report.totalEnqueued} jobs enfileirados`,
    ...report.kinds.map(
      (k) =>
        `  ${k.kind}: ${k.pages} paginas · ${k.changedIds} ids · +${k.enqueued}` +
        `${k.skipped ? ' (janela ja concluida)' : k.done ? ' (concluida)' : ' (parcial)'}`,
    ),
  ])
  return EXIT_CODES.ok
}

/** discovery. */
async function cmdDiscovery(registry: CatalogJobRegistry, flags: CatalogFlags, locale: string, deps: InlineDeps): Promise<number> {
  const report = await runHandlerInline<SyncListsResult>(
    registry,
    'sync_lists',
    {
      listType: flags.list,
      entityType: flags.entity,
      locale,
      country: flags.country,
      window: flags.window,
      maxPages: flags.maxPages,
    },
    deps,
  )
  emit(flags, report, [
    `discovery ${report.listType}/${report.entityType}: ${report.items} itens em ${report.pages} paginas`,
    report.created
      ? `  snapshot ${report.snapshotId} criado (${report.persistedItems} itens persistidos)`
      : '  lista inalterada (hash-noop): nenhum snapshot novo',
  ])
  return EXIT_CODES.ok
}

/** media. */
async function cmdMedia(registry: CatalogJobRegistry, flags: CatalogFlags, locale: string, deps: InlineDeps): Promise<number> {
  const report = await runHandlerInline<SyncMediaResult>(
    registry,
    'sync_media',
    { entityType: flags.entity, tmdbId: flags.id, seasonNumber: flags.season, locale },
    deps,
  )
  emit(flags, report, [
    `media ${report.entityType} ${report.tmdbId}: ${report.images} imagens · ${report.videos} videos`,
    '  (display_allowed=false: promocao a exibivel e decisao humana)',
  ])
  return EXIT_CODES.ok
}

/** episodes. */
async function cmdEpisodes(registry: CatalogJobRegistry, flags: CatalogFlags, locale: string, deps: InlineDeps): Promise<number> {
  const seasons =
    flags.season !== null
      ? [flags.season]
      : (
          await runHandlerInline<SyncSeasonsResult>(
            registry,
            'sync_seasons',
            { tmdbId: flags.id, locale, enqueueEpisodes: false },
            deps,
          )
        ).seasonNumbers ?? []

  const reports: SyncEpisodesResult[] = []
  for (const seasonNumber of seasons) {
    reports.push(
      await runHandlerInline<SyncEpisodesResult>(registry, 'sync_episodes', { tmdbId: flags.id, seasonNumber, locale }, deps),
    )
  }

  const total = reports.reduce((sum, r) => sum + r.episodes, 0)
  const skipped = reports.reduce((sum, r) => sum + r.skippedNoTmdbId, 0)
  emit(flags, { seasons: seasons.length, episodes: total, skippedNoTmdbId: skipped, reports }, [
    `episodes serie ${flags.id}: ${seasons.length} temporadas · ${total} episodios`,
    skipped > 0 ? `  ${skipped} episodio(s) sem tmdb id: pulados (sem chave natural)` : '',
  ])
  return EXIT_CODES.ok
}

/** search-reindex. */
async function cmdSearchReindex(
  services: CatalogServices,
  flags: CatalogFlags,
  locale: string,
  log: StructuredLogger,
  metrics: MetricsSink,
): Promise<number> {
  // `--id` reindexa UMA entidade (id INTERNO, nao tmdb id). Antes a flag era
  // aceita e ignorada: o comando varria o corpus inteiro enquanto o operador
  // achava que tinha reprojetado uma linha.
  if (flags.id !== null) {
    const entities = narrowSearchEntityTypes(splitList(flags.entity))
    const entity = entities?.length === 1 ? entities[0] : undefined
    if (entity === undefined) {
      process.stderr.write('erro: --id exige exatamente um --entity (movie|tv|person).\n')
      return EXIT_CODES.usage
    }
    const report = await reindexEntity(
      { source: services.searchSource, store: services.searchStore, metrics, log },
      entity,
      String(flags.id),
      locale,
    )
    emit(flags, report, [
      `search-reindex ${entity} ${flags.id}: ${report.upserted} gravado · ${report.deleted} removido · ${report.skipped} pulado`,
    ])
    return EXIT_CODES.ok
  }

  const report = await reindexAll(
    { source: services.searchSource, store: services.searchStore, metrics, log },
    { locale, entityTypes: narrowSearchEntityTypes(splitList(flags.entity)), limit: flags.limit ?? undefined },
  )
  emit(flags, report, [
    `search-reindex: ${report.scanned} varridos · ${report.upserted} gravados · ${report.deleted} removidos · ${report.skipped} pulados`,
  ])
  return EXIT_CODES.ok
}

/** search-status. */
async function cmdSearchStatus(services: DbOnlyRuntime, flags: CatalogFlags, locale: string): Promise<number> {
  const counts = await services.prisma.searchDocument.groupBy({
    by: ['entityType'],
    _count: { _all: true },
    where: { locale },
  })
  const total = counts.reduce((sum, row) => sum + row._count._all, 0)
  const payload = {
    locale,
    total,
    byType: Object.fromEntries(counts.map((row) => [row.entityType, row._count._all])),
  }
  emit(flags, payload, [
    `search-status (${locale}): ${total} documentos`,
    ...counts.map((row) => `  ${row.entityType}: ${row._count._all}`),
  ])
  return EXIT_CODES.ok
}

/** status. */
async function cmdStatus(services: DbOnlyRuntime, flags: CatalogFlags): Promise<number> {
  const prisma = services.prisma
  const [byStatus, byType, checkpoints, snapshots, documents, lastSyncs] = await Promise.all([
    prisma.catalogJob.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.catalogJob.groupBy({ by: ['jobType'], _count: { _all: true }, where: { status: 'pending' } }),
    prisma.tmdbSyncCheckpoint.findMany({ take: 20, orderBy: { updatedAt: 'desc' } }),
    prisma.discoverySnapshot.findMany({
      take: 10,
      orderBy: { capturedAt: 'desc' },
      select: { listType: true, entityType: true, locale: true, capturedAt: true, expiresAt: true },
    }),
    prisma.searchDocument.count(),
    prisma.apiSyncLog.findMany({ take: 5, orderBy: { createdAt: 'desc' } }),
  ])

  const now = Date.now()
  const payload = {
    jobs: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    pendingByType: Object.fromEntries(byType.map((r) => [r.jobType, r._count._all])),
    checkpoints: checkpoints.map((c) => ({
      job: c.job,
      lastPage: c.lastPage,
      totalPages: c.totalPages,
      done: c.done,
    })),
    snapshots: snapshots.map((s) => ({
      listType: s.listType,
      entityType: s.entityType,
      locale: s.locale,
      ageSeconds: Math.round((now - s.capturedAt.getTime()) / 1000),
      expired: s.expiresAt.getTime() < now,
    })),
    searchDocuments: documents,
    lastSyncs: lastSyncs.map((l) => ({
      endpoint: l.endpoint,
      status: l.status,
      itemsProcessed: l.itemsProcessed,
      createdAt: l.createdAt.toISOString(),
    })),
  }

  emit(flags, payload, [
    'fila:',
    ...byStatus.map((r) => `  ${r.status}: ${r._count._all}`),
    `documentos de busca: ${documents}`,
    'snapshots recentes:',
    ...payload.snapshots.map(
      (s) => `  ${s.listType}/${s.entityType} (${s.locale}): ${s.ageSeconds}s${s.expired ? ' [expirado]' : ''}`,
    ),
    'checkpoints:',
    ...payload.checkpoints.map((c) => `  ${c.job}: pagina ${c.lastPage}/${c.totalPages ?? '?'}${c.done ? ' [done]' : ''}`),
  ])
  return EXIT_CODES.ok
}

/** audit-database. */
async function cmdAuditDatabase(services: DbOnlyRuntime, flags: CatalogFlags): Promise<number> {
  // Gate proprio da auditoria (alem do gate geral da CLI): ler producao e ato
  // consciente mesmo sendo read-only.
  const gate = evaluateAuditGate({
    environment: process.env.NODE_ENV,
    confirmProductionRead: flags.confirmProductionRead,
    hasDatabaseUrl: (process.env.DATABASE_URL ?? '').trim().length > 0,
  })
  if (!gate.allowed) {
    process.stderr.write(`bloqueado: ${gate.reason}\n`)
    return EXIT_CODES.blocked
  }

  const report = await runDatabaseAudit(createPrismaAuditReader(services.prisma), {
    environment: process.env.NODE_ENV ?? 'development',
    now: services.now(),
  })
  emit(flags, report, formatAuditReport(report).split('\n'))
  return EXIT_CODES.ok
}

/** dead-letter. */
async function cmdDeadLetter(services: DbOnlyRuntime, subcommand: DeadLetterSubcommand | null, flags: CatalogFlags): Promise<number> {
  if (subcommand === 'list') {
    const rows = await services.store.listDeadLetter(flags.limit ?? 50)
    emit(flags, rows, [
      `dead-letters: ${rows.length}`,
      ...rows.map((r) => `  ${r.id} ${r.jobType} ${r.entityType ?? '-'}/${r.externalId ?? '-'} · ${r.attempts} tentativas · ${r.lastErrorCode ?? '-'}`),
    ])
    return EXIT_CODES.ok
  }

  const rows = await services.store.listDeadLetter(flags.limit ?? 50)
  const ids = rows.map((r) => r.id)
  // replay([]) e noop por contrato: sem esta guarda, um "replay do nada" viraria
  // replay de TUDO (o adapter trata `undefined` como "todos").
  if (ids.length === 0) {
    emit(flags, { replayed: 0 }, ['nenhum dead-letter para reprocessar.'])
    return EXIT_CODES.ok
  }
  const replayed = await services.store.replayDeadLetter(ids)
  emit(flags, { replayed }, [`${replayed} dead-letter(s) reenfileirado(s).`])
  return EXIT_CODES.ok
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(async (error) => {
    process.stderr.write(`erro: ${redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error))}\n`)
    process.exitCode = EXIT_CODES.error
    await disconnectPrisma().catch(() => {})
  })
