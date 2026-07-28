/**
 * home-ticker.ts — Camada SERVER-ONLY da faixa amarela da home (canonico:
 * "slide de episodios novos hoje · atualiza diariamente").
 *
 * Invariantes 3/4: le SOMENTE PostgreSQL local. So episodio cuja serie tem
 * titulo real e slug canonico pt-BR.
 *
 * A FAIXA e estrutura da home (fica sempre), mas o TEXTO nunca e inventado:
 *  1. episodio com `air_date` = HOJE (UTC)      -> kind "today";
 *  2. senao, proximos episodios confirmados     -> kind "upcoming" (com a data);
 *  3. senao, lista vazia -> a faixa exibe estado neutro e honesto ("nenhum
 *     episodio novo confirmado para hoje"), sem episodio, data ou plataforma
 *     fabricados.
 */

import { cache } from 'react'
import { getPrismaClient } from '@screena/db/server'

import { SERIES_INDEX_PATH } from '../lib/site'

const LANGUAGE_CODE = 'pt-BR'
const TICKER_LIMIT = 6

/** Janela de "proxima estreia confirmada" quando nao ha episodio hoje. */
const UPCOMING_WINDOW_DAYS = 30

export interface TickerEpisode {
  /** Estreia hoje ou proxima estreia confirmada. */
  kind: 'today' | 'upcoming'
  /** Nome da serie (traducao pt-BR ou original). */
  series: string
  /** Codigo curto "T2 · E5". */
  seasonEp: string
  /** Titulo do episodio, ou null (omitido). */
  episodeTitle: string | null
  /** Data de estreia formatada (so em `upcoming`), ou null. */
  airDateLabel: string | null
  /** `/pt/series/{slug}/` — destino real. */
  href: string
}

interface EpisodeRow {
  tvShowId: bigint
  episodeNumber: number
  name: string | null
  airDate: Date | null
  season: { seasonNumber: number; tvShow: { nameOriginal: string } }
}

const EPISODE_SELECT = {
  tvShowId: true,
  episodeNumber: true,
  name: true,
  airDate: true,
  // season_number e DERIVADO de seasons (o episodio nao o armazena).
  season: { select: { seasonNumber: true, tvShow: { select: { nameOriginal: true } } } },
} as const

/** "30 de julho" — data curta pt-BR em UTC (sem alegar hora). */
function formatAirDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Resolve titulo/slug pt-BR das series envolvidas e monta os itens, uma entrada
 * por serie (a primeira que aparecer na ordenacao recebida). Serie sem slug
 * canonico ou sem titulo e descartada — nunca link quebrado.
 */
async function toTickerEpisodes(
  prisma: ReturnType<typeof getPrismaClient>,
  episodes: readonly EpisodeRow[],
  kind: TickerEpisode['kind'],
): Promise<TickerEpisode[]> {
  if (episodes.length === 0) return []
  const showIds = [...new Set(episodes.map((episode) => episode.tvShowId))]
  const [translations, slugs] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: { entityType: 'tv', entityId: { in: showIds }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: {
        entityType: 'tv',
        entityId: { in: showIds },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
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
      kind,
      series,
      seasonEp: `T${episode.season.seasonNumber} · E${episode.episodeNumber}`,
      episodeTitle: episode.name?.trim() || null,
      airDateLabel:
        kind === 'upcoming' && episode.airDate !== null ? formatAirDate(episode.airDate) : null,
      href: `${SERIES_INDEX_PATH}${slug}/`,
    })
    if (out.length >= TICKER_LIMIT) break
  }
  return out
}

export const getHomeTickerEpisodes = cache(async (): Promise<TickerEpisode[]> => {
  const prisma = getPrismaClient()
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

  const todayEpisodes = await prisma.episode.findMany({
    where: { airDate: { gte: dayStart, lt: dayEnd } },
    take: TICKER_LIMIT * 3,
    orderBy: [{ tvShowId: 'asc' }, { episodeNumber: 'asc' }],
    select: EPISODE_SELECT,
  })
  const today = await toTickerEpisodes(prisma, todayEpisodes, 'today')
  if (today.length > 0) return today

  // Fallback honesto: proxima estreia JA CONFIRMADA no banco (nunca estimada).
  const windowEnd = new Date(dayEnd.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const upcomingEpisodes = await prisma.episode.findMany({
    where: { airDate: { gte: dayEnd, lt: windowEnd } },
    take: TICKER_LIMIT * 3,
    orderBy: [{ airDate: 'asc' }, { tvShowId: 'asc' }, { episodeNumber: 'asc' }],
    select: EPISODE_SELECT,
  })
  return toTickerEpisodes(prisma, upcomingEpisodes, 'upcoming')
})
