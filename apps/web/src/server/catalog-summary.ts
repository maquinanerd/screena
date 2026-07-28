/**
 * catalog-summary.ts — resolução PÚBLICA de cartões de catálogo por id.
 *
 * Serve às superfícies pessoais (Continuar assistindo, Minha lista, Listas):
 * o Backend C guarda apenas (entityType, entityId); título/slug/poster são
 * dados PÚBLICOS do catálogo e são resolvidos aqui em lote, server-only,
 * lendo somente PostgreSQL (invariantes 3/4). Nenhum dado pessoal entra
 * neste módulo. Entidade sem título público ou sem slug canônico pt-BR é
 * OMITIDA (nunca link quebrado/id cru).
 */

import { getPrismaClient } from '@screena/db/server'

import { buildTmdbImageUrl } from '../lib/tmdb-image-url'
import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from '../lib/site'

const LANGUAGE_CODE = 'pt-BR'

/** Teto de ids resolvidos por chamada (anti-abuso do endpoint público). */
export const CATALOG_SUMMARY_MAX_IDS = 48

export interface CatalogSummaryItem {
  entityType: 'movie' | 'tv'
  entityId: string
  title: string
  href: string
  posterUrl: string | null
  backdropUrl: string | null
  year: number | null
}

export interface CatalogSummaryKey {
  entityType: 'movie' | 'tv'
  entityId: bigint
}

/** Parseia "movie:12,tv:34" com fail-closed (entrada inválida é descartada). */
export function parseCatalogSummaryIds(raw: string | null): CatalogSummaryKey[] {
  if (raw === null) return []
  const out: CatalogSummaryKey[] = []
  for (const part of raw.split(',')) {
    if (out.length >= CATALOG_SUMMARY_MAX_IDS) break
    const match = /^(movie|tv):(\d{1,18})$/.exec(part.trim())
    if (match === null) continue
    out.push({
      entityType: match[1] as 'movie' | 'tv',
      entityId: BigInt(match[2] as string),
    })
  }
  return out
}

export async function getCatalogSummary(
  keys: CatalogSummaryKey[],
): Promise<CatalogSummaryItem[]> {
  if (keys.length === 0) return []
  const prisma = getPrismaClient()

  const movieIds = keys.filter((k) => k.entityType === 'movie').map((k) => k.entityId)
  const tvIds = keys.filter((k) => k.entityType === 'tv').map((k) => k.entityId)
  const allIds = [...movieIds, ...tvIds]

  const [movies, shows, translations, slugs] = await Promise.all([
    movieIds.length > 0
      ? prisma.movie.findMany({
          where: { id: { in: movieIds } },
          select: {
            id: true,
            titleOriginal: true,
            releaseDate: true,
            posterPath: true,
            backdropPath: true,
          },
        })
      : Promise.resolve([]),
    tvIds.length > 0
      ? prisma.tvShow.findMany({
          where: { id: { in: tvIds } },
          select: {
            id: true,
            nameOriginal: true,
            firstAirDate: true,
            posterPath: true,
            backdropPath: true,
          },
        })
      : Promise.resolve([]),
    prisma.entityTranslation.findMany({
      where: {
        entityType: { in: ['movie', 'tv'] },
        entityId: { in: allIds },
        languageCode: LANGUAGE_CODE,
      },
      select: { entityType: true, entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: {
        entityType: { in: ['movie', 'tv'] },
        entityId: { in: allIds },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityType: true, entityId: true, slug: true },
    }),
  ])

  const translated = new Map<string, string>()
  for (const row of translations) {
    const title = row.title?.trim()
    if (title) translated.set(`${row.entityType}:${row.entityId}`, title)
  }
  const slugByKey = new Map<string, string>()
  for (const row of slugs) slugByKey.set(`${row.entityType}:${row.entityId}`, row.slug)

  const out: CatalogSummaryItem[] = []
  for (const movie of movies) {
    const key = `movie:${movie.id}`
    const title = translated.get(key) ?? movie.titleOriginal.trim()
    const slug = slugByKey.get(key)
    if (!title || slug === undefined) continue
    out.push({
      entityType: 'movie',
      entityId: movie.id.toString(),
      title,
      href: `${MOVIES_INDEX_PATH}${slug}/`,
      posterUrl: buildTmdbImageUrl(movie.posterPath, 'w300'),
      backdropUrl: buildTmdbImageUrl(movie.backdropPath, 'w780'),
      year: movie.releaseDate === null ? null : movie.releaseDate.getUTCFullYear(),
    })
  }
  for (const show of shows) {
    const key = `tv:${show.id}`
    const title = translated.get(key) ?? show.nameOriginal.trim()
    const slug = slugByKey.get(key)
    if (!title || slug === undefined) continue
    out.push({
      entityType: 'tv',
      entityId: show.id.toString(),
      title,
      href: `${SERIES_INDEX_PATH}${slug}/`,
      posterUrl: buildTmdbImageUrl(show.posterPath, 'w300'),
      backdropUrl: buildTmdbImageUrl(show.backdropPath, 'w780'),
      year: show.firstAirDate === null ? null : show.firstAirDate.getUTCFullYear(),
    })
  }
  return out
}
