#!/usr/bin/env node
/**
 * bin/promote-tmdb-raw.ts — Worker de PROMOCAO (P0-00f: movie f.1, tv f.2).
 * Worker-only/offline — NUNCA no render.
 *
 * Le o payload BRUTO ja gravado em `tmdb_raw` (movie ou tv) e o promove para as
 * tabelas tipadas EXISTENTES (`movies`/`tv_shows` + imagens + `entity_external_ids`
 * + `cast_members`/`crew_members` + `people`, via o `EntityStorePort` de sempre) e
 * cria o slug canonico pt-BR (idempotente + 301) e a traducao pt-BR (via o
 * finalize compartilhado com o backfill). ZERO chamada TMDB — a fonte e o banco.
 *
 * Fica em services/ingestion/bin: EXCLUIDO do typecheck e do bundle de render.
 * Usa o core PURO GENERICO em ../src/raw-promote/* (`promoteFromRaw` + strategy;
 * typechecked + testado) + os adapters de persistencia; adiciona so o IO: prisma,
 * log e relatorio.
 *
 * NAO FAZ (fora do escopo P0-00f): person; season/episode (nao estao no payload
 * de detalhe); galerias/videos/keywords/watch; tocar schema/migration; baixar
 * imagem; chamar TMDB. Se faltar coluna/tabela para algum campo, o item FALHA e e
 * reportado — nunca cria schema.
 *
 * FAIL-CLOSED: aborta em producao; exige DATABASE_URL (le tmdb_raw do banco
 * dev/staging). NAO exige token TMDB (nao ha rede). --apply para escrever
 * (sem a flag = dry-run: so conta quantas entidades ha em tmdb_raw).
 *
 * Uso (a partir da raiz). Resolva o cli do tsx e rode (dry-run sem --apply):
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/promote-tmdb-raw.ts
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/promote-tmdb-raw.ts --apply --kind=tv
 *   # flags (aceitam --flag=valor E --flag valor):
 *   #   --apply                 promove de fato (sem a flag = dry-run, nada escrito)
 *   #   --kind=movie|tv         tipo a promover (default movie)
 *   #   --limit=N               teto de entidades (default 100; --limit-movies e alias)
 *   #   --report=<arquivo>      relatorio (.md ou .json; default em .data/, gitignored)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'
import { createPrismaStore } from '../src/persistence/store.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { createPrismaCatalogFinalize } from '../src/persistence/catalog-finalize.js'
import {
  createPrismaRawMovieSource,
  createPrismaRawTvSource,
} from '../src/persistence/tmdb-raw-promote-store.js'
import { describePromoteGateReason, evaluatePromoteGate } from '../src/raw-promote/gate.js'
import { promoteMoviesFromRaw, promoteTvShowsFromRaw } from '../src/raw-promote/run.js'
import {
  derivePromoteStatus,
  promoteProcessed,
  renderPromoteReport,
  serializePromoteReportJson,
} from '../src/raw-promote/report.js'
import type { PromoteOutcome, PromoteReport } from '../src/raw-promote/types.js'

/** Idioma base da promocao (invariante 7: pt-BR primeiro). */
const BASE_LANGUAGE = 'pt-BR'
/** Teto default de entidades por execucao (piloto pequeno). */
const DEFAULT_PROMOTE_LIMIT = 100

/** Tipos de entidade promovíveis nesta fase (P0-00f.1 movie, f.2 tv). */
type PromoteKind = 'movie' | 'tv'

/** Argumentos parseados do CLI. */
interface PromoteArgs {
  apply: boolean
  kind: PromoteKind
  limit: number | null
  report: string | null
}

/**
 * Parser FAIL-LOUD (aceita `--flag=valor` e `--flag valor`): valor faltante,
 * flag desconhecida ou inteiro invalido geram ERRO — nunca fallback silencioso.
 * `--limit-movies` e alias historico (P0-00f.1) de `--limit`.
 */
