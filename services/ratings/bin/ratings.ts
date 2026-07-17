#!/usr/bin/env node
/**
 * bin/ratings.ts — CLI unificada de ratings. Worker-only/offline — NUNCA no render.
 *
 * Fora do `tsconfig.json` principal (depende do Prisma Client gerado), mas
 * COBERTO por `tsconfig.runtime.json` (`pnpm typecheck:catalog-runtime`, gate no
 * CI apos o db:generate). Nao ha regiao sem tipo.
 *
 * O nucleo PURO (parser, ajuda, exit codes, relatorio, guardrails) vive em
 * ../src/cli/* e ../src/promotion/* e e testado sem banco e sem chave. Aqui fica
 * so o IO: env, Prisma, RapidAPI, saida.
 *
 * Uso (a partir da raiz):
 *   pnpm ratings --help
 *   pnpm ratings sample --source imdb --entity movie --limit 20 --dry-run
 *   pnpm ratings review --source imdb --limit 50
 *   pnpm ratings promote --ids=101,102 --reviewer=ana@cinerie --confirm
 *
 * `review`/`promote`/`revoke` NAO fazem rede: so PostgreSQL. `sample`/`sync`
 * chamam o fornecedor e por isso exigem chave — e ambos gravam log em
 * `api_sync_logs` (regra: todo sync externo gera log).
 */

import { disconnectPrisma, getPrismaClient, type PrismaClient } from '@screena/db/server'

import {
  EXIT_CODES,
  buildReportJson,
  parseRatingsArgs,
  renderRatingsHelp,
  renderReport,
  type RatingsArgs,
} from '../src/cli/index.js'
import { createMetricsCollector, type MetricsCollector } from '../src/metrics.js'
import { evaluateRatingPromotionEligibility, evaluateRatingRevocationEligibility } from '../src/promotion/guardrails.js'
import type { RatingPromotionCandidate } from '../src/promotion/types.js'
import {
  createPrismaRatingsReviewStore,
  type RatingsReviewStorePort,
} from '../src/persistence/ratings-review-store.js'
import type { EvaluatedCandidate } from '../src/cli/report.js'

function fatal(message: string, code: number): never {
  console.error(`erro: ${message}`)
  process.exit(code)
}

/** Abre o Prisma com DATABASE_URL. Sem banco, nao ha o que fazer. */
function openPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL
  if (url === undefined || url.trim() === '') {
    fatal('DATABASE_URL ausente (esta CLI e worker-only e le/escreve PostgreSQL)', EXIT_CODES.environment)
  }
  return getPrismaClient()
}

/** Avalia um lote de candidatas contra os guardrails puros. */
function evaluateAll(
  candidates: readonly RatingPromotionCandidate[],
  now: Date,
): readonly EvaluatedCandidate[] {
  return candidates.map((candidate) => ({
    candidate,
    evaluation: evaluateRatingPromotionEligibility(candidate, { now }),
  }))
}

/** Conta as metricas derivaveis de um lote avaliado. */
function countMetrics(metrics: MetricsCollector, evaluated: readonly EvaluatedCandidate[]): void {
  for (const item of evaluated) {
    if (item.candidate.displayAllowed) metrics.increment('ratings_displayable_total')
    if (item.evaluation.eligible) metrics.increment('ratings_recognized_total')
    else metrics.increment('ratings_rejected_total')
  }
}

/** Emite o relatorio no formato pedido. */
function emit(
  args: { readonly json: boolean },
  report: ReturnType<typeof buildReportJson>,
): void {
  console.log(args.json ? JSON.stringify(report, null, 2) : renderReport(report))
}

async function runReview(
  store: RatingsReviewStorePort,
  args: Extract<RatingsArgs, { command: 'review' }>,
  metrics: MetricsCollector,
): Promise<number> {
  const candidates = await store.listCandidates({
    ratingSource: args.source,
    entityType: args.entity,
    limit: args.limit,
  })
  const evaluated = evaluateAll(candidates, new Date())
  countMetrics(metrics, evaluated)
  emit(args, buildReportJson({ command: 'review', mode: 'dry-run', evaluated, metrics: metrics.snapshot() }))
  return EXIT_CODES.ok
}

