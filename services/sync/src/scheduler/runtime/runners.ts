/**
 * runtime/runners.ts — O QUE cada fila faz. EXCLUIDO do typecheck principal.
 *
 * ============================================================================
 * DUAS FORMAS DE EXECUTAR, E A ESCOLHA NAO E DE ESTILO
 * ============================================================================
 *
 * (A) FILA DE CATALOGO -> ENFILEIRA em `catalog_jobs`.
 *     Discovery, changes, detalhe e pessoas viram jobs na fila duravel que ja
 *     existe. Nao ha caminho paralelo: e o MESMO `store.enqueue`, os MESMOS
 *     handlers e o MESMO worker que a CLI usa. Retomada, backoff, dead-letter e
 *     `FOR UPDATE SKIP LOCKED` vem de graca — reimplementa-los aqui criaria uma
 *     segunda maquina de fila que divergiria da primeira em silencio.
 *
 * (B) FILA DE OUTRO SERVICO -> SPAWNA a CLI que ja existe.
 *     Notas (OMDb), premiacao e Cinerie Score moram em `@screena/ratings`, com
 *     CLIs que o dono ja roda a mao. O agendador executa EXATAMENTE esses
 *     comandos, com os mesmos argumentos. O motivo e o mesmo do (A) invertido:
 *     reimplementar a chamada aqui produziria um segundo caminho que o dono nao
 *     testa quando roda o comando.
 *
 *     Custo: um processo por execucao (alguns segundos). Para uma fila semanal
 *     ou mensal isso e irrelevante; para uma diaria, tambem.
 *
 * (C) `watch_offers` e a EXCECAO, e ela e deliberada.
 *     A oferta e o unico dado que precisa de um endpoint DEDICADO
 *     (`/movie/{id}/watch/providers`) para nao arrastar o detalhe inteiro todo
 *     dia. Nao ha `CatalogJobType` para isso, e criar um exigiria migration de
 *     enum. Entao esta fila chama o endpoint e grava pelo MESMO
 *     `ingestWatchProvidersFromDetail` + `WatchOfferStore` das outras duas
 *     cadeias — o escritor e o mesmo, so a origem do byte muda.
 *
 * ============================================================================
 * NADA FALHA EM SILENCIO
 * ============================================================================
 * Todo runner devolve `RunTally` com `planned`/`processed`/`failed`/`skipped` e
 * os motivos. `classifyRun` transforma isso em desfecho, e um lote incompleto
 * NUNCA vira "concluido" (ver `../run-outcome.ts`).
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { PrismaClient } from '@screena/db/server'
import { checkOmdbBudget } from '@screena/config'
import {
  buildCoverageJob,
  buildIdempotencyKey,
  ingestWatchProvidersFromDetail,
} from '@screena/ingestion/runtime'

import type { SchedulerQueue } from '../rhythms.js'
import { backgroundOmdbSlots } from '../quota.js'
import { dailyScope, hourlySlot } from '../scope.js'
import type { RunReason, RunTally } from '../run-outcome.js'
import { readSpentToday } from './facts.js'
import {
  selectAiringSeries,
  selectStalePeople,
  selectStaleWatchOffers,
  selectTitlesByActivity,
  type TitleCandidate,
} from './selection.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Log estruturado minimo (a mesma forma do servico de catalogo). */
export interface RunnerLogger {
  log(level: 'debug' | 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>): void
}

/** Tudo que um runner precisa. */
export interface RunnerDeps {
  readonly prisma: PrismaClient
  /** `CatalogServices` de `@screena/ingestion` (fila, watch sink, etc.). */
  readonly services: {
    readonly store: { enqueue(input: Record<string, unknown>): Promise<{ created: boolean }> }
    readonly watch: unknown
  }
  /** Endpoints de catalogo do TMDB (para o `watch/providers` dedicado). */
  readonly catalogEndpoints: {
    getMovieWatchProviders(tmdbId: number): Promise<unknown>
    getTvWatchProviders(tmdbId: number): Promise<unknown>
  }
  readonly now: () => Date
  readonly log: RunnerLogger
  readonly locale: string
  /** Teto de itens por ciclo de cada fila. */
  readonly batchLimit: number
  /** Raiz do repositorio (para spawnar as CLIs de outros servicos). */
  readonly repoRoot: string
  /** `--apply` real. `false` = tudo em dry-run (o default de desenvolvimento). */
  readonly apply: boolean
  /**
   * Sinal de DESLIGAMENTO. Abortado => os processos filhos em voo recebem
   * SIGTERM e o ciclo encerra.
   *
   * Sem isto, um SIGTERM chegado no meio de um lote esperaria a CLI filha
   * terminar — e o orquestrador, que da 10 a 30 segundos de carencia, mandaria
   * SIGKILL. Matar o filho e seguro por construcao: todo trabalho e idempotente e
   * retomavel (fila duravel, checkpoint pos-commit, candidato que continua
   * stale), entao interromper nunca perde nem duplica.
   */
  readonly shutdownSignal?: AbortSignal
}

