/**
 * map.ts — Mappers PUROS: source rows -> payloads de @screena/public-contracts.
 *
 * Cada mapper termina no VALIDADOR do contrato (`validateMovieDetail` etc.):
 * um payload que nao valida e bug NOSSO e lanca na hora, perto da origem —
 * nunca viaja ate o render. E o mesmo validador dos contract tests, entao o
 * que o teste prova e o que o runtime exige.
 *
 * Serializacao na fronteira: `Date` vira 'YYYY-MM-DD' (datas de obra nao tem
 * hora), ids ja chegam como string, `Decimal` ja chegou como number. Nenhum
 * tipo do Prisma e nenhum payload bruto do TMDB atravessam este modulo.
 */

import {
  buildMediaPayload,
} from '../media/build.js'
import { buildTmdbImageUrl } from '@screena/public-contracts'
import type { PublicIndexabilityProjection } from '@screena/seo'
import {
  validateCatalogStatusPayload,
  validateDiscoveryPayload,
  validateEpisodeDetail,
  validateHomePayload,
  validateMovieDetail,
  validatePersonDetail,
  validateSearchPayload,
  validateSeasonDetail,
  validateTvDetail,
} from '@screena/public-contracts'
import type {
  CatalogJobView,
  CatalogStatusPayload,
  Credit,
  DiscoveryPayload,
  EntityCard,
  EntityRef,
  EpisodeDetailPayload,
  HomePayload,
  MediaPayload,
  MovieDetailPayload,
  PersonDetailPayload,
  SearchPayload,
  SearchResult,
  SeasonDetailPayload,
  SeoPayload,
  TvDetailPayload,
  ValidationResult,
} from '@screena/public-contracts'
import type {
  CardSourceRow,
  CatalogJobSourceRow,
  CreditRow,
  EpisodeSourceRow,
  MediaRows,
  MovieSourceRow,
  PersonSourceRow,
  SearchSourceRow,
  SeasonSourceRow,
  TvSourceRow,
} from './source-rows.js'

/** Opcoes comuns de mapeamento. */
export interface MapOptions {
  /** Origem absoluta do site (ex.: https://thescreen.media), sem barra final. */
  readonly siteOrigin: string
  readonly locale: string
  /**
   * Indexabilidade VIGENTE da entidade+locale, projetada de
   * `page_indexability_decisions` por `projectPublicIndexability`.
   *
   * OBRIGATORIA nos payloads de detalhe. Nao ha default: um default
   * "indexavel" foi exatamente o bug — o contrato cravava `index,follow` para
   * toda entidade com slug, ignorando a decisao registrada.
   */
  readonly indexability?: PublicIndexabilityProjection
}

/** Data de obra -> 'YYYY-MM-DD' (sem hora; null atravessa). */
export function toIsoDate(value: Date | null): string | null {
  if (value === null) return null
  return value.toISOString().slice(0, 10)
}

/** Ano de uma data de obra (null atravessa). */
export function yearOf(value: Date | null): number | null {
  if (value === null) return null
  return value.getUTCFullYear()
}

/** Instante -> ISO completo (para carimbos, nao datas de obra). */
export function toIsoInstant(value: Date | null): string | null {
  return value === null ? null : value.toISOString()
}

const ROUTE_SEGMENT = { movie: 'filmes', tv: 'series', person: 'pessoas' } as const

/** URL canonica absoluta de uma entidade com slug proprio. */
export function canonicalUrlFor(
  siteOrigin: string,
  kind: 'movie' | 'tv' | 'person',
  slug: string,
): string {
  return `${siteOrigin}/pt/${ROUTE_SEGMENT[kind]}/${slug}/`
}

/** URL canonica de temporada (rota composta: serie + numero; sem slug proprio). */
export function seasonCanonicalUrl(siteOrigin: string, seriesSlug: string, n: number): string {
  return `${siteOrigin}/pt/series/${seriesSlug}/temporadas/${n}/`
}