async function runPromote(
  store: RatingsReviewStorePort,
  args: Extract<RatingsArgs, { command: 'promote' }>,
  metrics: MetricsCollector,
): Promise<number> {
  const candidates = await store.findByIds(args.ids)
  const missing = args.ids.filter((id) => !candidates.some((c) => c.id === id))
  if (missing.length > 0) {
    console.error(`aviso: ids inexistentes ignorados: ${missing.join(',')}`)
  }
  const evaluated = evaluateAll(candidates, new Date())
  countMetrics(metrics, evaluated)

  const eligible = evaluated.filter((e) => e.evaluation.eligible).map((e) => e.candidate.id)

  if (!args.confirm) {
    emit(args, buildReportJson({ command: 'promote', mode: 'dry-run', evaluated, metrics: metrics.snapshot() }))
    console.log(`\n${eligible.length} nota(s) seriam promovidas. Use --confirm --reviewer=<quem> para executar.`)
    return EXIT_CODES.ok
  }

  // `args.reviewer` e garantido nao-nulo pelo parser quando `confirm` e true.
  const outcome = await store.promote(eligible, args.reviewer as string)
  metrics.increment('ratings_displayable_total', outcome.updated)
  emit(args, buildReportJson({ command: 'promote', mode: 'apply', evaluated, metrics: metrics.snapshot() }))
  console.log(`\npromovidas: ${outcome.updated}/${eligible.length} (revisor: ${args.reviewer})`)

  // Elegivel pelos guardrails mas recusada pelo BANCO significa que o trigger
  // sabe algo que a camada pura nao sabia. Nao e ruido: e a trava funcionando, e
  // o operador precisa saber que a promocao NAO aconteceu.
  if (outcome.updated < eligible.length) {
    console.error(
      `governanca barrou ${eligible.length - outcome.updated} nota(s) no banco (trigger fail-closed).`,
    )
    return EXIT_CODES.governance
  }
  return EXIT_CODES.ok
}

async function runRevoke(
  store: RatingsReviewStorePort,
  args: Extract<RatingsArgs, { command: 'revoke' }>,
  metrics: MetricsCollector,
): Promise<number> {
  const candidates = await store.findByIds(args.ids)
  const evaluated = candidates.map((candidate) => {
    const revocation = evaluateRatingRevocationEligibility(candidate)
    return {
      candidate,
      evaluation: {
        eligible: revocation.eligible,
        reason: null,
        detail: revocation.reason === null ? null : `revogacao: ${revocation.reason}`,
      },
    } as EvaluatedCandidate
  })
  const revocable = evaluated.filter((e) => e.evaluation.eligible).map((e) => e.candidate.id)

  if (!args.confirm) {
    emit(args, buildReportJson({ command: 'revoke', mode: 'dry-run', evaluated, metrics: metrics.snapshot() }))
    console.log(`\n${revocable.length} nota(s) seriam revogadas. Use --confirm para executar.`)
    return EXIT_CODES.ok
  }

  const outcome = await store.revoke(revocable)
  emit(args, buildReportJson({ command: 'revoke', mode: 'apply', evaluated, metrics: metrics.snapshot() }))
  console.log(`\nrevogadas: ${outcome.updated}/${revocable.length}`)
  return EXIT_CODES.ok
}

async function main(): Promise<void> {
  const parsed = parseRatingsArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`erro de uso: ${parsed.error}\n`)
    console.error(renderRatingsHelp())
    process.exit(EXIT_CODES.usage)
  }

  const args = parsed.args
  if (args.command === 'help') {
    console.log(renderRatingsHelp())
    process.exit(EXIT_CODES.ok)
  }

  if (args.command === 'sample' || args.command === 'sync') {
    // `sample`/`sync` chamam o fornecedor e ja tem entrypoint dedicado, com
    // cache, backoff, circuit breaker e log em api_sync_logs. Duplicar essa
    // orquestracao aqui criaria dois caminhos de rede divergentes — o pior
    // resultado possivel para uma regra que exige "todo sync gera log".
    console.error(
      `o comando "${args.command}" faz chamada real ao fornecedor e roda pelo entrypoint dedicado:\n` +
        `  node --import tsx services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=${args.limit}` +
        `${args.id === null ? '' : ` --id=${args.id}`}${args.command === 'sync' ? ' --apply' : ' --sample'}\n\n` +
        `Ele exige RAPIDAPI_FILM_SHOW_RATINGS_KEY e grava api_cache + api_sync_logs.`,
    )
    process.exit(EXIT_CODES.usage)
  }

  const prisma = openPrisma()
  const metrics = createMetricsCollector()
  const store = createPrismaRatingsReviewStore(prisma)
  try {
    let code: number
    if (args.command === 'review') code = await runReview(store, args, metrics)
    else if (args.command === 'promote') code = await runPromote(store, args, metrics)
    else code = await runRevoke(store, args, metrics)
    process.exitCode = code
  } catch (error) {
    console.error(`erro inesperado: ${(error as Error).message}`)
    process.exitCode = EXIT_CODES.unexpected
  } finally {
    await disconnectPrisma()
  }
}

void main()
