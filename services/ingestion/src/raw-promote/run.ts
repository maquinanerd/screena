/**
 * run.ts — Orquestracao PURA da promocao de filme `tmdb_raw` -> tabelas tipadas
 * (P0-00f.1). Sem rede, sem DB: opera sobre as portas `RawMovieSource`,
 * `EntityStorePort` e `CatalogFinalizePort`, testavel com fakes.
 *
 * Por filme (apply): normaliza o payload bruto -> upsert idempotente (movies +
 * imagens + external_ids + cast/crew, via o store de sempre) -> slug canonico
 * pt-BR + traducao (via o finalize, mesma logica do backfill). Falha de um item
 * vira `failed` e NUNCA aborta o lote (retomavel — upsert idempotente).
 *
 * Dry-run: NAO le payloads nem escreve — so CONTA quantos filmes existem em
 * `tmdb_raw` e quantos caberiam no limite. Idempotencia de re-run: os upserts
 * (movie/slug/traducao) sao por chave natural, entao rodar de novo reconverge
 * (2a execucao vira `updated`, mesmo estado final).
 *
 * SEQUENCIAL de proposito (sem pool): o slug faz resolucao de colisao lendo/
 * escrevendo `slugs`; serializar evita corrida entre dois filmes de slug-base
 * igual. O piloto e pequeno; simplicidade > paralelismo aqui.
 */

import type { TmdbMovieDetail } from '@screena/tmdb-client'
import { normalizeMovie } from '../normalizers/movie.js'
import type { EntityStorePort } from '../ports.js'
import { desiredCatalogSlug } from '../public-catalog-slug.js'
import type {
  CatalogFinalizePort,
  PromoteCounts,
  PromoteOutcome,
  PromoteReport,
  RawMovieRow,
  RawMovieSource,
} from './types.js'

/** Teto de ids gravados em `failedIds` (amostra p/ relatorio; total fica em counts). */
const MAX_FAILED_SAMPLE = 50

/** Opcoes de uma execucao de promocao de filmes. */
export interface PromoteMoviesOptions {
  readonly source: RawMovieSource
  readonly store: EntityStorePort
  readonly finalize: CatalogFinalizePort
  readonly baseLanguage: string
  /** Teto de filmes desta execucao. */
  readonly limit: number
  /** Relogio injetavel (determinista em teste; so p/ durationMs). */
  readonly now: () => Date
  /** true = plano (nao le payload nem escreve); false = promove de fato. */
  readonly dryRun: boolean
  /** Observabilidade por item. */
  readonly onItem?: (tmdbId: number, outcome: PromoteOutcome) => void
}

/**
 * Campos de EXIBICAO lidos do payload bruto (pt-BR), defensivamente: titulo
 * (localizado, com fallback ao original), sinopse e ano. PURO. Sao usados no
 * slug/traducao — a nota factual (ficha) vem de `normalizeMovie`, nunca daqui.
 */
export function readMovieDisplayFields(payload: unknown): {
  title: string
  overview: string | null
  year: number | null
} {
  const obj =
    payload !== null && typeof payload === 'object'
      ? (payload as {
          title?: unknown
          original_title?: unknown
          overview?: unknown
          release_date?: unknown
        })
      : {}
  const title =
    (typeof obj.title === 'string' && obj.title.trim() !== '' ? obj.title : null) ??
    (typeof obj.original_title === 'string' ? obj.original_title : '')
  const overview = typeof obj.overview === 'string' && obj.overview !== '' ? obj.overview : null
  const year = yearFrom(typeof obj.release_date === 'string' ? obj.release_date : null)
  return { title, overview, year }
}

/** Ano (>0) a partir de uma data `YYYY-...`; senao null. PURO. */
function yearFrom(dateStr: string | null): number | null {
  if (dateStr === null) return null
  const year = Number(dateStr.slice(0, 4))
  return Number.isInteger(year) && year > 0 ? year : null
}

function emptyCounts(): PromoteCounts {
  return { created: 0, updated: 0, failed: 0 }
}

/** Promove UM filme (apply): normaliza -> upsert -> slug + traducao. */
async function promoteOne(
  row: RawMovieRow,
  options: PromoteMoviesOptions,
  counts: PromoteCounts,
  failedIds: number[],
): Promise<void> {
  try {
    const normalized = normalizeMovie(row.payload as TmdbMovieDetail)
    // Frescor herdada do raw: o tipado e tao fresco quanto o payload coletado.
    const timestamps = { lastSyncedAt: row.fetchedAt, staleAfter: null }
    const outcome = await options.store.upsertMovie({
      movie: normalized.movie,
      externalIds: normalized.externalIds,
      cast: normalized.cast,
      crew: normalized.crew,
      timestamps,
    })

    const display = readMovieDisplayFields(row.payload)
    const slugTitle = display.title !== '' ? display.title : normalized.movie.titleOriginal
    const desiredSlug = desiredCatalogSlug(slugTitle, display.year, row.tmdbId)
    await options.finalize.upsertCanonicalSlug('movie', outcome.id, desiredSlug, row.tmdbId)
    await options.finalize.upsertTranslation('movie', outcome.id, slugTitle, display.overview)

    if (outcome.created) counts.created += 1
    else counts.updated += 1
    options.onItem?.(row.tmdbId, outcome.created ? 'created' : 'updated')
  } catch {
    counts.failed += 1
    if (failedIds.length < MAX_FAILED_SAMPLE) failedIds.push(row.tmdbId)
    options.onItem?.(row.tmdbId, 'failed')
  }
}

/** Roda a promocao de filmes e devolve o `PromoteReport`. */
export async function promoteMoviesFromRaw(
  options: PromoteMoviesOptions,
): Promise<PromoteReport> {
  const startedMs = options.now().getTime()
  const counts = emptyCounts()
  const failedIds: number[] = []
  const available = await options.source.countMovies()

  let selected: number
  if (options.dryRun) {
    selected = Math.min(available, Math.max(0, options.limit))
    for (let i = 0; i < selected; i += 1) options.onItem?.(0, 'planned')
  } else {
    const rows = await options.source.listMoviePayloads(options.limit)
    selected = rows.length
    for (const row of rows) {
      await promoteOne(row, options, counts, failedIds)
    }
  }

  const durationMs = Math.max(0, options.now().getTime() - startedMs)
  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    baseLanguage: options.baseLanguage,
    limit: options.limit,
    available,
    selected,
    counts,
    failedIds,
    durationMs,
  }
}
