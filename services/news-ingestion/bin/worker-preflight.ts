/**
 * worker-preflight.ts — Verificacao PRE-DEPLOY do worker de projecao.
 * SOMENTE LEITURA.
 *
 * NAO consome evento da outbox, NAO escreve no banco publico, NAO aplica
 * migration. O `claim` usado para provar a credencial pede lote ZERO: prova
 * autenticacao e escopo sem tirar um unico evento da fila.
 *
 * Uso:
 *   pnpm --filter @screena/news-ingestion publication-worker:preflight
 */

import process from 'node:process'

import { PrismaClient } from '@screena/db/server'

import { createLocalMediaStorage } from '../src/media/local-storage.js'
import { createS3MediaStorage } from '../src/media/s3-storage.js'
import { resolveMediaStorageConfig } from '../src/media/storage-config.js'
import type { MediaStoragePort } from '../src/media/storage-port.js'
import { collectWorkerReadiness } from '../src/persistence/worker-readiness.js'
import { resolveProjectionWorkerConfig } from '../src/projection-worker-config.js'

type Verdict = 'OK' | 'WARNING' | 'BLOCKED'

const results: { verdict: Verdict; name: string; detail: string }[] = []

function record(verdict: Verdict, name: string, detail: string): void {
  results.push({ verdict, name, detail })
  console.log(`[${verdict}] ${name} — ${detail}`)
}

async function main(): Promise<void> {
  const env = process.env
  console.log('=== preflight do worker de projecao (somente leitura) ===')

  const configResult = resolveProjectionWorkerConfig(env)
  record(
    configResult.ok ? 'OK' : 'BLOCKED',
    'configuracao do worker',
    // So os NOMES das variaveis: nenhuma credencial atravessa para o log.
    configResult.ok ? 'valida' : configResult.errors.join('; '),
  )

  const storageResult = resolveMediaStorageConfig(env)
  record(
    storageResult.ok ? 'OK' : 'BLOCKED',
    'storage publico',
    storageResult.ok ? `driver ${storageResult.config.driver}` : storageResult.errors.join('; '),
  )

  // Os dois storages sao papeis DIFERENTES e nao podem compartilhar prefixo: o
  // worker apagaria original do CMS achando que era derivada publica.
  const uploadPrefix = (env.PAYLOAD_UPLOAD_S3_PREFIX ?? '').trim()
  const publicBase = (env.EDITORIAL_MEDIA_PUBLIC_BASE_PATH ?? '/media').trim()
  if (uploadPrefix !== '' && publicBase.replace(/^\//, '').startsWith(uploadPrefix)) {
    record('BLOCKED', 'separacao de storages', 'prefixo de upload colide com o publico')
  } else {
    record('OK', 'separacao de storages', 'prefixos distintos')
  }

  if (!configResult.ok || !storageResult.ok) {
    console.log('\nRESUMO: configuracao invalida; checagens de rede e banco nao executadas.')
    process.exit(1)
  }

  const storage: MediaStoragePort =
    storageResult.config.driver === 'local'
      ? createLocalMediaStorage(storageResult.config)
      : createS3MediaStorage(storageResult.config)

  const prisma = new PrismaClient({ datasourceUrl: configResult.config.screenDatabaseUrl })
  try {
    const report = await collectWorkerReadiness({ prisma, storage, env })
    for (const check of report.checks) {
      if (check.name === 'config') continue
      record(
        check.status === 'ok' ? 'OK' : check.status === 'warning' ? 'WARNING' : 'BLOCKED',
        `readiness: ${check.name}`,
        check.detail,
      )
    }
  } finally {
    await prisma.$disconnect()
  }

  const blocked = results.filter((result) => result.verdict === 'BLOCKED')
  const warnings = results.filter((result) => result.verdict === 'WARNING')
  console.log(
    `\nRESUMO: ${String(results.length - blocked.length - warnings.length)} OK, ` +
      `${String(warnings.length)} WARNING, ${String(blocked.length)} BLOCKED.`,
  )
  if (blocked.length > 0) {
    console.error('BLOQUEIOS:', blocked.map((result) => result.name).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: o worker pode subir com esta configuracao.')
}

main().catch((error: unknown) => {
  console.error('[preflight] erro fatal:', error instanceof Error ? error.name : 'desconhecido')
  process.exit(1)
})
