#!/usr/bin/env node
/**
 * bin/purge-api-cache.ts — recolhe as linhas VENCIDAS de `api_cache`.
 * Worker-only, OFFLINE — nunca no caminho de render.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * Medido em 2026-09-01: `api_cache` com **543.936 linhas e 5.075 MB (~50% do
 * banco)**, das quais **500.140 (89%) ja vencidas**, ocupando **3,6 GB**. Nada
 * no sistema apagava uma linha de `api_cache`. A coluna `expires_at` sempre
 * existiu e sempre foi respeitada na LEITURA; ninguem nunca recolheu o que
 * venceu.
 *
 * ============================================================================
 * FAIL-CLOSED EM TRES CAMADAS
 * ============================================================================
 *  1. `DATABASE_URL` ausente         -> nao roda.
 *  2. `CINERIE_CACHE_PURGE_ENABLED`  -> precisa ser exatamente "true".
 *  3. sem `--apply`                  -> CONTA e nao apaga (o default).
 *
 * A camada 2 e o interruptor que o dono controla sem mexer em codigo, e ela e
 * separada do `--apply` de proposito: `--apply` diz "esta invocacao escreve",
 * a variavel diz "esta INSTALACAO pode expurgar". Um `--apply` digitado em
 * runbook de staging nao deve apagar producao so porque alguem colou o comando.
 *
 * ============================================================================
 * O QUE NUNCA E APAGADO
 * ============================================================================
 * `expires_at IS NULL` — NULL nao e "venceu ha muito", e **sem prazo**. Ver
 * `../src/cache-purge.ts`, que carrega o predicado e o teste que o trava.
 *
 * ============================================================================
 * LOG
 * ============================================================================
 * Uma linha de `api_sync_logs` por FORNECEDOR cujo lixo foi recolhido, com
 * `items_processed` = linhas apagadas daquele fornecedor. A chave vem do
 * proprio `RETURNING provider_api`, entao ela satisfaz a FK
 * `api_sync_logs.provider_api -> api_providers.key` por construcao — inventar
 * um rotulo de manutencao aqui exigiria fornecedor novo no registro, ou seja,
 * migration.
 *
 * Uso (a partir da raiz do repositorio):
 *   corepack pnpm --filter @screena/sync exec tsx bin/purge-api-cache.ts
 *   corepack pnpm --filter @screena/sync exec tsx bin/purge-api-cache.ts --apply
 *
 * Runbook completo: docs/operations/api-cache-purge.md
 */

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'

import {
  CACHE_PURGE_BATCH_SIZE,
  CACHE_PURGE_MAX_BATCHES_PER_CYCLE,
  COUNT_EXPIRED_SQL,
  PURGE_BATCH_SQL,
  purgeExpiredCache,
  type PurgedRow,
} from '../src/cache-purge.js'

const ENABLE_ENV = 'CINERIE_CACHE_PURGE_ENABLED'
const ENDPOINT = 'scheduler/cache_purge'

interface Args {
  readonly apply: boolean
  readonly batchSize: number
  readonly maxBatches: number
}

function parseArgs(
  argv: readonly string[],
): { ok: true; args: Args } | { ok: false; error: string } {
  let apply = false
  let batchSize = CACHE_PURGE_BATCH_SIZE
  let maxBatches = CACHE_PURGE_MAX_BATCHES_PER_CYCLE

  for (const raw of argv) {
    if (raw === '--apply') {
      apply = true
      continue
    }
    const eq = raw.indexOf('=')
    if (eq === -1) return { ok: false, error: `flag desconhecida: ${raw}` }
    const flag = raw.slice(0, eq)
    const value = Number.parseInt(raw.slice(eq + 1), 10)
    if (!Number.isInteger(value) || value <= 0) {
      return { ok: false, error: `${flag} exige inteiro > 0` }
    }
    if (flag === '--batch-size') batchSize = value
    else if (flag === '--max-batches') maxBatches = value
    else return { ok: false, error: `flag desconhecida: ${flag}` }
  }

  return { ok: true, args: { apply, batchSize, maxBatches } }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const { apply, batchSize, maxBatches } = parsed.args

  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.error('DATABASE_URL ausente: o expurgo nao roda sem banco.')
    process.exitCode = 1
    return
  }
  // Comparacao com a string exata: "1", "yes" ou "sim" NAO habilitam.
  if (apply && process.env[ENABLE_ENV]?.trim() !== 'true') {
    console.error(
      `${ENABLE_ENV} nao esta em "true": --apply recusado. ` +
        'A variavel autoriza a INSTALACAO a expurgar; a flag autoriza a INVOCACAO. ' +
        'As duas sao necessarias.',
    )
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  const now = new Date()
  const startedAt = Date.now()

  try {
    const before = await prisma.$queryRawUnsafe<{ expired: bigint }[]>(
      COUNT_EXPIRED_SQL,
      now.toISOString(),
    )
    const expiredBefore = Number(before[0]?.expired ?? 0n)

    if (!apply) {
      console.log(
        `[dry-run] ${expiredBefore} linha(s) VENCIDA(s) em api_cache. ` +
          `Apagaria em lotes de ${batchSize}, ate ${maxBatches} lote(s) ` +
          `(${batchSize * maxBatches} linhas por execucao). ` +
          'Nada foi apagado. Use --apply para executar.',
      )
      return
    }

    const result = await purgeExpiredCache(
      (limit) => prisma.$queryRawUnsafe<PurgedRow[]>(PURGE_BATCH_SQL, now.toISOString(), limit),
      { batchSize, maxBatches },
    )

    const durationMs = Date.now() - startedAt

    // Todo trabalho deixa registro. Uma linha por fornecedor: a chave veio do
    // `RETURNING`, entao a FK esta satisfeita por construcao.
    for (const [providerApi, deleted] of result.byProvider) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO api_sync_logs
           (provider_api, endpoint, status, error_code, items_processed, items_created,
            items_updated, duration_ms, quota_cost, payload_hash, created_at)
         VALUES ($1, $2, 'success'::"SyncStatus", NULL, $3, 0, 0, $4, 0, NULL,
                 $5::timestamptz AT TIME ZONE 'UTC')`,
        providerApi,
        ENDPOINT,
        deleted,
        durationMs,
        new Date().toISOString(),
      )
    }

    const after = await prisma.$queryRawUnsafe<{ expired: bigint }[]>(
      COUNT_EXPIRED_SQL,
      new Date().toISOString(),
    )
    const expiredAfter = Number(after[0]?.expired ?? 0n)

    const porFornecedor = [...result.byProvider]
      .map(([provider, count]) => `${provider}=${count}`)
      .join(' ')

    console.log(
      `apagadas=${result.deleted} · lotes=${result.batches} · ` +
        `vencidas antes=${expiredBefore} depois=${expiredAfter} · ` +
        `duracao=${durationMs}ms${porFornecedor === '' ? '' : ` · ${porFornecedor}`}`,
    )

    if (result.hitBatchCeiling) {
      // "Acabou" e "cansei" nao podem sair iguais.
      console.log(
        `TETO DE LOTES atingido (${maxBatches}): ainda restam ${expiredAfter} linha(s) ` +
          'vencida(s). Rode de novo, ou use o runbook para drenar o passivo de uma vez ' +
          '(docs/operations/api-cache-purge.md).',
      )
    }
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error('Expurgo de api_cache abortado:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
