/**
 * watch-browse.ts — Camada de dados SERVER-ONLY do hub /pt/onde-assistir
 * (tela 10 do handoff, CatalogBrowseTemplate).
 *
 * Invariantes 3, 4 e 6:
 *  - Le SOMENTE PostgreSQL local via @screena/db (Prisma). Read-only; nunca
 *    consulta o provider de streaming ao vivo.
 *  - LICENCA antes de exibir: reusa `licensedWatchWhere` (a MESMA clausula do
 *    painel por entidade — a regra critica vive num unico lugar). Oferta sem
 *    decisao vigente/licenca exibivel nao aparece.
 *  - Um titulo so entra se tiver TITULO real e SLUG canonico pt-BR (nunca link
 *    quebrado); provedor sem titulos elegiveis e OMITIDO (streaming-unavailable
 *    honesto, sem provedor inventado).
 *
 * Estrategia de consulta (sem N+1): 1 query de ofertas licenciadas + 3 queries
 * em lote (traducoes, slugs, entidades) resolvidas por Map.
 */

import { cache } from 'react'
import { getPrismaClient } from '@screena/db/server'

import { licensedWatchWhere } from './entity-watch'
import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from '../lib/site'

const LANGUAGE_CODE = 'pt-BR'

/** Teto de ofertas varridas (agrupadas em memoria por provedor). */
const BROWSE_FETCH_LIMIT = 400

/** Maximo de titulos exibidos por provedor no hub. */
const BROWSE_TITLES_PER_PROVIDER = 12

export interface WatchBrowseTitle {
  entityType: 'movie' | 'tv'
  title: string
  href: string
  offerTypes: string[]
}

export interface WatchBrowseProvider {
  providerKey: string
  providerName: string
  titles: WatchBrowseTitle[]
}

export interface WatchBrowseData {
  providers: WatchBrowseProvider[]
  /** Carimbo "Atualizado em" (max fetched_at exibido), ou null. */
  updatedAtIso: string | null
  attributions: { text: string; url: string | null }[]
}

export const getWatchBrowseData = cache(async (): Promise<WatchBrowseData> => {
  const prisma = getPrismaClient()
  const now = new Date()

  const rows = await prisma.watchAvailability.findMany({
    where: { entityType: { in: ['movie', 'tv'] }, ...licensedWatchWhere(now) },
    take: BROWSE_FETCH_LIMIT,
    orderBy: { fetchedAt: 'desc' },
    select: {
      entityType: true,
      entityId: true,
      providerKey: true,
      providerName: true,
      offerType: true,
      fetchedAt: true,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: true,
      attributionUrl: true,
    },
  })
  if (rows.length === 0) return { providers: [], updatedAtIso: null, attributions: [] }

  const movieIds = new Set<bigint>()
  const tvIds = new Set<bigint>()
  for (const row of rows) {
    if (row.entityType === 'movie') movieIds.add(row.entityId)
    else if (row.entityType === 'tv') tvIds.add(row.entityId)
  }

  // Lote unico por tabela (sem N+1): titulos traduzidos + slugs canonicos.
  const [translations, slugs, movies, shows] = await Promise.all([
    prisma.entityTranslation.findMany({
      where: {
        entityType: { in: ['movie', 'tv'] },
        entityId: { in: [...movieIds, ...tvIds] },
        languageCode: LANGUAGE_CODE,
      },
      select: { entityType: true, entityId: true, title: true },
    }),
    prisma.slug.findMany({
      where: {
        entityType: { in: ['movie', 'tv'] },
        entityId: { in: [...movieIds, ...tvIds] },
        languageCode: LANGUAGE_CODE,
        isCanonical: true,
      },
      select: { entityType: true, entityId: true, slug: true },
    }),
    prisma.movie.findMany({
      where: { id: { in: [...movieIds] } },
      select: { id: true, titleOriginal: true },
    }),
    prisma.tvShow.findMany({
      where: { id: { in: [...tvIds] } },
      select: { id: true, nameOriginal: true },
    }),
  ])

  const titleByKey = new Map<string, string>()
  for (const movie of movies) {
    const original = movie.titleOriginal.trim()
    if (original !== '') titleByKey.set(`movie:${movie.id}`, original)
  }
  for (const show of shows) {
    const original = show.nameOriginal.trim()
    if (original !== '') titleByKey.set(`tv:${show.id}`, original)
  }
  for (const row of translations) {
    const translated = row.title?.trim()
    if (translated) titleByKey.set(`${row.entityType}:${row.entityId}`, translated)
  }
  const slugByKey = new Map<string, string>()
  for (const row of slugs) slugByKey.set(`${row.entityType}:${row.entityId}`, row.slug)

  interface Accumulated {
    providerName: string
    titles: Map<string, WatchBrowseTitle>
  }
  const byProvider = new Map<string, Accumulated>()
  let updatedAt: Date | null = null
  const attributions = new Map<string, { text: string; url: string | null }>()

  for (const row of rows) {
    const key = `${row.entityType}:${row.entityId}`
    const title = titleByKey.get(key)
    const slug = slugByKey.get(key)
    if (title === undefined || slug === undefined) continue

    // Credito obrigatorio ausente -> oferta fora (mesma regra do painel).
    if (row.requiresAttribution && (row.attributionText ?? '').trim() === '') continue
    if (row.requiresLinkback && (row.attributionUrl ?? '').trim() === '') continue
    if (row.attributionText !== null && row.attributionText.trim() !== '') {
      attributions.set(row.attributionText.trim(), {
        text: row.attributionText.trim(),
        url: row.attributionUrl?.trim() || null,
      })
    }

    if (row.fetchedAt !== null && (updatedAt === null || row.fetchedAt > updatedAt)) {
      updatedAt = row.fetchedAt
    }

    const providerName = row.providerName.trim()
    if (providerName === '') continue
    const providerKey = (row.providerKey ?? '').trim()
    if (providerKey === '') continue
    const bucket = byProvider.get(providerKey) ?? {
      providerName,
      titles: new Map<string, WatchBrowseTitle>(),
    }
    const indexPath = row.entityType === 'movie' ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH
    const existing = bucket.titles.get(key)
    const offerType = row.offerType === null ? null : String(row.offerType)
    if (existing === undefined) {
      if (bucket.titles.size < BROWSE_TITLES_PER_PROVIDER) {
        bucket.titles.set(key, {
          entityType: row.entityType as 'movie' | 'tv',
          title,
          href: `${indexPath}${slug}/`,
          offerTypes: offerType === null ? [] : [offerType],
        })
      }
    } else if (offerType !== null && !existing.offerTypes.includes(offerType)) {
      existing.offerTypes.push(offerType)
    }
    byProvider.set(providerKey, bucket)
  }

  const providers: WatchBrowseProvider[] = [...byProvider.entries()]
    .map(([providerKey, bucket]) => ({
      providerKey,
      providerName: bucket.providerName,
      titles: [...bucket.titles.values()],
    }))
    .filter((provider) => provider.titles.length > 0)
    .sort((a, b) => b.titles.length - a.titles.length || a.providerName.localeCompare(b.providerName))

  return {
    providers,
    updatedAtIso: updatedAt === null ? null : updatedAt.toISOString(),
    attributions: [...attributions.values()],
  }
})