/** URL canonica de episodio (serie + temporada + numero). */
export function episodeCanonicalUrl(
  siteOrigin: string,
  seriesSlug: string,
  season: number,
  episode: number,
): string {
  return `${siteOrigin}/pt/series/${seriesSlug}/temporadas/${season}/episodios/${episode}/`
}

/**
 * SeoPayload a partir da decisao AUTORITATIVA de indexabilidade.
 *
 * A versao anterior cravava `index: true` / `robots: 'index,follow'` para toda
 * entidade resolvida, deduzindo indexabilidade de "tem slug". Isso ignorava
 * `page_indexability_decisions`: entidade `noindex`/`blocked`/`stale`/`draft`
 * — ou sem decisao registrada — saia no contrato como indexavel. Slug e
 * resolucao de ROTA; indexabilidade e decisao REGISTRADA. Sem projecao, o
 * payload e fail-closed (`noindex,follow`), nunca indexado por omissao.
 */
function buildSeo(
  canonicalUrl: string,
  options: MapOptions,
  metaTitle: string | null,
  metaDescription: string | null,
): SeoPayload {
  const projection = options.indexability ?? FAIL_CLOSED_INDEXABILITY
  return {
    canonicalUrl,
    index: projection.index,
    robots: projection.robots,
    metaTitle,
    metaDescription,
    locale: options.locale,
  }
}

/** Sem decisao projetada, o contrato nao indexa. O silencio nunca autoriza. */
const FAIL_CLOSED_INDEXABILITY: PublicIndexabilityProjection = {
  index: false,
  robots: 'noindex,follow',
  decision: 'absent',
}

/** Lanca com o diagnostico do validador quando o payload nao cumpre o contrato. */
function unwrap<T>(result: ValidationResult<T>, what: string): T {
  if (!result.ok || result.value === null) {
    throw new Error(`${what} nao cumpre o contrato: ${result.errors.join(' | ')}`)
  }
  return result.value
}

/** Credito -> contrato (EntityRef de pessoa + papel). */
function mapCredit(row: CreditRow, siteOrigin: string): Credit {
  const person: EntityRef = {
    kind: 'person',
    id: row.personId,
    title: row.personName,
    canonicalUrl:
      row.personSlug === null ? null : canonicalUrlFor(siteOrigin, 'person', row.personSlug),
  }
  return {
    person,
    character: row.character,
    job: row.job,
    department: row.department,
  }
}

/** Ordena elenco por billing (nulls por ultimo, ordem estavel). */
function sortCast(rows: readonly CreditRow[]): CreditRow[] {
  return [...rows].sort((a, b) => {
    const oa = a.billingOrder ?? Number.MAX_SAFE_INTEGER
    const ob = b.billingOrder ?? Number.MAX_SAFE_INTEGER
    return oa - ob
  })
}

/** MediaRows crus -> MediaPayload do contrato (fail-closed no builder). */
function mapMedia(media: MediaRows, alt: string): MediaPayload {
  return buildMediaPayload({ images: [...media.images], videos: [...media.videos], alt })
}

