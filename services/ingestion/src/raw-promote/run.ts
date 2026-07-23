/**
 * run.ts — Orquestracao PURA e GENERICA da promocao `tmdb_raw` -> tabelas
 * tipadas (P0-00f). Sem rede, sem DB: opera sobre as portas `RawEntitySource`,
 * `CatalogFinalizePort` e uma `PromoteStrategy`, testavel com fakes.
 *
 * `promoteFromRaw(options, strategy)` e o core unico: por item (apply) chama
 * `strategy.promote` (normaliza o payload bruto + upsert tipado idempotente via o
 * store de sempre) e depois grava slug canonico pt-BR + traducao (via o finalize,
 * mesma logica do backfill). Falha de um item vira `failed` e NUNCA aborta o lote
 * (retomavel — upsert idempotente). Dry-run: NAO le payloads nem escreve — so
 * CONTA. Idempotencia de re-run: os upserts sao por chave natural (2a execucao
 * vira `updated`, mesmo estado final).
 *
 * SEQUENCIAL de proposito (sem pool): o slug faz resolucao de colisao lendo/
 * escrevendo `slugs`; serializar evita corrida entre duas entidades de slug-base
 * igual. O piloto e pequeno; simplicidade > paralelismo aqui.
 *
 * `movie` (f.1) e `tv` (f.2) sao estrategias finas; a orquestracao e uma so.
 * season/episode NUNCA sao criados aqui (o normalizer de serie devolve
 * `seasonNumbers`, mas a promocao os IGNORA — sao outro bloco).
 */

import type { TmdbMovieDetail, TmdbPersonDetail, TmdbTvDetail } from '@screena/tmdb-client'
import { normalizeMovie } from '../normalizers/movie.js'
import { normalizePerson } from '../normalizers/person.js'
import { normalizeTvShow } from '../normalizers/tv.js'
import type { EntityStorePort } from '../ports.js'
import { desiredCatalogSlug } from '../public-catalog-slug.js'
import type {
  CatalogFinalizePort,
  PromoteCounts,
  PromoteOutcome,
  PromoteReport,
  PromoteStrategy,
  RawEntityRow,
  RawEntitySource,
  RawMovieSource,
  RawPersonSource,
  RawTvSource,
} from './types.js'

/** Teto de ids gravados em `failedIds` (amostra p/ relatorio; total fica em counts). */
const MAX_FAILED_SAMPLE = 50

/** Opcoes do core generico de promocao. */
export interface PromoteFromRawOptions {
  readonly source: RawEntitySource
  readonly finalize: CatalogFinalizePort
  readonly baseLanguage: string
  /** Teto de entidades desta execucao. */
  readonly limit: number
  /** Relogio injetavel (determinista em teste; so p/ durationMs). */
  readonly now: () => Date
  /** true = plano (nao le payload nem escreve); false = promove de fato. */
  readonly dryRun: boolean
  /** Observabilidade por item. */
  readonly onItem?: (tmdbId: number, outcome: PromoteOutcome) => void
}

/**
 * Leitores de campos de EXIBICAO: REEXPORTADOS do modulo puro compartilhado
 * `../display-fields.js`.
 *
 * Eles moravam AQUI — e por isso so a promocao de `tmdb_raw` criava slug e
 * traducao. O import direto de detalhe (job `sync_details` da fila duravel)
 * nao alcancava esta regra sem arrastar junto toda a orquestracao de promocao,
 * e entidade sem slug nao tem rota publica, nao entra na busca e nao entra no
 * sitemap. A regra virou modulo comum; a reexportacao preserva o contrato
 * publico deste arquivo e os testes que ja importavam daqui.
 */
import {
  readMovieDisplayFields,
  readTvDisplayFields,
  readPersonDisplayFields,
} from '../display-fields.js'

export { readMovieDisplayFields, readTvDisplayFields, readPersonDisplayFields }

