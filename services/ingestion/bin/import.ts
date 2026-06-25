#!/usr/bin/env node
/**
 * bin/import.ts — CLI de import TMDB por ID. EXCLUIDO do typecheck (toca runtime).
 *
 * Worker-only/offline — NUNCA no render. Uso:
 *   tsx services/ingestion/bin/import.ts --movie 27205 --tv 1399 --person 287
 *   tsx services/ingestion/bin/import.ts --seed   # lista curada de dev
 *
 * Requer env (ver .env / .env.example): TMDB_READ_ACCESS_TOKEN (ou TMDB_API_KEY)
 * e DATABASE_URL. Cada import gera log em api_sync_logs.
 */

import {
  DEV_SEED_IDS,
  createIngestionContext,
  importMovie,
  importPerson,
  importTvShow,
} from '../src/composition.js'

interface ParsedArgs {
  movies: number[]
  tvShows: number[]
  people: number[]
  seed: boolean
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { movies: [], tvShows: [], people: [], seed: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--seed') {
      parsed.seed = true
      continue
    }
    const value = argv[i + 1]
    if (flag === '--movie' && value !== undefined) {
      parsed.movies.push(Number(value))
      i += 1
    } else if (flag === '--tv' && value !== undefined) {
      parsed.tvShows.push(Number(value))
      i += 1
    } else if (flag === '--person' && value !== undefined) {
      parsed.people.push(Number(value))
      i += 1
    }
  }
  return parsed
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.seed) {
    args.movies.push(...DEV_SEED_IDS.movies)
    args.tvShows.push(...DEV_SEED_IDS.tvShows)
    args.people.push(...DEV_SEED_IDS.people)
  }

  const { context, disconnect } = createIngestionContext()
  try {
    for (const id of args.movies) {
      console.log(JSON.stringify(await importMovie(context, id)))
    }
    for (const id of args.tvShows) {
      console.log(JSON.stringify(await importTvShow(context, id)))
    }
    for (const id of args.people) {
      console.log(JSON.stringify(await importPerson(context, id)))
    }
  } finally {
    await disconnect()
  }
}

main().catch((error: unknown) => {
  console.error('Falha no import TMDB:', error)
  process.exitCode = 1
})
