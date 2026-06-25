#!/usr/bin/env node
/**
 * bin/run.ts — Runner de refresh por frescor (stale). EXCLUIDO do typecheck.
 *
 * Worker-only/offline — NUNCA no render. Seleciona entidades stale
 * (`stale_after IS NULL` ou ja vencido) e reimporta via a ingestao, reusando
 * cache/log/upsert idempotente. Em producao, disparado por systemd timer.
 *
 * Uso: tsx services/sync/bin/run.ts [limite]
 */

import { getPrismaClient } from '@screena/db/server'
import { createIngestionContext, importMovie, importTvShow } from '@screena/ingestion/runtime'

const DEFAULT_LIMIT = 50

async function main(): Promise<void> {
  const limitArg = Number(process.argv[2])
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : DEFAULT_LIMIT
  const now = new Date()
  const prisma = getPrismaClient()
  const { context, disconnect } = createIngestionContext()

  const staleWhere = { OR: [{ staleAfter: null }, { staleAfter: { lt: now } }] }

  try {
    const movies = await prisma.movie.findMany({
      where: staleWhere,
      select: { tmdbId: true },
      orderBy: { staleAfter: 'asc' },
      take: limit,
    })
    for (const movie of movies) {
      console.log(JSON.stringify(await importMovie(context, movie.tmdbId)))
    }

    const shows = await prisma.tvShow.findMany({
      where: staleWhere,
      select: { tmdbId: true },
      orderBy: { staleAfter: 'asc' },
      take: limit,
    })
    for (const show of shows) {
      console.log(JSON.stringify(await importTvShow(context, show.tmdbId)))
    }
  } finally {
    await disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Falha no runner de sync:', error)
  process.exitCode = 1
})