/** Filme -> MovieDetailPayload validado. */
export function mapMovieDetail(row: MovieSourceRow, options: MapOptions): MovieDetailPayload {
  const title = row.translation?.title ?? row.titleOriginal
  const canonicalUrl = canonicalUrlFor(options.siteOrigin, 'movie', row.slug)

  const payload: MovieDetailPayload = {
    kind: 'movie',
    id: row.id,
    canonicalUrl,
    title,
    originalTitle: row.titleOriginal === title ? null : row.titleOriginal,
    aliases: row.aliases,
    overview: row.translation?.summary ?? null,
    releaseDate: toIsoDate(row.releaseDate),
    year: yearOf(row.releaseDate),
    runtimeMinutes: row.runtimeMinutes,
    certification: row.certification,
    // O schema ainda nao vincula entidade<->genero (existe so o dicionario
    // `genres`). Lista vazia e o estado HONESTO; nunca inventar taxonomia.
    genres: [],
    cast: sortCast(row.cast).map((c) => mapCredit(c, options.siteOrigin)),
    crew: row.crew.map((c) => mapCredit(c, options.siteOrigin)),
    collection:
      row.collection === null
        ? null
        : {
            kind: 'collection',
            id: row.collection.id,
            title: row.collection.name,
            // Colecao ainda nao tem pagina publica: sem rota, sem URL.
            canonicalUrl: null,
          },
    media: mapMedia(row.media, title),
    ratings: row.ratings.map((r) => ({
      source: r.source,
      label: r.label,
      value: r.value,
      scale: r.scale,
      url: r.url,
      attributionText: r.attributionText,
      attributionUrl: r.attributionUrl,
    })),
    streaming: row.streaming.map((s) => ({
      provider: s.provider,
      offerType: s.offerType,
      country: s.country,
      url: s.url,
    })),
    seo: buildSeo(
      canonicalUrl,
      options,
      row.translation?.metaTitle ?? null,
      row.translation?.metaDescription ?? null,
    ),
  }

  return unwrap(validateMovieDetail(payload), `MovieDetailPayload(${row.id})`)
}

/** Serie -> TvDetailPayload validado. */
export function mapTvDetail(row: TvSourceRow, options: MapOptions): TvDetailPayload {
  const title = row.translation?.title ?? row.nameOriginal
  const canonicalUrl = canonicalUrlFor(options.siteOrigin, 'tv', row.slug)

  const payload: TvDetailPayload = {
    kind: 'tv',
    id: row.id,
    canonicalUrl,
    title,
    originalTitle: row.nameOriginal === title ? null : row.nameOriginal,
    aliases: row.aliases,
    overview: row.translation?.summary ?? null,
    firstAirDate: toIsoDate(row.firstAirDate),
    lastAirDate: toIsoDate(row.lastAirDate),
    year: yearOf(row.firstAirDate),
    numberOfSeasons: row.numberOfSeasons,
    numberOfEpisodes: row.numberOfEpisodes,
    certification: row.certification,
    genres: [],
    cast: sortCast(row.cast).map((c) => mapCredit(c, options.siteOrigin)),
    seasons: [...row.seasons]
      .sort((a, b) => a.seasonNumber - b.seasonNumber)
      .map((s) => ({
        id: s.id,
        seasonNumber: s.seasonNumber,
        name: s.name,
        episodeCount: s.episodeCount,
        canonicalUrl: seasonCanonicalUrl(options.siteOrigin, row.slug, s.seasonNumber),
      })),
    media: mapMedia(row.media, title),
    ratings: row.ratings.map((r) => ({ ...r })),
    streaming: row.streaming.map((s) => ({ ...s })),
    seo: buildSeo(
      canonicalUrl,
      options,
      row.translation?.metaTitle ?? null,
      row.translation?.metaDescription ?? null,
    ),
  }

  return unwrap(validateTvDetail(payload), `TvDetailPayload(${row.id})`)
}