function parseArgs(argv: readonly string[]): PromoteArgs {
  let apply = false
  let kind: PromoteKind = 'movie'
  let limit: number | null = null
  let report: string | null = null

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue
    if (token === '--apply') {
      apply = true
      continue
    }
    if (!token.startsWith('--')) {
      throw new Error(`argumento inesperado: "${token}" (use --flag=valor ou --flag valor).`)
    }
    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)
    if (name !== 'kind' && name !== 'limit' && name !== 'limit-movies' && name !== 'report') {
      throw new Error(`flag desconhecida: --${name}.`)
    }
    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`--${name} exige um valor (use --${name}=<valor> ou --${name} <valor>).`)
      }
      value = next
      i += 1
    }
    if (value === '') throw new Error(`--${name} recebeu valor vazio.`)
    if (name === 'report') {
      report = value
    } else if (name === 'kind') {
      if (value !== 'movie' && value !== 'tv') {
        throw new Error(`--kind deve ser "movie" ou "tv" (recebido "${value}").`)
      }
      kind = value
    } else {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${name} deve ser inteiro positivo (recebido "${value}").`)
      }
      limit = parsed
    }
  }
  return { apply, kind, limit, report }
}

function repoRoot(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url)) // services/ingestion/bin
  return path.resolve(dir, '..', '..', '..')
}

function loadRepoEnv(): void {
  const envPath = path.join(repoRoot(), '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

const dataDir = (): string => path.join(repoRoot(), 'services', 'ingestion', '.data')

function defaultReportPath(kind: PromoteKind): string {
  return path.join(dataDir(), `promote-${kind}-report.md`)
}

function writeReport(report: PromoteReport, reportPath: string): void {
  mkdirSync(path.dirname(reportPath), { recursive: true })
  const body = reportPath.endsWith('.json')
    ? serializePromoteReportJson(report)
    : renderPromoteReport(report)
  writeFileSync(reportPath, `${body}\n`)
}

async function main(): Promise<void> {
  let args: PromoteArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`Argumento invalido: ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
    return
  }

  loadRepoEnv()
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  const limit = args.limit ?? DEFAULT_PROMOTE_LIMIT
  const reportPath = args.report ?? defaultReportPath(args.kind)

  console.log(`== Screen · Promocao tmdb_raw -> tabelas tipadas (P0-00f, ${args.kind}) ==`)
  console.log(`Modo: ${args.apply ? 'APPLY (grava tabelas tipadas)' : 'dry-run (nada tocado)'}`)
  console.log(`Limite: ${limit} ${args.kind}(s).`)

  const gate = evaluatePromoteGate({ apply: args.apply, isProd, hasDb })
  if (!gate.allowed) {
    console.error(describePromoteGateReason(gate.reason!))
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  const store = createPrismaStore(prisma)
  const finalize = createPrismaCatalogFinalize(prisma, BASE_LANGUAGE)
  const syncLog = createPrismaSyncLog(prisma)
  const endpoint = `promote-${args.kind}`

  // Guarda a linha AUTORITATIVA de api_sync_logs (licao do P0-00e): uma vez
  // escrita, o catch de erro inesperado NAO grava 2a linha contraditoria.
  let mainLogWritten = false

  // Opcoes comuns aos dois wrappers (so a `source` muda por tipo).
  const common = {
    store,
    finalize,
    baseLanguage: BASE_LANGUAGE,
    limit,
    now: () => new Date(),
    dryRun: !args.apply,
    onItem: (tmdbId: number, outcome: PromoteOutcome) => {
      if (outcome === 'failed') console.warn(`  ${args.kind} ${tmdbId}: FALHOU (nao promovido).`)
    },
  }

  try {
    const report =
      args.kind === 'tv'
        ? await promoteTvShowsFromRaw({ source: createPrismaRawTvSource(prisma), ...common })
        : await promoteMoviesFromRaw({ source: createPrismaRawMovieSource(prisma), ...common })

    if (!args.apply) {
      // Dry-run: so conta. Sem api_sync_logs (nenhum sync externo/escrita).
      try {
        writeReport(report, reportPath)
      } catch (reportError) {
        console.warn(
          'Aviso: falha ao escrever o relatorio auxiliar (gitignored):',
          reportError instanceof Error ? reportError.message : reportError,
        )
      }
      console.log(
        `Plano: ${report.available} ${args.kind}(s) em tmdb_raw; promoveria ${report.selected}.`,
      )
      console.log(`Relatorio (gitignored): ${reportPath}`)
      console.log('Dry-run: NADA foi promovido. Use --apply para promover (idempotente).')
      return
    }

    const status = derivePromoteStatus(report)
    const errorCode = status === 'failed' ? 'promote_failed' : null
    await syncLog.write({
      endpoint,
      status,
      errorCode,
      itemsProcessed: promoteProcessed(report.counts),
      itemsCreated: report.counts.created,
      itemsUpdated: report.counts.updated,
      durationMs: report.durationMs,
      quotaCost: 0, // promocao nao gasta quota TMDB (le do banco)
      payloadHash: null,
    })
    mainLogWritten = true

    try {
      writeReport(report, reportPath)
    } catch (reportError) {
      console.warn(
        'Aviso: falha ao escrever o relatorio auxiliar (gitignored):',
        reportError instanceof Error ? reportError.message : reportError,
      )
    }

    const c = report.counts
    console.log(
      `Promocao (${status}): created=${c.created}, updated=${c.updated}, failed=${c.failed} (de ${report.selected} selecionado(s); ${report.available} em tmdb_raw).`,
    )
    console.log(`Log em api_sync_logs (1 linha-resumo) · relatorio completo: ${reportPath}`)
  } catch (error) {
    // Regra de ingestao: todo sync/escrita gera log. So loga fallback se o log
    // autoritativo ainda nao saiu (nao duplica o ciclo com status contraditorio).
    if (args.apply && !mainLogWritten) {
      try {
        await syncLog.write({
          endpoint,
          status: 'aborted',
          errorCode: 'promote_unexpected_error',
          durationMs: null,
          quotaCost: null,
          payloadHash: null,
        })
      } catch (logError) {
        console.error(
          'Falha ao registrar log de abort:',
          logError instanceof Error ? logError.message : logError,
        )
      }
    }
    process.exitCode = 1
    console.error(
      'Promocao abortada por erro inesperado:',
      error instanceof Error ? error.message : error,
    )
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error('Falha na promocao:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