/** Um runner de fila. */
export type QueueRunner = (deps: RunnerDeps) => Promise<RunTally>

function tally(
  queue: SchedulerQueue,
  startedAt: Date,
  finishedAt: Date,
  counts: { planned: number; processed: number; failed: number; skipped: number },
  reasons: RunReason[],
  spendRequests?: { providerApi: string; requests: number },
): RunTally {
  return {
    queue,
    startedAt,
    finishedAt,
    ...counts,
    spend: spendRequests === undefined ? [] : [spendRequests],
    reasons,
  }
}

function countReason(bag: Map<string, RunReason>, code: string, detail: string): void {
  const found = bag.get(code)
  bag.set(code, { code, detail, count: (found?.count ?? 0) + 1 })
}

// ---------------------------------------------------------------------------
// (A) Filas de catalogo — enfileiram em `catalog_jobs`
// ---------------------------------------------------------------------------

/**
 * Enfileira `sync_details` para uma lista de titulos, com PRIORIDADE pela
 * posicao no ranking de popularidade.
 *
 * A chave de idempotencia inclui o DIA: dentro do mesmo dia reenfileirar e noop
 * (o job ja esta la), e no dia seguinte e trabalho novo. Sem o dia, o segundo
 * ciclo colidiria na mesma chave e a fila congelaria no primeiro lote — em
 * silencio, para sempre. E a mesma licao que o servico de catalogo ja aprendeu
 * na descoberta.
 */
async function enqueueTitleDetails(
  deps: RunnerDeps,
  queue: SchedulerQueue,
  candidates: readonly TitleCandidate[],
  startedAt: Date,
): Promise<RunTally> {
  const reasons = new Map<string, RunReason>()
  let processed = 0
  let skipped = 0
  let failed = 0

  for (const candidate of candidates) {
    try {
      // A PORTA UNICA de cobertura (`buildCoverageJob`). O agendador NAO monta o
      // job a mao: um segundo caminho de ingestao nao falha no dia em que e
      // escrito, falha no primeiro conserto aplicado a um caminho e esquecido no
      // outro — e ja aconteceu neste repositorio, mandando o `/changes` inteiro
      // para dead-letter em silencio. Travado por
      // `tests/governance/coverage-single-path.test.ts`.
      const result = await deps.services.store.enqueue(
        buildCoverageJob({
          kind: candidate.entityType,
          tmdbId: candidate.tmdbId,
          locale: deps.locale,
          reason: 'scheduled',
          // O DIA no escopo: dentro do dia reenfileirar e noop; no dia seguinte
          // e trabalho novo. Sem ele o segundo ciclo colidiria na mesma chave e a
          // fila congelaria no primeiro lote, em silencio.
          scope: dailyScope(queue, deps.now()),
          rank: candidate.rank,
          runId: `scheduler:${queue}`,
        }) as unknown as Record<string, unknown>,
      )
      if (result.created) processed += 1
      else {
        skipped += 1
        countReason(reasons, 'already_queued', 'job identico ja estava na fila deste dia')
      }
    } catch (error) {
      failed += 1
      countReason(reasons, 'enqueue_failed', String(error))
    }
  }

  return tally(
    queue,
    startedAt,
    deps.now(),
    { planned: candidates.length, processed, failed, skipped },
    [...reasons.values()],
  )
}