/** Temporada -> SeasonDetailPayload validado. */
export function mapSeasonDetail(row: SeasonSourceRow, options: MapOptions): SeasonDetailPayload {
  const canonicalUrl = seasonCanonicalUrl(options.siteOrigin, row.series.slug, row.seasonNumber)
  const alt = row.name ?? `${row.series.title} — Temporada ${row.seasonNumber}`

  const payload: SeasonDetailPayload = {
    kind: 'season',
    id: row.id,
    canonicalUrl,
    series: {
      kind: 'tv',
      id: row.series.id,
      title: row.series.title,
      canonicalUrl: canonicalUrlFor(options.siteOrigin, 'tv', row.series.slug),
    },
    seasonNumber: row.seasonNumber,
    name: row.name,
    overview: row.overview,
    airDate: toIsoDate(row.airDate),
    episodes: [...row.episodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((e) => ({
        id: e.id,
        episodeNumber: e.episodeNumber,
        name: e.name,
        airDate: toIsoDate(e.airDate),
        canonicalUrl: episodeCanonicalUrl(
          options.siteOrigin,
          row.series.slug,
          row.seasonNumber,
          e.episodeNumber,
        ),
      })),
    media: mapMedia(row.media, alt),
    seo: buildSeo(canonicalUrl, options, null, null),
  }

  return unwrap(validateSeasonDetail(payload), `SeasonDetailPayload(${row.id})`)
}

/** Episodio -> EpisodeDetailPayload validado. */
export function mapEpisodeDetail(row: EpisodeSourceRow, options: MapOptions): EpisodeDetailPayload {
  const canonicalUrl = episodeCanonicalUrl(
    options.siteOrigin,
    row.series.slug,
    row.seasonNumber,
    row.episodeNumber,
  )
  const alt = row.name ?? `${row.series.title} S${row.seasonNumber}E${row.episodeNumber}`

  const payload: EpisodeDetailPayload = {
    kind: 'episode',
    id: row.id,
    canonicalUrl,
    series: {
      kind: 'tv',
      id: row.series.id,
      title: row.series.title,
      canonicalUrl: canonicalUrlFor(options.siteOrigin, 'tv', row.series.slug),
    },
    seasonNumber: row.seasonNumber,
    episodeNumber: row.episodeNumber,
    name: row.name,
    overview: row.overview,
    airDate: toIsoDate(row.airDate),
    runtimeMinutes: row.runtimeMinutes,
    media: mapMedia(row.media, alt),
    seo: buildSeo(canonicalUrl, options, null, null),
  }

  return unwrap(validateEpisodeDetail(payload), `EpisodeDetailPayload(${row.id})`)
}

/** Pessoa -> PersonDetailPayload validado. */
export function mapPersonDetail(row: PersonSourceRow, options: MapOptions): PersonDetailPayload {
  const canonicalUrl = canonicalUrlFor(options.siteOrigin, 'person', row.slug)

  const payload: PersonDetailPayload = {
    kind: 'person',
    id: row.id,
    canonicalUrl,
    name: row.name,
    roleLabel: row.knownForDepartment,
    birthday: toIsoDate(row.birthday),
    deathday: toIsoDate(row.deathday),
    placeOfBirth: row.placeOfBirth,
    biography: row.biography,
    credits: row.credits.map((c) => mapCredit(c, options.siteOrigin)),
    media: mapMedia(row.media, row.name),
    seo: buildSeo(canonicalUrl, options, null, null),
  }

  return unwrap(validatePersonDetail(payload), `PersonDetailPayload(${row.id})`)
}

/** Card -> EntityCard (poster resolvido pelo helper canonico; sem file_path cru). */
export function mapCard(row: CardSourceRow, options: MapOptions): EntityCard {
  const posterUrl = buildTmdbImageUrl(row.posterPath, 'w500')
  return {
    kind: row.kind,
    id: row.id,
    title: row.title,
    href: canonicalUrlFor(options.siteOrigin, row.kind, row.slug),
    subtitle: null,
    year: row.year,
    image:
      posterUrl === null
        ? null
        : {
            id: `${row.kind}:${row.id}:poster`,
            kind: 'poster',
            language: null,
            width: null,
            height: null,
            aspectRatio: null,
            source: 'tmdb',
            displayAllowed: true,
            url: posterUrl,
            alt: row.title,
          },
    screenScore: row.screenScore,
  }
}

/** Home -> HomePayload validado. */
export function mapHome(
  input: {
    readonly hero: readonly CardSourceRow[]
    readonly trending: readonly CardSourceRow[]
    readonly upcoming: readonly CardSourceRow[]
  },
  options: MapOptions,
): HomePayload {
  const payload: HomePayload = {
    locale: options.locale,
    hero: input.hero.map((c) => mapCard(c, options)),
    trending: input.trending.map((c) => mapCard(c, options)),
    upcoming: input.upcoming.map((c) => mapCard(c, options)),
  }
  return unwrap(validateHomePayload(payload), 'HomePayload')
}

/** Snapshot de descoberta -> DiscoveryPayload validado. */
export function mapDiscovery(
  input: {
    readonly listType: string
    readonly entityType: 'movie' | 'tv'
    readonly country: string | null
    readonly capturedAt: Date | null
    readonly items: readonly CardSourceRow[]
  },
  options: MapOptions,
): DiscoveryPayload {
  const payload: DiscoveryPayload = {
    listType: input.listType,
    entityType: input.entityType,
    locale: options.locale,
    country: input.country,
    capturedAt: toIsoInstant(input.capturedAt),
    items: input.items.map((c) => mapCard(c, options)),
  }
  return unwrap(validateDiscoveryPayload(payload), `DiscoveryPayload(${input.listType})`)
}

/** Resultados de busca -> SearchPayload validado (superficie sempre noindex). */
export function mapSearch(
  input: {
    readonly query: string
    readonly rows: readonly SearchSourceRow[]
    readonly limit: number
    readonly offset: number
  },
  options: MapOptions,
): SearchPayload {
  const results: SearchResult[] = []
  for (const row of input.rows) {
    // Documento sem canonicalUrl apontaria para 404: descartado (fail-closed),
    // mesma regra do presenter da rota /pt/busca.
    if (row.canonicalUrl === null) continue
    const imageUrl = buildTmdbImageUrl(row.imagePath, 'w300')
    results.push({
      entityId: row.entityId,
      type: row.entityType,
      title: row.title,
      subtitle: row.subtitle,
      year: row.year,
      image:
        imageUrl === null
          ? null
          : {
              id: `${row.entityType}:${row.entityId}:poster`,
              kind: 'poster',
              language: null,
              width: null,
              height: null,
              aspectRatio: null,
              source: 'tmdb',
              displayAllowed: true,
              url: imageUrl,
              alt: row.title,
            },
      canonicalUrl: `${options.siteOrigin}${row.canonicalUrl}`,
      matchReason: row.matchReason,
      score: row.score,
    })
  }
  const payload: SearchPayload = {
    query: input.query,
    locale: options.locale,
    results,
    total: results.length,
    limit: input.limit,
    offset: input.offset,
    // Invariante da superficie de busca: pagina de resultado NUNCA indexa.
    index: false,
  }
  return unwrap(validateSearchPayload(payload), 'SearchPayload')
}

/** Fila -> CatalogStatusPayload validado. */
export function mapCatalogStatus(
  input: {
    readonly counts: Readonly<Partial<Record<CatalogJobSourceRow['status'], number>>>
    readonly deadLetter: readonly CatalogJobSourceRow[]
  },
): CatalogStatusPayload {
  const toView = (row: CatalogJobSourceRow): CatalogJobView => ({
    id: row.id,
    jobType: row.jobType,
    status: row.status,
    entityType: row.entityType,
    externalId: row.externalId,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    priority: row.priority,
    availableAt: toIsoInstant(row.availableAt),
    lastErrorCode: row.lastErrorCode,
    lastErrorSafe: row.lastErrorSafe,
  })

  const payload: CatalogStatusPayload = {
    counts: {
      pending: input.counts.pending ?? 0,
      claimed: input.counts.claimed ?? 0,
      running: input.counts.running ?? 0,
      retry_wait: input.counts.retry_wait ?? 0,
      succeeded: input.counts.succeeded ?? 0,
      failed: input.counts.failed ?? 0,
      dead_letter: input.counts.dead_letter ?? 0,
      cancelled: input.counts.cancelled ?? 0,
    },
    deadLetter: input.deadLetter.map(toView),
  }
  return unwrap(validateCatalogStatusPayload(payload), 'CatalogStatusPayload')
}

/** Midia avulsa -> MediaPayload (getter dedicado getMediaPayload). */
export function mapMediaPayload(media: MediaRows, alt: string): MediaPayload {
  return mapMedia(media, alt)
}
