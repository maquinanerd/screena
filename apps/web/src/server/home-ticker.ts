/**
 * home-ticker.ts — Camada SERVER-ONLY do ticker amarelo da home (canonico:
 * "slide de episodios novos hoje · atualiza diariamente").
 *
 * Invariantes 3/4: le SOMENTE PostgreSQL local. So episodio com `air_date` =
 * HOJE (UTC) cuja serie tem titulo real e slug canonico pt-BR. Sem episodio
 * novo hoje -> lista vazia e o ticker NAO renderiza (dado real ou nada; nunca
 * ticker fake — regra da Home v4).
 */

import { cache } from 'react'
import { getPrismaClient } from '@screena/db/server'

import { SERIES_INDEX_PATH } from '../lib/site'

const LANGUAGE_CODE = 'pt-BR'
const TICKER_LIMIT = 6

export interface TickerEpisode {
  /** Nome da serie (traducao pt-BR ou original). */
  series: string
  /** Codigo curto "T2 · E5". */
  seasonEp: string
  /** Titulo do episodio, ou null (omitido). */
  episodeTitle: string | null
  /** `/pt/series/{slug}/` — destino real. */
  href: string
}

export const getHomeTickerEpisodes = cache(async (): Promise<TickerEpisode[]> => {
  const prisma = getPrismaClient()
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  const episodes = await prisma.episode.findMany({
    where: { airDate: { gte: dayStart, lt: dayEnd } },
    take: TICKER_LIMIT * 3,
    orderBy: [{ tvShowId: 'asc' }, { episodeNumber: 'asc' }],
    select: {
      tvShowId: true,
      episodeNumber: true,
      name: true,
      // season_number e DERIVADO de seasons (o episodio nao o armazena).
      season: { select: { seasonNumber: true, tvShow: { select: { nameOriginal: true } } } },
    },
  })
  if (episodes.length === 0) return []

  const showIds = [...new Set(episodes.map((episode) => episode.tvShowId))]
  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: { entityType: 'tv', entityId: { in: showIds }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: { entityType: 'tv', entityId: { in: showIds }, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityId: true, slug: true },
    }),
  ])
  const titleById = new Map<string, string>()
  for (const row of translations) {
    const title = row.title?.trim()
    if (title) titleById.set(row.entityId.toString(), title)
  }
  const slugById = new Map<string, string>()
  for (const row of slugs) slugById.set(row.entityId.toString(), row.slug)

  const out: TickerEpisode[] = []
  const seenShows = new Set<string>()
  for (const episode of episodes) {
    const key = episode.tvShowId.toString()
    if (seenShows.has(key)) continue
    const slug = slugById.get(key)
    const series = titleById.get(key) ?? episode.season.tvShow.nameOriginal.trim()
    if (slug === undefined || series === '') continue
    seenShows.add(key)
    out.push({
      series,
      seasonEp: `T${episode.season.seasonNumber} · E${episode.episodeNumber}`,
      episodeTitle: episode.name?.trim() || null,
      href: `${SERIES_INDEX_PATH}${slug}/`,
    })
    if (out.length >= TICKER_LIMIT) break
  }
  return out
})
