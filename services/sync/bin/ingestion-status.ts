#!/usr/bin/env node
/**
 * bin/ingestion-status.ts — O painel, em texto, para quem esta no terminal.
 *
 * READ-ONLY, sem rede: le `api_sync_logs` (ultimo sucesso e cota gasta hoje) e
 * os artefatos das filas derivadas. Nao enfileira, nao chama fornecedor, nao
 * escreve.
 *
 * O painel HTML (`/status` do agendador) e a via principal — este comando existe
 * para quem ja esta no terminal e para diagnostico quando o servico esta fora do
 * ar: sem o agendador de pe, `/status` nao responde, e e exatamente ai que
 * alguem precisa ver desde quando cada fila parou.
 *
 * `--json` para maquina; sem flag, texto.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'
import { ON_DEMAND_RESERVE, resolveProviderQuota } from '@screena/config'

import {
  buildStatusReport,
  detectStalledQueues,
  evaluateSchedule,
  renderStatusText,
  type QuotaSnapshot,
} from '../src/scheduler/index.js'
import { readLastRuns, readSpentToday } from '../src/scheduler/runtime/facts.js'

function loadRepoEnv(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.resolve(dir, '..', '..', '..', '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

const QUOTA_PROVIDERS = ['omdb', 'tmdb'] as const

async function main(): Promise<number> {
  loadRepoEnv()
  const asJson = process.argv.slice(2).includes('--json')

  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    process.stderr.write('DATABASE_URL ausente — nada a ler.\n')
    return 1
  }

  const prisma = getPrismaClient()
  try {
    const now = new Date()
    const lastRuns = await readLastRuns(prisma)
    const schedules = evaluateSchedule({ now, lastRuns })

    // `startedAt = now` de proposito: fora do servico nao existe uptime, e a
    // carencia de `never_ran` e sobre O PROCESSO. Aqui ela nao se aplica — uma
    // fila que nunca rodou aparece como "NUNCA RODOU" na tabela, sem virar
    // alerta de processo. Alerta de fila PARADA continua saindo normalmente.
    const alerts = detectStalledQueues(schedules, { now, startedAt: now })

    const quotas: QuotaSnapshot[] = []
    for (const providerApi of QUOTA_PROVIDERS) {
      const quota = resolveProviderQuota(providerApi)
      if (quota === null) continue
      quotas.push({
        providerApi,
        dailyLimit: quota.perDay,
        spentToday: await readSpentToday(prisma, providerApi, now),
        reservedForReader: providerApi === 'omdb' ? ON_DEMAND_RESERVE : 0,
        basis: quota.basis,
      })
    }

    const report = buildStatusReport({
      now,
      startedAt: now,
      schedules,
      alerts,
      quotas,
      workerId: 'cli',
    })

    process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${renderStatusText(report)}\n`)
    // Codigo 0 mesmo com fila parada: este comando RELATA, nao julga. Fazer o
    // exit code depender do estado transformaria um relatorio em gate de CI por
    // acidente.
    return 0
  } finally {
    await disconnectPrisma().catch(() => undefined)
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`Falha ao ler o estado da ingestao: ${String(error)}\n`)
    process.exit(1)
  })
