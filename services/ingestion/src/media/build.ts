/**
 * build.ts — Construtores PUROS do bloco de midia publico (Backend A, secao 8).
 *
 * Transforma linhas cruas de tmdb_images/tmdb_videos no `MediaPayload` do
 * contrato publico. Sem rede, sem Prisma, sem IO — o adapter de leitura vive em
 * persistence/media-reader.ts.
 *
 * Governanca:
 *  - Invariante 6: TODA linha com `displayAllowed === false` e descartada aqui.
 *    O raw nunca vaza; o payload so carrega o que ja foi liberado por humano.
 *  - Invariante 8: `buildEmbedUrl` so monta embed para sites conhecidos e
 *    legitimos (YouTube/Vimeo). Site desconhecido => null. NUNCA adivinhamos uma
 *    URL de player.
 */

import { buildTmdbImageUrl } from '@screena/public-contracts'
import type {
  MediaAssetKind,
  MediaPayload,
  PublicMediaAsset,
  PublicVideo,
  PublicVideoType,
  TmdbImageSize,
} from '@screena/public-contracts'

/** Linha crua de tmdb_images ja lida do banco (id como string). */
export interface MediaImageRow {
  readonly id: string
  readonly imageType: string
  readonly filePath: string
  readonly languageCode: string | null
  readonly width: number | null
  readonly height: number | null
  readonly aspectRatio: number | null
  readonly voteAverage: number | null
  readonly displayAllowed: boolean
}

/** Linha crua de tmdb_videos ja lida do banco (id como string). */
export interface MediaVideoRow {
  readonly id: string
  readonly tmdbVideoId: string
  readonly site: string
  readonly videoKey: string
  readonly name: string | null
  readonly videoType: string | null
  readonly official: boolean | null
  readonly languageCode: string | null
  readonly publishedAt: Date | null
  readonly displayAllowed: boolean
}

/** Entrada de `buildMediaPayload`. */
export interface BuildMediaPayloadInput {
  readonly images: readonly MediaImageRow[]
  readonly videos: readonly MediaVideoRow[]
  /** Texto alternativo aplicado a todas as imagens (acessibilidade). */
  readonly alt: string
  /** Tamanho TMDB do poster (default 'w500'). */
  readonly posterSize?: string
  /** Tamanho TMDB do backdrop (default 'w1280'). */
  readonly backdropSize?: string
}

const DEFAULT_POSTER_SIZE: TmdbImageSize = 'w500'
const DEFAULT_BACKDROP_SIZE: TmdbImageSize = 'w1280'
const DEFAULT_IMAGE_SIZE: TmdbImageSize = 'w500'

/** Tamanhos aceitos (validacao do input livre de BuildMediaPayloadInput). */
const VALID_SIZES: readonly TmdbImageSize[] = ['w300', 'w500', 'w780', 'w1280', 'original']

/** Estreita um tamanho vindo de input livre para o enum canonico. */
function narrowSize(raw: string | undefined, fallback: TmdbImageSize): TmdbImageSize {
  return raw !== undefined && (VALID_SIZES as readonly string[]).includes(raw)
    ? (raw as TmdbImageSize)
    : fallback
}

/** Tipos de imagem aceitos (espelham tmdb_images.image_type). */
const IMAGE_KINDS: Readonly<Record<string, MediaAssetKind>> = {
  poster: 'poster',
  backdrop: 'backdrop',
  logo: 'logo',
  profile: 'profile',
  still: 'still',
}

/** Ordem de exibicao dos videos: trailer primeiro, resto depois. */
const VIDEO_TYPE_ORDER: Readonly<Record<PublicVideoType, number>> = {
  trailer: 0,
  teaser: 1,
  clip: 2,
  featurette: 3,
  other: 4,
}

/**
 * Monta a URL publica de uma imagem TMDB via o helper CANONICO de
 * @screena/public-contracts — a unica implementacao do repositorio (o audit de
 * render verifica isso repo-wide). A versao local anterior concatenava sem as
 * validacoes do canonico (nao rejeitava `..`, `//`, query): era drift real.
 *
 * Devolve `null` para `filePath` invalido — o chamador DESCARTA a linha
 * (fail-closed): um asset sem URL valida nao vira imagem quebrada no contrato.
 */
export function buildImageUrl(filePath: string, size?: string): string | null {
  return buildTmdbImageUrl(filePath, narrowSize(size, DEFAULT_IMAGE_SIZE))
}

/**
 * Traduz o `video_type` cru do TMDB ('Trailer', 'Teaser', ...) para o tipo do
 * contrato. Case-insensitive; desconhecido/null => 'other' (nunca chuta).
 */
export function mapVideoType(raw: string | null): PublicVideoType {
  if (raw === null) return 'other'
  const value = raw.trim().toLowerCase()
  if (value === 'trailer') return 'trailer'
  if (value === 'teaser') return 'teaser'
  if (value === 'clip') return 'clip'
  if (value === 'featurette') return 'featurette'
  return 'other'
}

/**
 * URL de embed do video. So sites conhecidos e legitimos (invariante 8):
 * YouTube e Vimeo. QUALQUER outro site => null — jamais inferimos um player a
 * partir de um site desconhecido (risco de embed pirata).
 */