const runDiscovery: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const day = startedAt.toISOString().slice(0, 10)
  const kinds = ['movie', 'tv', 'person'] as const
  const reasons = new Map<string, RunReason>()
  let processed = 0
  let skipped = 0
  let failed = 0

  for (const kind of kinds) {
    try {
      const result = await deps.services.store.enqueue({
        jobType: 'discover_ids',
        entityType: kind,
        externalId: null,
        idempotencyKey: buildIdempotencyKey({
          jobType: 'discover_ids',
          entityType: kind,
          externalId: `daily-exports:${day}`,
        }),
        payload: {
          strategy: 'daily-exports',
          entityType: kind,
          locale: deps.locale,
          country: null,
          limit: null,
          maxPages: null,
          ids: null,
          // Sem isto a descoberta acharia ids e nao sincronizaria nada.
          enqueueDetails: true,
        },
        runId: 'scheduler:discovery',
      })
      if (result.created) processed += 1
      else {
        skipped += 1
        countReason(reasons, 'already_queued', 'descoberta do dia ja enfileirada')
      }
    } catch (error) {
      failed += 1
      countReason(reasons, 'enqueue_failed', String(error))
    }
  }

  return tally(
    'discovery',
    startedAt,
    deps.now(),
    { planned: kinds.length, processed, failed, skipped },
    [...reasons.values()],
  )
}

const runChanges: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  // Janela HORARIA: dois ciclos no mesmo dia sao trabalhos diferentes.
  const slot = hourlySlot(startedAt)
  const reasons = new Map<string, RunReason>()
  let processed = 0
  let skipped = 0
  let failed = 0

  try {
    const result = await deps.services.store.enqueue({
      jobType: 'sync_changes',
      entityType: null,
      externalId: null,
      idempotencyKey: buildIdempotencyKey({
        jobType: 'sync_changes',
        entityType: null,
        externalId: `incremental:${slot}`,
      }),
      payload: {
        kinds: ['movie', 'tv', 'person'],
        from: null,
        to: null,
        maxPages: null,
        // O checkpoint so avanca APOS o commit: um ciclo interrompido e refeito,
        // nunca pulado.
        resume: true,
      },
      runId: 'scheduler:changes',
    })
    if (result.created) processed += 1
    else {
      skipped += 1
      countReason(reasons, 'already_queued', 'ciclo desta hora ja enfileirado')
    }
  } catch (error) {
    failed += 1
    countReason(reasons, 'enqueue_failed', String(error))
  }

  return tally('changes', startedAt, deps.now(), { planned: 1, processed, failed, skipped }, [
    ...reasons.values(),
  ])
}

const runAiringSeries: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const candidates = await selectAiringSeries(deps.prisma, startedAt, deps.batchLimit)
  return enqueueTitleDetails(deps, 'airing_series', candidates, startedAt)
}

const runTitleDetailActive: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const candidates = await selectTitlesByActivity(deps.prisma, startedAt, 'active', deps.batchLimit)
  return enqueueTitleDetails(deps, 'title_detail_active', candidates, startedAt)
}

const runTitleDetailEnded: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const candidates = await selectTitlesByActivity(deps.prisma, startedAt, 'ended', deps.batchLimit)
  return enqueueTitleDetails(deps, 'title_detail_ended', candidates, startedAt)
}

const runPeople: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const olderThan = new Date(startedAt.getTime() - 30 * DAY_MS)
  const candidates = await selectStalePeople(deps.prisma, olderThan, deps.batchLimit)
  const reasons = new Map<string, RunReason>()
  let processed = 0
  let skipped = 0
  let failed = 0

  for (const candidate of candidates) {
    try {
      const result = await deps.services.store.enqueue(
        buildCoverageJob({
          kind: 'person',
          tmdbId: candidate.tmdbId,
          locale: deps.locale,
          reason: 'scheduled',
          scope: dailyScope('people', deps.now()),
          // `people` nao tem `popularity` no schema: sem rank medido, o pedido
          // cai na faixa mais baixa do motivo. Declarado, nao esquecido.
          rank: null,
          runId: 'scheduler:people',
        }) as unknown as Record<string, unknown>,
      )
      if (result.created) processed += 1
      else {
        skipped += 1
        countReason(reasons, 'already_queued', 'pessoa ja enfileirada neste dia')
      }
    } catch (error) {
      failed += 1
      countReason(reasons, 'enqueue_failed', String(error))
    }
  }

  return tally(
    'people',
    startedAt,
    deps.now(),
    { planned: candidates.length, processed, failed, skipped },
    [...reasons.values()],
  )
}

// ---------------------------------------------------------------------------
// (C) Ofertas — endpoint dedicado, escritor compartilhado
// ---------------------------------------------------------------------------

