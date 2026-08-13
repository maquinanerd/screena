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
import { resolveWatchPlatform } from '../lib/watch-platform-identity'
import {
  describeUnsupportedWatchModality,
  resolveWatchModality,
  watchModalityLabels,
  type WatchModality,
} from '../lib/watch-offer-modality'
import { buildTmdbImageUrl } from '../lib/tmdb-image-url'
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
  /**
   * ROTULOS pt-BR das modalidades, ja na ordem canonica (incluso antes do que
   * custa) — nunca o valor cru do enum.
   *
   * Antes era a string do enum (`"subscription"`, `"buy"`) e o componente
   * cliente traduzia com um mapa PROPRIO que caia para `?? offer`: um valor
   * novo do upstream apareceria em ingles, em jargao de API, na cara do leitor.
   * O vocabulario passou a ser um so (`watch-offer-modality.ts`) e a traducao
   * acontece aqui, no servidor, junto do gate que ja conhece o dado.
   */
  offerTypeLabels: string[]
  /** Poster via helper governado (ou null). */
  posterUrl: string | null
  /** Sinal tecnico TMDB para ordenar "Populares agora" (nunca nota editorial). */
  popularity: number
}

export interface WatchBrowseProvider {
  /**
   * Identidade CANONICA da plataforma (`watch_providers.slug`), nao a chave do
   * fornecedor tecnico. O nome importa: `provider_key` em `watch_availability`
   * e por FORNECEDOR ("netflix" na RapidAPI, "8" no TMDB), e foi exatamente
   * essa ambiguidade que fez o hub listar a mesma plataforma duas vezes.
   */
  providerSlug: string
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
      // Identidade da plataforma ENTRE fornecedores tecnicos, e o nome canonico
      // dela. `provider_key` e a chave do FORNECEDOR, nao da plataforma: a
      // RapidAPI grava "netflix", o TMDB grava "8" (o `provider_id` numerico).
      // Agrupar por ele listaria a Netflix DUAS vezes, como se fossem dois
      // servicos. O painel de detalhe ja resolvia isso pelo slug; o hub nao
      // recebeu o campo quando o portao foi aberto as duas origens.
      watchProvider: { select: { slug: true, canonicalName: true } },
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
      select: { id: true, titleOriginal: true, posterPath: true, popularity: true },
    }),
    prisma.tvShow.findMany({
      where: { id: { in: [...tvIds] } },
      select: { id: true, nameOriginal: true, posterPath: true, popularity: true },
    }),
  ])

  const titleByKey = new Map<string, string>()
  const posterByKey = new Map<string, string | null>()
  const popularityByKey = new Map<string, number>()
  const toNumber = (value: { toString(): string } | number | null): number => {
    if (value == null) return 0
    const num = typeof value === 'number' ? value : Number(value.toString())
    return Number.isFinite(num) ? num : 0
  }
  for (const movie of movies) {
    const original = movie.titleOriginal.trim()
    if (original !== '') titleByKey.set(`movie:${movie.id}`, original)
    posterByKey.set(`movie:${movie.id}`, buildTmdbImageUrl(movie.posterPath, 'w300'))
    popularityByKey.set(`movie:${movie.id}`, toNumber(movie.popularity))
  }
  for (const show of shows) {
    const original = show.nameOriginal.trim()
    if (original !== '') titleByKey.set(`tv:${show.id}`, original)
    posterByKey.set(`tv:${show.id}`, buildTmdbImageUrl(show.posterPath, 'w300'))
    popularityByKey.set(`tv:${show.id}`, toNumber(show.popularity))
  }
  for (const row of translations) {
    const translated = row.title?.trim()
    if (translated) titleByKey.set(`${row.entityType}:${row.entityId}`, translated)
  }
  const slugByKey = new Map<string, string>()
  for (const row of slugs) slugByKey.set(`${row.entityType}:${row.entityId}`, row.slug)

  /**
   * O acumulador carrega as modalidades CRUAS (`WatchModality`) porque precisa
   * deduplicar por valor; os ROTULOS so sao materializados no fim, uma vez, na
   * ordem canonica. Acumular rotulo daria dedupe por string traduzida — mais
   * fragil e sem ordem declarada.
   */
  type AccumulatedTitle = WatchBrowseTitle & { modalities: WatchModality[] }
  interface Accumulated {
    providerName: string
    titles: Map<string, AccumulatedTitle>
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

    // O BALDE E A PLATAFORMA, nao o fornecedor — e quem decide isso e o modulo
    // compartilhado, o MESMO usado pelo destaque de `discover`. Regra critica
    // reimplementada em cada consumidor foi exatamente como este defeito nasceu.
    const platform = resolveWatchPlatform({
      providerName: row.providerName,
      providerKey: row.providerKey,
      providerSlug: row.watchProvider?.slug ?? null,
      canonicalName: row.watchProvider?.canonicalName ?? null,
    })
    if (platform === null) continue
    const { bucketKey, displayName: providerName } = platform

    const bucket = byProvider.get(bucketKey) ?? {
      providerName,
      titles: new Map<string, AccumulatedTitle>(),
    }
    const indexPath = row.entityType === 'movie' ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH
    const existing = bucket.titles.get(key)
    const rawOfferType = row.offerType === null ? null : String(row.offerType)
    const modality = resolveWatchModality(rawOfferType)
    if (modality === null && rawOfferType !== null) {
      // Descarte NUNCA silencioso, e nunca rotulo cru na tela.
      console.warn(describeUnsupportedWatchModality(rawOfferType))
    }
    if (existing === undefined) {
      if (bucket.titles.size < BROWSE_TITLES_PER_PROVIDER) {
        bucket.titles.set(key, {
          entityType: row.entityType as 'movie' | 'tv',
          title,
          href: `${indexPath}${slug}/`,
          modalities: modality === null ? [] : [modality],
          offerTypeLabels: [],
          posterUrl: posterByKey.get(key) ?? null,
          popularity: popularityByKey.get(key) ?? 0,
        })
      }
    } else if (modality !== null && !existing.modalities.includes(modality)) {
      existing.modalities.push(modality)
    }
    byProvider.set(bucketKey, bucket)
  }

  const providers: WatchBrowseProvider[] = [...byProvider.entries()]
    .map(([providerSlug, bucket]) => ({
      providerSlug,
      providerName: bucket.providerName,
      // "Populares agora": ordena pelo sinal tecnico de popularidade (TMDB)
      titles: [...bucket.titles.values()]
        .sort((a, b) => b.popularity - a.popularity)
        // Rotulos materializados UMA vez, na ordem canonica (incluso antes do
        // que custa). `modalities` nao atravessa o boundary: a tela recebe
        // rotulo pt-BR, nunca o valor do enum.
        .map(({ modalities, ...title }) => ({
          ...title,
          offerTypeLabels: watchModalityLabels(modalities),
        })),
    }))
    .filter((provider) => provider.titles.length > 0)
    .sort((a, b) => b.titles.length - a.titles.length || a.providerName.localeCompare(b.providerName))

  return {
    providers,
    updatedAtIso: updatedAt === null ? null : updatedAt.toISOString(),
    attributions: [...attributions.values()],
  }
})
