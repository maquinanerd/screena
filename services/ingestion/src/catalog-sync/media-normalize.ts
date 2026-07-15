/**
 * media-normalize.ts — Normalizacao PURA de metadados de imagens/videos do TMDB
 * (Fase 7). So METADADOS (nenhum binario). Testavel sem rede/DB.
 *
 * As linhas resultantes alimentam tmdb_images/tmdb_videos, que nascem
 * display_allowed=false + license_status=unknown (invariante 6) — a exibicao e
 * decisao humana posterior, fora deste normalizador.
 */

import { hashPayload } from '../utils/hash.js'
import type {
  TmdbImageItem,
  TmdbImagesResponse,
  TmdbVideoItem,
  TmdbVideosResponse,
} from '@screena/tmdb-client'

/** Linha normalizada de tmdb_images. */
export interface ImageRow {
  readonly entityType: string
  readonly tmdbId: number
  readonly imageType: string
  readonly filePath: string
  readonly languageCode: string | null
  readonly width: number | null
  readonly height: number | null
  readonly aspectRatio: number | null
  readonly voteAverage: number | null
  readonly voteCount: number | null
  readonly payloadHash: string
}

/** Linha normalizada de tmdb_videos. */
export interface VideoRow {
  readonly entityType: string
  readonly tmdbId: number
  readonly tmdbVideoId: string
  readonly site: string
  readonly videoKey: string
  readonly name: string | null
  readonly videoType: string | null
  readonly official: boolean | null
  readonly languageCode: string | null
  readonly countryCode: string | null
  readonly size: number | null
  readonly publishedAt: Date | null
  readonly payloadHash: string
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function imageRow(entityType: string, tmdbId: number, imageType: string, item: TmdbImageItem): ImageRow | null {
  const filePath = str(item.file_path)
  if (filePath === null) return null
  return {
    entityType,
    tmdbId,
    imageType,
    filePath,
    languageCode: str(item.iso_639_1),
    width: num(item.width),
    height: num(item.height),
    aspectRatio: num(item.aspect_ratio),
    voteAverage: num(item.vote_average),
    voteCount: num(item.vote_count),
    payloadHash: hashPayload({ imageType, ...item }),
  }
}

/**
 * Normaliza a resposta de `/images` em linhas de imagem (todos os buckets).
 * Itens sem `file_path` sao descartados (nao inventa caminho).
 */
export function normalizeImages(
  entityType: string,
  tmdbId: number,
  response: TmdbImagesResponse | null | undefined,
): ImageRow[] {
  if (response == null || typeof response !== 'object') return []
  const buckets: Array<[string, TmdbImageItem[] | undefined]> = [
    ['poster', response.posters],
    ['backdrop', response.backdrops],
    ['logo', response.logos],
    ['profile', response.profiles],
    ['still', response.stills],
  ]
  const rows: ImageRow[] = []
  for (const [imageType, items] of buckets) {
    if (!Array.isArray(items)) continue
    for (const item of items) {
      const row = imageRow(entityType, tmdbId, imageType, item)
      if (row !== null) rows.push(row)
    }
  }
  return rows
}

/** Converte `published_at` ISO em Date; retorna null se ausente/invalido. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time)
}

function videoRow(entityType: string, tmdbId: number, item: TmdbVideoItem): VideoRow | null {
  const tmdbVideoId = str(item.id)
  const videoKey = str(item.key)
  const site = str(item.site)
  // Sem id/key/site nao ha video util nem link legal — descarta.
  if (tmdbVideoId === null || videoKey === null || site === null) return null
  return {
    entityType,
    tmdbId,
    tmdbVideoId,
    site,
    videoKey,
    name: str(item.name),
    videoType: str(item.type),
    official: typeof item.official === 'boolean' ? item.official : null,
    languageCode: str(item.iso_639_1),
    countryCode: str(item.iso_3166_1),
    size: num(item.size),
    publishedAt: parseDate(item.published_at),
    payloadHash: hashPayload(item),
  }
}

/**
 * Normaliza a resposta de `/videos` em linhas de video. Itens sem id/key/site
 * sao descartados. Nao filtra por pirataria aqui (so metadados legais do TMDB);
 * a exibicao continua gated por display_allowed=false.
 */
export function normalizeVideos(
  entityType: string,
  tmdbId: number,
  response: TmdbVideosResponse | null | undefined,
): VideoRow[] {
  if (response == null || typeof response !== 'object' || !Array.isArray(response.results)) return []
  const rows: VideoRow[] = []
  for (const item of response.results) {
    const row = videoRow(entityType, tmdbId, item)
    if (row !== null) rows.push(row)
  }
  return rows
}