const runWatchOffers: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const olderThan = new Date(startedAt.getTime() - DAY_MS)
  const candidates = await selectStaleWatchOffers(deps.prisma, olderThan, deps.batchLimit)
  const reasons = new Map<string, RunReason>()
  let processed = 0
  let failed = 0
  let skipped = 0
  let requests = 0

  for (const candidate of candidates) {
    if (!deps.apply) {
      skipped += 1
      countReason(reasons, 'dry_run', 'sem --apply: nada foi buscado nem escrito')
      continue
    }
    try {
      const payload =
        candidate.entityType === 'movie'
          ? await deps.catalogEndpoints.getMovieWatchProviders(candidate.tmdbId)
          : await deps.catalogEndpoints.getTvWatchProviders(candidate.tmdbId)
      requests += 1

      // O normalizador le `payload['watch/providers']` — a mesma chave do
      // sub-recurso no detalhe. Embrulhar aqui e o que permite UM parser servir
      // as DUAS origens; um segundo parser divergiria no primeiro campo novo.
      const report = await ingestWatchProvidersFromDetail({
        entityType: candidate.entityType,
        tmdbId: candidate.tmdbId,
        entityId: null,
        payload: { 'watch/providers': payload },
        sink: deps.services.watch as never,
        now: deps.now,
      })

      if (report.outcome === 'applied' || report.outcome === 'empty') {
        processed += 1
        // `empty` NAO e falha: e "este titulo nao tem oferta hoje", e o snapshot
        // vazio e a AUSENCIA REGISTRADA com data — o dado que sumiu da fonte nao
        // some do banco em silencio.
        if (report.outcome === 'empty') {
          countReason(reasons, 'no_offer_today', 'titulo sem oferta nos territorios ingeridos')
        }
      } else {
        skipped += 1
        countReason(reasons, `watch_${report.outcome}`, `desfecho de oferta: ${report.outcome}`)
      }
    } catch (error) {
      failed += 1
      countReason(reasons, 'watch_fetch_failed', String(error))
    }
  }

  return tally(
    'watch_offers',
    startedAt,
    deps.now(),
    { planned: candidates.length, processed, failed, skipped },
    [...reasons.values()],
    { providerApi: 'tmdb', requests },
  )
}

// ---------------------------------------------------------------------------
// (B) Filas de outro servico — spawnam a CLI que o dono ja roda
// ---------------------------------------------------------------------------

/** Saida de um comando spawnado. */
interface SpawnResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

function tsxBin(repoRoot: string): string {
  return path.join(repoRoot, 'services', 'ingestion', 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

/**
 * Roda um script do repositorio com o `tsx` ja instalado, sem shell.
 *
 * `shell: false` (o default do `spawn` com array de args) e obrigatorio aqui: um
 * argumento vindo de configuracao nunca pode virar comando. E o `env` e herdado
 * inteiro de proposito — a CLI filha precisa da `DATABASE_URL` e das chaves, que
 * NUNCA transitam por argumento de linha de comando (onde apareceriam em `ps`).
 */
async function runScript(
  repoRoot: string,
  script: string,
  args: readonly string[],
  shutdownSignal?: AbortSignal,
): Promise<SpawnResult> {
  // Ja desligando: nem spawna. Subir um processo para mata-lo em seguida so
  // atrasaria a drenagem.
  if (shutdownSignal?.aborted === true) {
    return { code: null, stdout: '', stderr: 'desligando: comando nao iniciado' }
  }

  return await new Promise<SpawnResult>((resolve) => {
    const child = spawn(process.execPath, [tsxBin(repoRoot), script, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    const onAbort = (): void => {
      stderr += ' | desligando: SIGTERM enviado ao processo filho'
      child.kill('SIGTERM')
    }
    shutdownSignal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = (): void => shutdownSignal?.removeEventListener('abort', onAbort)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      cleanup()
      resolve({ code: null, stdout, stderr: `${stderr}${String(error)}` })
    })
    child.on('exit', (code) => {
      cleanup()
      resolve({ code, stdout, stderr })
    })
  })
}

const runRatingsOmdb: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const spentToday = await readSpentToday(deps.prisma, 'omdb', startedAt)
  const slots = backgroundOmdbSlots(spentToday, deps.batchLimit)

  if (slots === 0) {
    const verdict = checkOmdbBudget('seed', { spentToday })
    return tally(
      'ratings_omdb',
      startedAt,
      deps.now(),
      { planned: 0, processed: 0, failed: 0, skipped: 0 },
      [
        {
          code: verdict.granted ? 'no_slots' : verdict.reason,
          detail: verdict.granted ? 'sem fatia de cota hoje' : verdict.detail,
          count: 1,
        },
      ],
    )
  }

  // Dois tipos, fatia dividida: a OMDb cobra por titulo, e uma fatia so para
  // filmes deixaria as series sem nota por dias.
  const perType = Math.max(1, Math.floor(slots / 2))
  const reasons: RunReason[] = []
  let processed = 0
  let failed = 0
  let requests = 0

  for (const type of ['movie', 'tv'] as const) {
    const args = ['--type', type, '--limit', String(perType)]
    if (deps.apply) args.push('--apply')
    const result = await runScript(
      deps.repoRoot,
      path.join('services', 'ratings', 'bin', 'sync-omdb-ratings.ts'),
      args,
      deps.shutdownSignal,
    )
    deps.log.log('info', 'scheduler_ratings_omdb_child', {
      type,
      code: result.code,
      slots: perType,
    })
    if (result.code === 0) {
      processed += perType
      requests += perType
    } else {
      failed += perType
      reasons.push({
        code: 'omdb_child_failed',
        detail: `sync-omdb-ratings --type ${type} saiu com codigo ${String(result.code)}`,
        count: 1,
      })
    }
  }

  return tally(
    'ratings_omdb',
    startedAt,
    deps.now(),
    { planned: perType * 2, processed, failed, skipped: 0 },
    reasons,
    { providerApi: 'omdb', requests },
  )
}

const runAwards: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const args = ['--limit', String(deps.batchLimit)]
  if (deps.apply) args.push('--apply')
  const result = await runScript(
    deps.repoRoot,
    path.join('services', 'ratings', 'bin', 'promote-omdb-awards.ts'),
    args,
    deps.shutdownSignal,
  )
  const ok = result.code === 0
  return tally(
    'awards',
    startedAt,
    deps.now(),
    { planned: 1, processed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0 },
    ok
      ? []
      : [
          {
            code: 'awards_child_failed',
            detail: `promote-omdb-awards saiu com codigo ${String(result.code)}`,
            count: 1,
          },
        ],
    // Premiacao le do `api_cache` da OMDb quando ja ha payload; o custo real
    // aparece no log da propria CLI, que grava `api_sync_logs` por conta dela.
    { providerApi: 'omdb', requests: 0 },
  )
}

