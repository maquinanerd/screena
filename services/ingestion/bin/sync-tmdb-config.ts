/**
 * sync-tmdb-config.ts — CLI offline do sync de TAXONOMIA/CONFIGURACAO do TMDB
 * (Fase 6). Worker-only; NUNCA no render. EXCLUIDO do typecheck (toca Prisma).
 *
 * Captura o payload BRUTO de 8 endpoints de taxonomia em `api_cache`, loga cada
 * ciclo em `api_sync_logs` e normaliza `/configuration` em `tmdb_image_config`.
 *
 * Fail-closed: modo dry-run por padrao (zero rede/escrita). `--apply` exige token
 * TMDB (env) + `DATABASE_URL` e aborta em producao.
 *
 * Uso:
 *   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb-config.ts            # dry-run
 *   corepack pnpm --filter @screena/ingestion exec tsx bin/sync-tmdb-config.ts --apply    # aplica
 */

import process from 'node:process'
import { PrismaClient } from '@prisma/client'
import { createTmdbClient, createTmdbCatalogEndpoints } from '@screena/tmdb-client'

import { createPrismaCache } from '../src/persistence/cache.js'
import { createPrismaSyncLog } from '../src/persistence/sync-log.js'
import { createPrismaImageConfigStore } from '../src/persistence/image-config-store.js'
import { TAXONOMY_ENDPOINTS, runTaxonomySync, type TaxonomyReadPort } from '../src/config-sync/run.js'

function isProductionLike(): boolean {
  const env = `${process.env.NODE_ENV ?? ''} ${process.env.VERCEL_ENV ?? ''}`.toLowerCase()
  return env.includes('production')
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')

  console.log('=== TMDB taxonomy/config sync (Fase 6) ===')
  console.log(`Endpoints (${TAXONOMY_ENDPOINTS.length}):`)
  for (const spec of TAXONOMY_ENDPOINTS) console.log(`  - ${spec.endpoint}`)

  if (!apply) {
    console.log('\nDRY-RUN (default): nenhuma chamada externa, nenhuma escrita. Use --apply para aplicar.')
    return
  }

  if (isProductionLike()) {
    console.error('\nABORTADO: --apply e proibido em ambiente production-like (NODE_ENV/VERCEL_ENV).')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error('\nABORTADO: DATABASE_URL ausente (necessario para --apply).')
    process.exit(1)
  }

  // loadTmdbConfig (via createTmdbClient) lanca se nao houver token TMDB.
  const client = createTmdbClient()
  const catalog = createTmdbCatalogEndpoints(client.http, client.config)
  const read: TaxonomyReadPort = catalog

  const prisma = new PrismaClient()
  try {
    const cache = createPrismaCache(prisma, { ttlMs: client.config.cacheTtlMs, now: () => new Date() })
    const log = createPrismaSyncLog(prisma)
    const imageConfigStore = createPrismaImageConfigStore(prisma)

    const summary = await runTaxonomySync({ read, cache, log, imageConfigStore, now: () => new Date() })

    console.log('\n--- Resultado ---')
    for (const e of summary.endpoints) {
      console.log(`  ${e.status.padEnd(8)} ${e.endpoint} (changed=${e.changed}, fromCache=${e.fromCache})`)
    }
    console.log(
      `\ntmdb_image_config: normalized=${summary.imageConfig.normalized}, created=${summary.imageConfig.created}, changed=${summary.imageConfig.changed}`,
    )
    const failed = summary.endpoints.filter((e) => e.status === 'failed')
    if (failed.length > 0) {
      console.error(`\n${failed.length} endpoint(s) falharam.`)
      process.exit(1)
    }
    console.log('\nOK.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
