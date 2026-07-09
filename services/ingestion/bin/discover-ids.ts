#!/usr/bin/env node
/**
 * bin/discover-ids.ts — Descoberta de IDs em massa via TMDB Daily ID Exports
 * (P0-00c). Worker-only/offline — NUNCA no render.
 *
 * Fica em services/ingestion/bin (como os demais bins): EXCLUIDO do typecheck e
 * do bundle de render. Usa o core PURO em ../src/discovery/* (typechecked e
 * testado) e adiciona apenas o IO: download (fetch), gunzip streaming, escrita
 * do artefato e log em api_sync_logs.
 *
 * O QUE FAZ:
 *  1. Baixa SO os 7 exports padrao (nunca os arquivos adult_*): movie_ids,
 *     tv_series_ids, person_ids, collection_ids, tv_network_ids, keyword_ids,
 *     production_company_ids.
 *  2. Faz gunzip + parse JSONL (1 objeto por linha), streaming (memoria O(1) por
 *     linha), e FILTRA conteudo adulto (`adult === true`) + ids invalidos.
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
 *   #   --max-per-type=N  amostragem para dev (default: sem limite)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGunzip } from 'node:zlib'

import { filterAdult } from '../src/discovery/adult-filter.js'
import {
  DAILY_ID_EXPORTS,
  exportFileName,
  exportUrl,
  formatExportDate,
  parseIdExportLine,
  type IdExportRecord,
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

/** Baixa + gunzip + parseia UM export, filtrando adult/ids invalidos (streaming). */
async function downloadExport(file: string, date: Date, maxPerType: number | null) {
  const res = await fetch(exportUrl(file, date))
  if (!res.ok || res.body === null) {
    throw new Error(`HTTP ${res.status} em ${exportFileName(file, date)}`)
  }

  const nodeStream = Readable.fromWeb(res.body)
  const rl = createInterface({ input: nodeStream.pipe(createGunzip()), crlfDelay: Infinity })

  const raw: IdExportRecord[] = []
  for await (const line of rl) {
    const record = parseIdExportLine(line)
    if (record === null) continue
    raw.push(record)
    if (maxPerType !== null && raw.length >= maxPerType) {
      rl.close()
      nodeStream.destroy()
      break
    }
  }

  return filterAdult(raw)
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

  console.log('== Screen · Descoberta de IDs (TMDB Daily ID Exports — P0-00c) ==')
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

  for (const exp of exports) {
    const startedAt = Date.now()
    const endpoint = `/p/exports/${exportFileName(exp.file, date)}`
    try {
      const { kept, adultDropped, invalidDropped } = await downloadExport(exp.file, date, maxPerType)
      sources.push({ kind: exp.kind, records: kept })
      totalKept += kept.length
      totalAdult += adultDropped
      console.log(
        `  ${exp.kind}: ${kept.length} mantidos, ${adultDropped} adultos descartados, ${invalidDropped} invalidos.`,
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
    `Fila montada: ${queue.length} itens (${totalKept} mantidos, ${totalAdult} adultos descartados no total).`,
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