const runCinerieScore: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  const args = ['--type', 'all']
  if (deps.apply) args.push('--apply')
  const result = await runScript(
    deps.repoRoot,
    path.join('services', 'ratings', 'bin', 'compute-cinerie-score.ts'),
    args,
    deps.shutdownSignal,
  )
  const ok = result.code === 0
  return tally(
    'cinerie_score',
    startedAt,
    deps.now(),
    { planned: 1, processed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0 },
    ok
      ? []
      : [
          {
            code: 'score_child_failed',
            detail: `compute-cinerie-score saiu com codigo ${String(result.code)}`,
            count: 1,
          },
        ],
  )
}

const runSearchProjection: QueueRunner = async (deps) => {
  const startedAt = deps.now()
  // `search-reindex` MUTA a projecao que o sitemap le, entao a CLI exige
  // `--dry-run` OU `--apply` explicito. Passar nenhum dos dois faria o comando
  // recusar com erro de uso, e a fila reportaria falha sem nunca ter tentado.
  const args = ['search-reindex', deps.apply ? '--apply' : '--dry-run']
  const result = await runScript(
    deps.repoRoot,
    path.join('services', 'ingestion', 'bin', 'catalog.ts'),
    args,
    deps.shutdownSignal,
  )
  const ok = result.code === 0
  return tally(
    'search_projection',
    startedAt,
    deps.now(),
    { planned: 1, processed: ok ? 1 : 0, failed: ok ? 0 : 1, skipped: 0 },
    ok
      ? []
      : [
          {
            code: 'search_projection_failed',
            detail: `catalog search-reindex saiu com codigo ${String(result.code)}`,
            count: 1,
          },
        ],
  )
}

/** O registro completo. Fila sem runner e erro de construcao, nao no-op. */
export const QUEUE_RUNNERS: Readonly<Record<SchedulerQueue, QueueRunner>> = {
  discovery: runDiscovery,
  changes: runChanges,
  watch_offers: runWatchOffers,
  airing_series: runAiringSeries,
  title_detail_active: runTitleDetailActive,
  title_detail_ended: runTitleDetailEnded,
  people: runPeople,
  ratings_omdb: runRatingsOmdb,
  awards: runAwards,
  cinerie_score: runCinerieScore,
  search_projection: runSearchProjection,
}

/** Utilitario para o servico: a raiz do repositorio a partir deste arquivo. */
export function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // .../services/sync/src/scheduler/runtime -> raiz
  return path.resolve(here, '..', '..', '..', '..', '..')
}
