/**
 * discover.ts — Camada de dados SERVER-ONLY do /pt/explorar (tela 11).
 *
 * Invariantes 3/4/6: lê somente PostgreSQL; imagens via helper governado;
 * "Onde assistir" do destaque usa a MESMA cláusula licenciada do painel por
 * entidade (licensedWatchWhere). Sinais de ordenação são TÉCNICOS e locais,
 * já persistidos pela ingestão TMDB (nunca chamados no render):
 *  - `popularity`  → "Em Alta" (proxy local de tração; NÃO há métrica de
 *    crescimento 24h persistida — delta registrado, rótulo honesto).
 *  - `voteCountTmdb` → "Populares" (volume de avaliações; usado APENAS para
 *    ordenar — o número nunca é exibido: ratings externos seguem inativos).
 * Só entra entidade com título público + slug canônico pt-BR.
 */

import { cache } from 'react'
import { getPrismaClient } from '@screena/db/server'

import { licensedWatchWhere } from './entity-watch'
import { buildTmdbImageUrl } from '../lib/tmdb-image-url'
import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from '../lib/site'

const LANGUAGE_CODE = 'pt-BR'
const RAIL_LIMIT = 7
const FETCH_PER_TYPE = 24

export interface DiscoverCard {
  entityType: 'movie' | 'tv'
  entityId: string
  title: string
  href: string
  posterUrl: string | null
  year: number | null
}

export interface DiscoverFeatured extends DiscoverCard {
  originalTitle: string | null
  backdropUrl: string | null
  summary: string | null
  /** Nomes de provedores com oferta LICENCIADA vigente (texto, nunca logo). */
  watchProviders: string[]
}

export interface DiscoverData {
  featured: DiscoverFeatured | null
  emAlta: DiscoverCard[]
  populares: DiscoverCard[]
}

interface RawEntity {
  entityType: 'movie' | 'tv'
  id: bigint
  originalTitle: string
  date: Date | null
  posterPath: string | null
  backdropPath: string | null
  popularity: number
  voteCount: number
}

function toNumber(value: { toString(): string } | number | null): number {
  if (value == null) return 0
  const num = typeof value === 'number' ? value : Number(value.toString())
  return Number.isFinite(num) ? num : 0
}

export const getDiscoverData = cache(async (): Promise<DiscoverData> => {
  const prisma = getPrismaClient()

  const [movies, shows] = await Promise.all([
    prisma.movie.findMany({
      orderBy: [{ popularity: 'desc' }, { id: 'asc' }],
      take: FETCH_PER_TYPE,
      select: {
        id: true,
        titleOriginal: true,
        releaseDate: true,
        posterPath: true,
        backdropPath: true,
        popularity: true,
        voteCountTmdb: true,
      },
    }),
    prisma.tvShow.findMany({
      orderBy: [{ popularity: 'desc' }, { id: 'asc' }],
      take: FETCH_PER_TYPE,
      select: {
        id: true,
        nameOriginal: true,
        firstAirDate: true,
        posterPath: true,
        backdropPath: true,
        popularity: true,
        voteCountTmdb: true,
      },
    }),
  ])

  const raw: RawEntity[] = [
    ...movies.map(
      (movie): RawEntity => ({
        entityType: 'movie',
        id: movie.id,
        originalTitle: movie.titleOriginal,
        date: movie.releaseDate,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
        popularity: toNumber(movie.popularity),
        voteCount: movie.voteCountTmdb ?? 0,
      }),
    ),
    ...shows.map(
      (show): RawEntity => ({
        entityType: 'tv',
        id: show.id,
        originalTitle: show.nameOriginal,
        date: show.firstAirDate,
        posterPath: show.posterPath,
        backdropPath: show.backdropPath,
        popularity: toNumber(show.popularity),
        voteCount: show.voteCountTmdb ?? 0,
      }),
    ),
  ]
  if (raw.length === 0) return { featured: null, emAlta: [], populares: [] }

  const allIds = raw.map((entity) => entity.id)
  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: {
        entityType: { in: ['movie', 'tv'] },
        entityId: { in: allIds },
        languageCode: LANGUAGE_CODE,
      },
      select: { entityType: true, entityId: true, title: true, summary: true },
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

  const translated = new Map<string, { title: string | null; summary: string | null }>()
  for (const row of translations) {
    translated.set(`${row.entityType}:${row.entityId}`, {
      title: row.title?.trim() || null,
      summary: row.summary?.trim() || null,
    })
  }
  const slugByKey = new Map<string, string>()
  for (const row of slugs) slugByKey.set(`${row.entityType}:${row.entityId}`, row.slug)

  const toCard = (entity: RawEntity): DiscoverCard | null => {
    const key = `${entity.entityType}:${entity.id}`
    const slug = slugByKey.get(key)
    const title = translated.get(key)?.title ?? entity.originalTitle.trim()
    if (slug === undefined || title === '') return null
    const indexPath = entity.entityType === 'movie' ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH
    return {
      entityType: entity.entityType,
      entityId: entity.id.toString(),
      title,
      href: `${indexPath}${slug}/`,
      posterUrl: buildTmdbImageUrl(entity.posterPath, 'w300'),
      year: entity.date === null ? null : entity.date.getUTCFullYear(),
    }
  }

  const byPopularity = [...raw].sort((a, b) => b.popularity - a.popularity)
  const byVotes = [...raw].sort((a, b) => b.voteCount - a.voteCount)

  const emAlta: DiscoverCard[] = []
  for (const entity of byPopularity) {
    if (emAlta.length >= RAIL_LIMIT) break
    const card = toCard(entity)
    if (card !== null) emAlta.push(card)
  }
  const populares: DiscoverCard[] = []
  for (const entity of byVotes) {
    if (populares.length >= RAIL_LIMIT) break
    const card = toCard(entity)
    if (card !== null) populares.push(card)
  }

  // Destaque: 1º por popularidade com backdrop + card resolvível
  let featured: DiscoverFeatured | null = null
  for (const entity of byPopularity) {
    if (entity.backdropPath === null) continue
    const card = toCard(entity)
    if (card === null) continue
    const key = `${entity.entityType}:${entity.id}`
    const watch = await prisma.watchAvailability.findMany({
      where: {
        entityType: entity.entityType,
        entityId: entity.id,
        ...licensedWatchWhere(new Date()),
      },
      select: { providerName: true },
      take: 6,
    })
    const providerNames = [
      ...new Set(watch.map((row) => row.providerName.trim()).filter((name) => name !== '')),
    ].slice(0, 3)
    featured = {
      ...card,
      originalTitle:
        entity.originalTitle.trim() !== '' && entity.originalTitle.trim() !== card.title
          ? entity.originalTitle.trim()
          : null,
      backdropUrl: buildTmdbImageUrl(entity.backdropPath, 'w1280'),
      summary: translated.get(key)?.summary ?? null,
      watchProviders: providerNames,
    }
    break
  }

  return { featured, emAlta, populares }
})