/** Estrategia de FILME: normalizeMovie -> upsertMovie -> exibicao (P0-00f.1). */
export function createMovieStrategy(store: EntityStorePort): PromoteStrategy {
  return {
    entityType: 'movie',
    async promote(row) {
      const normalized = normalizeMovie(row.payload as TmdbMovieDetail)
      const outcome = await store.upsertMovie({
        movie: normalized.movie,
        externalIds: normalized.externalIds,
        cast: normalized.cast,
        crew: normalized.crew,
        // Frescor herdada do raw: o tipado e tao fresco quanto o payload coletado.
        timestamps: { lastSyncedAt: row.fetchedAt, staleAfter: null },
      })
      const d = readMovieDisplayFields(row.payload)
      const title = d.title !== '' ? d.title : normalized.movie.titleOriginal
      return { outcome, display: { title, overview: d.overview } }
    },
  }
}

/**
 * Estrategia de SERIE: normalizeTvShow -> upsertTvShow -> exibicao (P0-00f.2).
 * `normalized.seasonNumbers` e IGNORADO — season/episode nao sao promovidos.
 */
export function createTvStrategy(store: EntityStorePort): PromoteStrategy {
  return {
    entityType: 'tv',
    async promote(row) {
      const normalized = normalizeTvShow(row.payload as TmdbTvDetail)
      const outcome = await store.upsertTvShow({
        tvShow: normalized.tvShow,
        externalIds: normalized.externalIds,
        cast: normalized.cast,
        crew: normalized.crew,
        timestamps: { lastSyncedAt: row.fetchedAt, staleAfter: null },
      })
      const d = readTvDisplayFields(row.payload)
      const title = d.title !== '' ? d.title : normalized.tvShow.nameOriginal
      return { outcome, display: { title, overview: d.overview } }
    },
  }
}

/**
 * Estrategia de PESSOA: normalizePerson -> upsertPerson -> exibicao (P0-00f.3).
 * Sem cast/crew (normalizePerson nao tem), sem bio, sem filmografia: so a ficha
 * da pessoa + external_ids + slug + traducao (title=name). A filmografia
 * (cast_members/crew_members) ja vem da promocao de movie/tv, nao daqui.
 */
export function createPersonStrategy(store: EntityStorePort): PromoteStrategy {
  return {
    entityType: 'person',
    async promote(row) {
      const normalized = normalizePerson(row.payload as TmdbPersonDetail)
      const outcome = await store.upsertPerson({
        person: normalized.person,
        externalIds: normalized.externalIds,
        lastSyncedAt: row.fetchedAt,
      })
      const d = readPersonDisplayFields(row.payload)
      const title = d.title !== '' ? d.title : normalized.person.name
      return { outcome, display: { title, overview: d.overview } }
    },
  }
}

function emptyCounts(): PromoteCounts {
  return { created: 0, updated: 0, failed: 0 }
}

/** Promove UM registro (apply): strategy.promote -> slug + traducao. */
async function promoteOne(
  row: RawEntityRow,
  options: PromoteFromRawOptions,
  strategy: PromoteStrategy,
  counts: PromoteCounts,
  failedIds: number[],
): Promise<void> {
  try {
    const { outcome, display } = await strategy.promote(row)
    const desiredSlug = desiredCatalogSlug(display.title, row.tmdbId)
    await options.finalize.upsertCanonicalSlug(strategy.entityType, outcome.id, desiredSlug, row.tmdbId)
    await options.finalize.upsertTranslation(strategy.entityType, outcome.id, display.title, display.overview)

    if (outcome.created) counts.created += 1
    else counts.updated += 1
    options.onItem?.(row.tmdbId, outcome.created ? 'created' : 'updated')
  } catch {
    counts.failed += 1
    if (failedIds.length < MAX_FAILED_SAMPLE) failedIds.push(row.tmdbId)
    options.onItem?.(row.tmdbId, 'failed')
  }
}

