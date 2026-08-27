/**
 * media-sync.ts — Orquestracao PURA do sync de MIDIA (imagens/videos) de UMA
 * entidade TMDB (Fase 7). Port-based, testavel com fakes.
 *
 * Para cada alvo: captura o payload BRUTO de /images (e /videos, quando aplicavel)
 * em api_cache, loga o ciclo, normaliza os metadados e faz upsert IDEMPOTENTE em
 * tmdb_images/tmdb_videos (nascem display_allowed=false). So metadados; nenhum
 * binario baixado; nenhuma publicacao automatica.
 */

import type { CachePort, SyncLogPort, SyncStatus } from '../ports.js'
import { normalizeImages, normalizeVideos, type ImageRow, type VideoRow } from './media-normalize.js'

/** Resultado de um upsert em lote (idempotente). */
export interface MediaUpsertOutcome {
  readonly created: number
  readonly updated: number
  readonly unchanged: number
}

/** Porta de persistencia de midia (tmdb_images / tmdb_videos). */
export interface MediaStorePort {
  upsertImages(rows: ImageRow[]): Promise<MediaUpsertOutcome>
  upsertVideos(rows: VideoRow[]): Promise<MediaUpsertOutcome>
}

/** Alvo de sync: uma entidade + fetchers do payload de midia. */
export interface MediaTarget {
  readonly entityType: string
  /**
   * Id que vai na CHAVE de `tmdb_images`/`tmdb_videos` — o id PROPRIO da
   * entidade dona da midia.
   *
   * Para filme/serie/pessoa e o mesmo id que aparece na URL. Para temporada e
   * episodio NAO e: a URL do TMDB endereca pela serie + numero
   * (`/tv/97546/season/2/images`), enquanto a chave usa `seasons.tmdb_id` /
   * `episodes.tmdb_id`. Confundir os dois faria todas as temporadas de uma
   * serie colidirem numa linha so — foi exatamente por prever essa colisao (e
   * nao separar os dois papeis) que `sync_media` recusou temporada e episodio
   * ate 2026-08-27.
   */
  readonly tmdbId: number
  /**
   * Caminho REAL do recurso no TMDB, SEM o sufixo `/images` ou `/videos`.
   *
   * E a chave de `api_cache` e o `endpoint` de `api_sync_logs`. Ate 2026-08-27
   * era derivado como `/${entityType}/${tmdbId}`, o que so por coincidencia
   * batia com a URL chamada — para temporada produziria `/season/119051/images`,
   * um caminho que nao existe no TMDB, e o log passaria a mentir sobre o que
   * foi requisitado.
   */
  readonly endpointBase: string
  readonly fetchImages: () => Promise<unknown>
  /** Ausente para pessoas (sem endpoint de videos). */
  readonly fetchVideos?: () => Promise<unknown>
}

/** Dependencias do sync de midia. */
export interface MediaSyncDeps {
  readonly cache: CachePort
  readonly log: SyncLogPort
  readonly store: MediaStorePort
  readonly now: () => Date
}

/** Resultado por tipo de midia. */
export interface MediaKindResult {
  readonly captured: boolean
  readonly changed: boolean
  readonly rows: number
  readonly created: number
  readonly updated: number
  readonly unchanged: number
  readonly status: SyncStatus
}

/** Resultado do sync de midia de uma entidade. */
export interface MediaSyncResult {
  readonly entityType: string
  readonly tmdbId: number
  readonly images: MediaKindResult
  readonly videos: MediaKindResult | null
}

const EMPTY: MediaKindResult = {
  captured: false, changed: false, rows: 0, created: 0, updated: 0, unchanged: 0, status: 'empty',
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && typeof err.name === 'string') return err.name
  return 'error'
}

/** Executa o sync de midia de UMA entidade. Nao lanca: falhas viram log `failed`. */
export async function runMediaSync(target: MediaTarget, deps: MediaSyncDeps): Promise<MediaSyncResult> {
  const images = await syncKind(
    `${target.endpointBase}/images`,
    target.fetchImages,
    (data) => normalizeImages(target.entityType, target.tmdbId, data as never),
    (rows) => deps.store.upsertImages(rows as ImageRow[]),
    deps,
  )

  let videos: MediaKindResult | null = null
  if (target.fetchVideos) {
    videos = await syncKind(
      `${target.endpointBase}/videos`,
      target.fetchVideos,
      (data) => normalizeVideos(target.entityType, target.tmdbId, data as never),
      (rows) => deps.store.upsertVideos(rows as VideoRow[]),
      deps,
    )
  }

  return { entityType: target.entityType, tmdbId: target.tmdbId, images, videos }
}

async function syncKind<TRow>(
  endpoint: string,
  fetcher: () => Promise<unknown>,
  normalize: (data: unknown) => TRow[],
  upsert: (rows: TRow[]) => Promise<MediaUpsertOutcome>,
  deps: MediaSyncDeps,
): Promise<MediaKindResult> {
  let changed = false
  let payloadHash: string | null = null
  let data: unknown
  try {
    const result = await deps.cache.getOrFetch<unknown>({ endpoint, fetcher })
    data = result.data
    changed = result.changed
    payloadHash = result.payloadHash
  } catch (err) {
    await deps.log.write({ endpoint, status: 'failed', errorCode: errorCode(err) })
    return { ...EMPTY, status: 'failed' }
  }

  const rows = normalize(data)
  const outcome = rows.length > 0 ? await upsert(rows) : { created: 0, updated: 0, unchanged: 0 }
  const status: SyncStatus = rows.length === 0 ? 'empty' : 'success'

  await deps.log.write({
    endpoint,
    status,
    itemsProcessed: rows.length,
    itemsCreated: outcome.created,
    itemsUpdated: outcome.updated,
    payloadHash,
  })

  return {
    captured: true,
    changed,
    rows: rows.length,
    created: outcome.created,
    updated: outcome.updated,
    unchanged: outcome.unchanged,
    status,
  }
}