export function buildEmbedUrl(site: string, key: string): string | null {
  if (key.trim() === '') return null
  const normalized = site.trim().toLowerCase()
  if (normalized === 'youtube') return `https://www.youtube.com/embed/${key}`
  if (normalized === 'vimeo') return `https://player.vimeo.com/video/${key}`
  return null
}

/** Thumbnail do video. So YouTube expoe um caminho estavel; senao null. */
export function buildThumbnailUrl(site: string, key: string): string | null {
  if (key.trim() === '') return null
  if (site.trim().toLowerCase() !== 'youtube') return null
  return `https://img.youtube.com/vi/${key}/hqdefault.jpg`
}

/** Tamanho TMDB por tipo de imagem. */
function sizeForKind(kind: MediaAssetKind, posterSize?: string, backdropSize?: string): string {
  if (kind === 'poster') return posterSize ?? DEFAULT_POSTER_SIZE
  if (kind === 'backdrop') return backdropSize ?? DEFAULT_BACKDROP_SIZE
  return DEFAULT_IMAGE_SIZE
}

/** Converte Date em ISO string; data invalida/ausente => null. */
function isoOrNull(value: Date | null): string | null {
  if (value === null) return null
  const time = value.getTime()
  if (Number.isNaN(time)) return null
  return value.toISOString()
}

/** Ordena por voteAverage DESC com nulls por ultimo (nao muta a entrada). */
function byVoteDesc(a: MediaImageRow, b: MediaImageRow): number {
  return (b.voteAverage ?? Number.NEGATIVE_INFINITY) - (a.voteAverage ?? Number.NEGATIVE_INFINITY)
}

interface MappedImage {
  readonly row: MediaImageRow
  readonly asset: PublicMediaAsset
}

/** Escolhe o melhor asset de um tipo (maior voteAverage, nulls por ultimo). */
function pickBest(entries: readonly MappedImage[], kind: MediaAssetKind): PublicMediaAsset | null {
  const candidates = entries.filter((e) => e.asset.kind === kind)
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => byVoteDesc(a.row, b.row))
  const best = sorted[0]
  return best === undefined ? null : best.asset
}

/**
 * Monta o `MediaPayload` publico a partir das linhas cruas.
 *
 * Regras: filtra `displayAllowed === false` (invariante 6); poster/backdrop sao
 * o asset de maior voteAverage do seu tipo (nulls por ultimo); videos sao
 * deduplicados por (site, key) mantendo o primeiro e ordenados por tipo
 * (trailer primeiro) e, dentro do mesmo tipo, oficiais primeiro.
 */
export function buildMediaPayload(input: BuildMediaPayloadInput): MediaPayload {
  const entries: MappedImage[] = []
  for (const row of input.images) {
    // Invariante 6: linha nao liberada nunca entra no payload publico.
    if (!row.displayAllowed) continue
    const kind = IMAGE_KINDS[row.imageType.trim().toLowerCase()]
    // Tipo desconhecido nao vira asset: o contrato so aceita o enum canonico.
    if (kind === undefined) continue
    const size = sizeForKind(kind, input.posterSize, input.backdropSize)
    const url = buildImageUrl(row.filePath, size)
    // file_path invalido (nao comeca com '/', tem '..', query...) nao vira
    // imagem quebrada: a linha e descartada — fail-closed, como displayAllowed.
    if (url === null) continue
    entries.push({
      row,
      asset: {
        id: row.id,
        kind,
        language: row.languageCode,
        width: row.width,
        height: row.height,
        aspectRatio: row.aspectRatio,
        source: 'tmdb',
        displayAllowed: true,
        url,
        alt: input.alt,
      },
    })
  }

  const seen = new Set<string>()
  const videos: PublicVideo[] = []
  for (const row of input.videos) {
    // Invariante 6: video nao liberado nunca entra no payload publico.
    if (!row.displayAllowed) continue
    const dedupeKey = `${row.site.trim().toLowerCase()}|${row.videoKey}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    videos.push({
      id: row.id,
      type: mapVideoType(row.videoType),
      site: row.site,
      key: row.videoKey,
      official: row.official ?? false,
      language: row.languageCode,
      publishedAt: isoOrNull(row.publishedAt),
      thumbnailUrl: buildThumbnailUrl(row.site, row.videoKey),
      embedUrl: buildEmbedUrl(row.site, row.videoKey),
    })
  }

  // Sort estavel (ES2019+): empates preservam a ordem de entrada.
  const orderedVideos = [...videos].sort((a, b) => {
    const byType = VIDEO_TYPE_ORDER[a.type] - VIDEO_TYPE_ORDER[b.type]
    if (byType !== 0) return byType
    return Number(b.official) - Number(a.official)
  })

  return {
    poster: pickBest(entries, 'poster'),
    backdrop: pickBest(entries, 'backdrop'),
    images: entries.map((e) => e.asset),
    videos: orderedVideos,
  }
}

/**
 * Razao de cobertura (0..1) arredondada a 4 casas. `total <= 0` => 0 (nunca
 * divide por zero nem inventa cobertura para um universo vazio).
 */
export function coverageRatio(withMedia: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((withMedia / total) * 10000) / 10000
}
