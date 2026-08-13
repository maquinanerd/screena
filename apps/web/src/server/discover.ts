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
import { distinctWatchPlatforms, resolveWatchPlatform } from '../lib/watch-platform-identity'
import {
  describeUnsupportedWatchModality,
  resolveWatchModality,
  watchModalityLabels,
  type WatchModality,
} from '../lib/watch-offer-modality'
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

/** Uma plataforma do destaque, com as modalidades que ela realmente oferece. */
export interface DiscoverWatchPlatform {
  /** Nome canonico da plataforma (nunca o nome do fornecedor tecnico). */
  name: string
  /** Rotulos pt-BR ja na ordem canonica (incluso antes do que custa). */
  modalityLabels: string[]
}

export interface DiscoverFeatured extends DiscoverCard {
  originalTitle: string | null
  backdropUrl: string | null
  summary: string | null
  /**
   * Plataformas com oferta LICENCIADA vigente (texto, nunca logo), cada uma com
   * as MODALIDADES que ela oferece — "Prime Video · Assinatura · Aluguel".
   *
   * Era `string[]` (so o nome). Compra e aluguel sao a maioria do corpus, entao
   * listar "Apple TV" sem dizer "Compra" afirmava disponibilidade inclusa numa
   * assinatura que o leitor talvez ja pague. Uma linha por PLATAFORMA, com as
   * modalidades ao lado — nunca duas entradas da mesma marca.
   */
  watchProviders: DiscoverWatchPlatform[]
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
      select: {
        providerName: true,
        // `providerKey` NAO e decorativo aqui: `resolveWatchPlatform` recusa a
        // oferta sem ele (nao ha como atribui-la a plataforma nenhuma). Omitir
        // este campo esvaziaria a lista de provedores do destaque em silencio.
        providerKey: true,
        watchProvider: { select: { slug: true, canonicalName: true } },
        // MODALIDADE: o destaque dizia so a marca. Compra e aluguel sao a
        // maioria do corpus — sem este campo, "Apple TV" no destaque afirma
        // disponibilidade inclusa numa assinatura que o leitor talvez ja pague.
        offerType: true,
      },
      take: 6,
    })
    // MESMA nocao de identidade do hub e do painel (modulo compartilhado):
    // deduplicar por NOME de fornecedor nao e identidade — as duas origens
    // escrevem o mesmo servico com strings proprias ("Prime Video" vs
    // "Amazon Prime Video"). A identidade da plataforma e o slug canonico.
    const platformSources = watch.map((row) => ({
      providerName: row.providerName,
      providerKey: row.providerKey,
      providerSlug: row.watchProvider?.slug ?? null,
      canonicalName: row.watchProvider?.canonicalName ?? null,
    }))
    // Modalidades acumuladas POR PLATAFORMA (mesma chave de balde do modulo
    // compartilhado), para que a mesma marca nunca vire duas entradas.
    const modalitiesByBucket = new Map<string, WatchModality[]>()
    for (const [index, row] of watch.entries()) {
      const source = platformSources[index]
      if (source === undefined) continue
      const identity = resolveWatchPlatform(source)
      if (identity === null) continue
      const modality = resolveWatchModality(row.offerType === null ? null : String(row.offerType))
      if (modality === null) {
        // Descarte NUNCA silencioso: o valor cru vai para o log.
        console.warn(describeUnsupportedWatchModality(row.offerType === null ? null : String(row.offerType)))
        continue
      }
      const bucket = modalitiesByBucket.get(identity.bucketKey)
      if (bucket === undefined) modalitiesByBucket.set(identity.bucketKey, [modality])
      else bucket.push(modality)
    }
    const providerNames = distinctWatchPlatforms(platformSources)
      .map((platform) => ({
        name: platform.displayName,
        modalityLabels: watchModalityLabels(modalitiesByBucket.get(platform.bucketKey) ?? []),
      }))
      // Plataforma cuja unica oferta tinha modalidade desconhecida sai da lista:
      // exibir a marca sem dizer o que ela custa e exatamente o que esta
      // mudanca existe para impedir.
      .filter((platform) => platform.modalityLabels.length > 0)
      .slice(0, 3)
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
