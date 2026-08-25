#!/usr/bin/env node
/**
 * bin/discover-ids.ts — Descoberta de IDs em massa via TMDB Daily ID Exports
 * (P0-00c). Worker-only/offline — NUNCA no render.
 *
 * Fica em services/ingestion/bin: fora do bundle de render, mas COBERTO pelo
 * typecheck — esta LISTADO em `tsconfig.runtime.json`, que `pnpm typecheck`
 * encadeia. (A lista la e por ARQUIVO, nao por diretorio: nem todo bin entra.)
 * Usa o core PURO em ../src/discovery/* (typechecked e
 * testado) e adiciona apenas o IO: download (fetch), gunzip streaming, escrita
 * do artefato e log em api_sync_logs.
 *
 * O QUE FAZ:
 *  1. Baixa SO os 7 exports padrao (nunca os arquivos adult_*): movie_ids,
 *     tv_series_ids, person_ids, collection_ids, tv_network_ids, keyword_ids,
 *     production_company_ids.
 *  2. Faz gunzip + parse JSONL (1 objeto por linha) em STREAMING: o download
 *     comprimido e o texto descomprimido nunca sao carregados inteiros na
 *     memoria (le-se linha a linha). Os registros MANTIDOS acumulam em memoria
 *     (O(nº de registros) — ~1M por export cheio). FILTRA conteudo adulto
 *     (fail-closed) + ids invalidos, e conta linhas JSONL puladas.
 *  3. Monta a fila de sync IDEMPOTENTE (dedup + ordenacao deterministica).
 *  4. --apply: escreve o artefato NDJSON gitignored e loga contagens em
 *     api_sync_logs (regra "todo sync externo gera log"). Dry-run (default) so
 *     reporta contagens; nada e escrito.
 *
 * NAO FAZ (fora de escopo P0-00c): buscar detalhe com append_to_response, gravar
 * tmdb_raw (P0-00d), baixar imagens, tocar Prisma schema/migration.
 *
 * Exports sao PUBLICOS (sem token TMDB). DATABASE_URL so e exigido no --apply
 * (para o log). Fail-closed: aborta em producao.
 *
 * Uso (a partir da raiz). Resolva o cli do tsx e rode com --apply (dry-run sem a
 * flag), como os demais scripts:
 *   node "<caminho-do-tsx-cli>" services/ingestion/bin/discover-ids.ts --apply
 *   # flags:
 *   #   --apply           escreve o artefato + loga (sem a flag = dry-run)
 *   #   --date=YYYY-MM-DD data do export (default: hoje em UTC)
 *   #   --only=a,b        subconjunto de kinds (movie,tv,person,collection,network,company,keyword)
 *   #   --max-per-type=N  amostragem para dev: TOP-N por POPULARIDADE de cada
 *   #                     export (le o arquivo inteiro; nunca corte de prefixo)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGunzip } from 'node:zlib'

import { createTopRecordSampler } from '../src/discovery/export-sample.js'
import {
  DAILY_ID_EXPORTS,
  exportFileName,
  exportUrl,
  formatExportDate,
  parseIdExportLine,
  type IdExportFile,
} from '../src/discovery/id-exports.js'
import { buildSyncQueue, type DiscoverySource } from '../src/discovery/sync-queue.js'
import { hashPayload } from '../src/utils/hash.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { getPrismaClient } from '@screena/db/server'

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

/** Data alvo (UTC): --date=YYYY-MM-DD ou hoje. */
function resolveDate(argv: string[]): Date {
  const raw = flagValue(argv, 'date')
  if (raw === null) return new Date()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (match === null) throw new Error(`--date invalido: "${raw}" (use YYYY-MM-DD).`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}

/**
 * Baixa + gunzip + parseia UM export (streaming), amostrando o TOP-N por
 * POPULARIDADE quando ha `--max-per-type`.
 *
 * O corte NUNCA e de prefixo: a versao anterior parava de ler na linha N, e
 * como o export vem em ordem de id (data de cadastro), a amostra de dev era
 * o museu do TMDB — os N ids mais antigos — com o `buildSyncQueue` ordenando
 * um universo ja truncado. O sampler consome o arquivo INTEIRO e so decide na
 * ultima linha, com memoria O(N); a ordem e a MESMA total do `buildSyncQueue`
 * (popularidade desc, sem-popularidade por ultimo, id asc no empate), entao
 * amostra e fila final nunca discordam. Custo: ler o arquivo ate o fim — que
 * e exatamente o preco de uma amostra representativa.
 */
async function downloadExport(exp: IdExportFile, date: Date, maxPerType: number | null) {
  const res = await fetch(exportUrl(exp.file, date))
  if (!res.ok || res.body === null) {
    throw new Error(`HTTP ${res.status} em ${exportFileName(exp.file, date)}`)
  }

  // O mesmo cast de plan-seed.ts: o ReadableStream do fetch (tipos DOM) e o do
  // node:stream/web divergem so no tipo — em runtime e o mesmo objeto.
  const nodeStream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  const rl = createInterface({ input: nodeStream.pipe(createGunzip()), crlfDelay: Infinity })

  // movie/person trazem `adult` por linha -> ausencia e fail-closed (unsafe).
  const sampler = createTopRecordSampler({
    limit: maxPerType,
    adultFieldRequired: exp.hasAdultField,
  })
  let skippedLines = 0
  for await (const line of rl) {
    const record = parseIdExportLine(line)
    if (record === null) {
      skippedLines += 1
      continue
    }
    sampler.offer(record)
  }

  const sample = sampler.finish()
  return {
    kept: sample.kept,
    adultDropped: sample.counts.adultDropped,
    unsafeDropped: sample.counts.unsafeDropped,
    invalidDropped: sample.counts.invalidDropped,
    duplicate: sample.counts.duplicate,
    skippedLines,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const date = resolveDate(argv)
  const onlyRaw = flagValue(argv, 'only')
  const maxRaw = flagValue(argv, 'max-per-type')
  const maxPerType = maxRaw !== null && Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : null

  const only = onlyRaw ? new Set(onlyRaw.split(',').map((s) => s.trim())) : null
  const exports = DAILY_ID_EXPORTS.filter((e) => only === null || only.has(e.kind))

  loadRepoEnv()
  const hasDb = Boolean(process.env.DATABASE_URL?.trim())
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'

  console.log('== Cinerie · Descoberta de IDs (TMDB Daily ID Exports — P0-00c) ==')
  console.log(
    `Data alvo (UTC): ${formatExportDate(date)} · exports: ${exports.map((e) => e.kind).join(', ')}`,
  )
  console.log(
    'Arquivos adult_* NUNCA sao baixados; alem disso, adult===true e descartado por linha.',
  )

  if (isProd) {
    console.error('Abortado: producao real detectada — descoberta so em local/staging.')
    process.exitCode = 1
    return
  }
  if (apply && !hasDb) {
    console.error('Abortado: --apply exige DATABASE_URL (para o log em api_sync_logs).')
    process.exitCode = 1
    return
  }

  const sources: DiscoverySource[] = []
  const syncLog = apply ? createPrismaSyncLog(getPrismaClient()) : null
  let totalKept = 0
  let totalAdult = 0
  let totalUnsafe = 0

  for (const exp of exports) {
    const startedAt = Date.now()
    const endpoint = `/p/exports/${exportFileName(exp.file, date)}`
    try {
      const { kept, adultDropped, unsafeDropped, invalidDropped, duplicate, skippedLines } =
        await downloadExport(exp, date, maxPerType)
      sources.push({ kind: exp.kind, records: [...kept] })
      totalKept += kept.length
      totalAdult += adultDropped
      totalUnsafe += unsafeDropped
      console.log(
        `  ${exp.kind}: ${kept.length} mantidos, ${adultDropped} adultos, ${unsafeDropped} adult-malformado/ausente (fail-closed), ${invalidDropped} id-invalido, ${duplicate} duplicados, ${skippedLines} linhas puladas.`,
      )
      if (syncLog !== null) {
        await syncLog.write({
          endpoint,
          status: kept.length === 0 ? 'empty' : 'success',
          itemsProcessed: kept.length,
          durationMs: Date.now() - startedAt,
          quotaCost: 0,
          payloadHash: hashPayload(kept.map((r) => r.id).sort((a, b) => a - b)),
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`  ${exp.kind}: FALHOU — ${message} (seguindo com os demais tipos).`)
      if (syncLog !== null) {
        await syncLog.write({
          endpoint,
          status: 'failed',
          errorCode: 'export_download_failed',
          durationMs: Date.now() - startedAt,
          quotaCost: 0,
        })
      }
    }
  }

  const queue = buildSyncQueue(sources)
  console.log(
    `Fila montada: ${queue.length} itens (${totalKept} mantidos, ${totalAdult} adultos + ${totalUnsafe} adult-malformado descartados no total).`,
  )

  if (!apply) {
    console.log('Dry-run: NADA foi escrito. Use --apply para gravar o artefato + logar.')
    return
  }

  const outDir = path.join(repoRoot(), 'services', 'ingestion', '.data')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `discovery-queue-${formatExportDate(date)}.ndjson`)
  const body = queue.map((item) => JSON.stringify(item)).join('\n')
  writeFileSync(outFile, queue.length > 0 ? `${body}\n` : '')
  console.log(`Artefato gravado (gitignored): ${outFile}`)
}

main().catch((error: unknown) => {
  console.error('Falha na descoberta de IDs:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