/** Core GENERICO: roda a promocao de uma entidade (via `strategy`) e reporta. */
export async function promoteFromRaw(
  options: PromoteFromRawOptions,
  strategy: PromoteStrategy,
): Promise<PromoteReport> {
  const startedMs = options.now().getTime()
  const counts = emptyCounts()
  const failedIds: number[] = []
  const available = await options.source.count()

  let selected: number
  if (options.dryRun) {
    selected = Math.min(available, Math.max(0, options.limit))
    for (let i = 0; i < selected; i += 1) options.onItem?.(0, 'planned')
  } else {
    const rows = await options.source.list(options.limit)
    selected = rows.length
    for (const row of rows) {
      await promoteOne(row, options, strategy, counts, failedIds)
    }
  }

  const durationMs = Math.max(0, options.now().getTime() - startedMs)
  return {
    mode: options.dryRun ? 'dry-run' : 'apply',
    entityType: strategy.entityType,
    baseLanguage: options.baseLanguage,
    limit: options.limit,
    available,
    selected,
    counts,
    failedIds,
    durationMs,
  }
}

/** Opcoes de uma execucao de promocao de FILMES (wrapper fino; P0-00f.1). */
export interface PromoteMoviesOptions {
  readonly source: RawMovieSource
  readonly store: EntityStorePort
  readonly finalize: CatalogFinalizePort
  readonly baseLanguage: string
  readonly limit: number
  readonly now: () => Date
  readonly dryRun: boolean
  readonly onItem?: (tmdbId: number, outcome: PromoteOutcome) => void
}

/** Opcoes de uma execucao de promocao de SERIES (wrapper fino; P0-00f.2). */
export interface PromoteTvShowsOptions {
  readonly source: RawTvSource
  readonly store: EntityStorePort
  readonly finalize: CatalogFinalizePort
  readonly baseLanguage: string
  readonly limit: number
  readonly now: () => Date
  readonly dryRun: boolean
  readonly onItem?: (tmdbId: number, outcome: PromoteOutcome) => void
}

/** Opcoes de uma execucao de promocao de PESSOAS (wrapper fino; P0-00f.3). */
export interface PromotePeopleOptions {
  readonly source: RawPersonSource
  readonly store: EntityStorePort
  readonly finalize: CatalogFinalizePort
  readonly baseLanguage: string
  readonly limit: number
  readonly now: () => Date
  readonly dryRun: boolean
  readonly onItem?: (tmdbId: number, outcome: PromoteOutcome) => void
}

function coreOptions(
  options: PromoteMoviesOptions | PromoteTvShowsOptions | PromotePeopleOptions,
  source: RawEntitySource,
): PromoteFromRawOptions {
  return {
    source,
    finalize: options.finalize,
    baseLanguage: options.baseLanguage,
    limit: options.limit,
    now: options.now,
    dryRun: options.dryRun,
    onItem: options.onItem,
  }
}

/** Promove filmes do `tmdb_raw` (wrapper fino sobre `promoteFromRaw`). */
export function promoteMoviesFromRaw(options: PromoteMoviesOptions): Promise<PromoteReport> {
  const source: RawEntitySource = {
    count: () => options.source.countMovies(),
    list: (limit) => options.source.listMoviePayloads(limit),
  }
  return promoteFromRaw(coreOptions(options, source), createMovieStrategy(options.store))
}

/** Promove series do `tmdb_raw` (wrapper fino sobre `promoteFromRaw`). */
export function promoteTvShowsFromRaw(options: PromoteTvShowsOptions): Promise<PromoteReport> {
  const source: RawEntitySource = {
    count: () => options.source.countTvShows(),
    list: (limit) => options.source.listTvShowPayloads(limit),
  }
  return promoteFromRaw(coreOptions(options, source), createTvStrategy(options.store))
}

/** Promove pessoas do `tmdb_raw` (wrapper fino sobre `promoteFromRaw`). */
export function promotePeopleFromRaw(options: PromotePeopleOptions): Promise<PromoteReport> {
  const source: RawEntitySource = {
    count: () => options.source.countPeople(),
    list: (limit) => options.source.listPersonPayloads(limit),
  }
  return promoteFromRaw(coreOptions(options, source), createPersonStrategy(options.store))
}
