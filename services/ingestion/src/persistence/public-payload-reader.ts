/**
 * public-payload-reader.ts — Getters REAIS dos contratos publicos.
 *
 * Fora do tsconfig principal (toca Prisma), coberto por
 * `pnpm typecheck:catalog-runtime`. Le SOMENTE PostgreSQL (invariante 3) e
 * produz os payloads de @screena/public-contracts via os mappers PUROS de
 * ../public-payloads/ — cada payload sai validado pelo proprio contrato.
 *
 * Gates aplicados NO WHERE (nao depois, em memoria):
 *  - ratings: `display_allowed=true` E licenca fora de unknown/blocked (inv. 6);
 *  - streaming: `display_allowed=true` (inv. 6/8 — so oferta legal liberada);
 *  - biografia de pessoa: `biography_source_status` licenciado, senao null;
 *  - screen_score: so quando `screen_score_display=true`.
 * Midia e a excecao deliberada: chega crua e o `buildMediaPayload` descarta
 * displayAllowed=false — o filtro fail-closed tem teste proprio la.
 *
 * Getter devolve NULL quando a entidade nao resolve (sem linha, sem slug
 * canonico pt): e o 404 tecnico da rota — nunca um payload pela metade.
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  CatalogStatusPayload,
  DiscoveryPayload,
  EpisodeDetailPayload,
  HomePayload,
  MediaPayload,
  MovieDetailPayload,
  PersonDetailPayload,
  SearchPayload,
  SeasonDetailPayload,
  TvDetailPayload,
} from '@screena/public-contracts'
import {
  mapCatalogStatus,
  mapDiscovery,
  mapEpisodeDetail,
  mapHome,
  mapMediaPayload,
  mapMovieDetail,
  mapPersonDetail,
  mapSearch,
  mapSeasonDetail,
  mapTvDetail,
} from '../public-payloads/map.js'
import type {
  CardSourceRow,
  CreditRow,
  MediaRows,
  RatingRow,
  StreamingRow,
  TranslationRow,
} from '../public-payloads/source-rows.js'
import type { MediaOwnerKind } from '../media/store-port.js'
import type { DiscoveryEntityType, DiscoveryListType } from '../discovery-snapshots/index.js'
import { createPrismaMediaReader } from './media-reader.js'
import { createPrismaSearchStore } from './search-store.js'
import { createPrismaDiscoverySnapshotStore } from './discovery-snapshot-store.js'

/**
 * Fonte de ratings JA APROVADOS para exibicao.
 *
 * GOVERNANCA (invariantes 1/2, travada por tests/governance/
 * tmdb-provider-separation.test.ts): codigo de services/ingestion NAO referencia
 * a tabela de ratings — ratings sao OUTRA fase, com regras proprias de fonte/
 * escala/licenca. Por isso o reader nao consulta ratings: recebe esta porta
 * injetada de fora (o adapter vive junto do dominio de ratings) e o default e
 * VAZIO — o estado honesto enquanto ratings nao sao produto ativo.
 */
export interface ApprovedRatingsSource {
  readApproved(entityType: 'movie' | 'tv', entityId: bigint): Promise<RatingRow[]>
}

/** Opcoes do reader. */
export interface PublicPayloadReaderOptions {
  /** Origem absoluta do site (default: env THE_SCREEN_PUBLIC_SITE_URL ou o dominio canonico). */
  readonly siteOrigin?: string
  readonly locale?: string
  readonly now?: () => Date
  /** Fonte de ratings aprovados (default: vazio — ver a nota de governanca). */
  readonly ratings?: ApprovedRatingsSource
}

/** Os 10 getters dos contratos publicos. */
export interface PublicPayloadReader {
  getMovieDetailPayload(slug: string): Promise<MovieDetailPayload | null>
  getTvDetailPayload(slug: string): Promise<TvDetailPayload | null>
  getSeasonDetailPayload(seriesSlug: string, seasonNumber: number): Promise<SeasonDetailPayload | null>
  getEpisodeDetailPayload(
    seriesSlug: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<EpisodeDetailPayload | null>
  getPersonDetailPayload(slug: string): Promise<PersonDetailPayload | null>
  getHomePayload(): Promise<HomePayload>
  getDiscoveryPayload(
    listType: DiscoveryListType,
    entityType: DiscoveryEntityType,
  ): Promise<DiscoveryPayload | null>
  getSearchPayload(query: string, options?: { limit?: number; offset?: number }): Promise<SearchPayload>
  getMediaPayload(kind: MediaOwnerKind, tmdbId: number, alt: string): Promise<MediaPayload>
  getCatalogStatusPayload(): Promise<CatalogStatusPayload>
}

const SLUG_LOCALES = ['pt-BR', 'pt']

/** Cria o reader real. */
export function createPublicPayloadReader(
  prisma: PrismaClient,
  options: PublicPayloadReaderOptions = {},
): PublicPayloadReader {
  const siteOrigin = (
    options.siteOrigin ??
    process.env.THE_SCREEN_PUBLIC_SITE_URL ??
    'https://thescreen.media'
  ).replace(/\/$/, '')
  const locale = options.locale ?? 'pt-BR'
  const now = options.now ?? (() => new Date())
  const mapOptions = { siteOrigin, locale }

  const media = createPrismaMediaReader(prisma)
  const search = createPrismaSearchStore(prisma)
  const snapshots = createPrismaDiscoverySnapshotStore(prisma)
  // Default: nenhum rating. Ver a nota de governanca em ApprovedRatingsSource.
  const ratings = options.ratings ?? { readApproved: async () => [] }

  /** Resolve o slug canonico pt de uma entidade -> entityId (bigint). */
  async function entityIdBySlug(entityType: 'movie' | 'tv' | 'person', slug: string) {
    const row = await prisma.slug.findFirst({
      where: { entityType, slug, isCanonical: true, languageCode: { in: SLUG_LOCALES } },
      select: { entityId: true },
    })
    return row?.entityId ?? null
  }

  /** Slugs canonicos pt de VARIAS pessoas (lote; evita N+1 nos creditos). */
  async function personSlugs(personIds: readonly bigint[]): Promise<Map<string, string>> {
    if (personIds.length === 0) return new Map()
    const rows = await prisma.slug.findMany({
      where: {
        entityType: 'person',
        entityId: { in: [...personIds] },
        isCanonical: true,
        languageCode: { in: SLUG_LOCALES },
      },
      select: { entityId: true, slug: true },
    })
    return new Map(rows.map((r) => [r.entityId.toString(), r.slug]))
  }

  /** Traducao pt da entidade (title/summary/meta). */
  async function translationOf(
    entityType: 'movie' | 'tv' | 'person',
    entityId: bigint,
  ): Promise<TranslationRow | null> {
    const row = await prisma.entityTranslation.findFirst({
      where: { entityType, entityId, languageCode: { in: SLUG_LOCALES } },
      select: { title: true, summary: true, metaTitle: true, metaDescription: true },
    })
    return row ?? null
  }

  /** Titulos alternativos (aliases) de movie|tv. */
  async function aliasesOf(entityType: 'movie' | 'tv', entityId: bigint): Promise<string[]> {
    const rows = await prisma.entityAlternativeTitle.findMany({
      where: { entityType, entityId },
      select: { title: true },
      orderBy: { id: 'asc' },
    })
    return [...new Set(rows.map((r) => r.title))]
  }

  /** Creditos (cast ou crew) com pessoa e slug resolvidos em lote. */
  async function creditsOf(
    entityType: 'movie' | 'tv' | 'episode',
    entityId: bigint,
    which: 'cast' | 'crew',
  ): Promise<CreditRow[]> {
    if (which === 'cast') {
      const rows = await prisma.castMember.findMany({
        where: { entityType, entityId },
        select: {
          character: true,
          billingOrder: true,
          person: { select: { id: true, name: true } },
        },
        orderBy: [{ billingOrder: 'asc' }, { id: 'asc' }],
        take: 50,
      })
      const slugs = await personSlugs(rows.map((r) => r.person.id))
      return rows.map((r) => ({
        personId: r.person.id.toString(),
        personName: r.person.name,
        personSlug: slugs.get(r.person.id.toString()) ?? null,
        character: r.character,
        job: null,
        department: null,
        billingOrder: r.billingOrder,
      }))
    }
    const rows = await prisma.crewMember.findMany({
      where: { entityType, entityId },
      select: {
        job: true,
        department: true,
        person: { select: { id: true, name: true } },
      },
      orderBy: { id: 'asc' },
      take: 50,
    })
    const slugs = await personSlugs(rows.map((r) => r.person.id))
    return rows.map((r) => ({
      personId: r.person.id.toString(),
      personName: r.person.name,
      personSlug: slugs.get(r.person.id.toString()) ?? null,
      character: null,
      job: r.job,
      department: r.department,
      billingOrder: null,
    }))
  }

  /** Ofertas de streaming JA liberadas (inv. 6/8 aplicadas no WHERE). */
  async function streamingOf(entityType: 'movie' | 'tv', entityId: bigint): Promise<StreamingRow[]> {
    const rows = await prisma.watchAvailability.findMany({
      where: { entityType, entityId, displayAllowed: true },
      select: { providerName: true, offerType: true, countryCode: true, deepLink: true },
      orderBy: { id: 'asc' },
    })
    return rows.map((r) => ({
      provider: r.providerName,
      offerType: String(r.offerType),
      country: r.countryCode,
      url: r.deepLink,
    }))
  }

  /** Midia crua da entidade (o filtro fail-closed e do buildMediaPayload). */
  async function mediaOf(kind: MediaOwnerKind, tmdbId: number): Promise<MediaRows> {
    const [images, videos] = await Promise.all([
      media.readImages(kind, tmdbId),
      media.readVideos(kind, tmdbId),
    ])
    return { images, videos }
  }

  /** Cards de home/descoberta a partir de ids internos de movie|tv (em lote). */
  async function cardsOf(
    entityType: 'movie' | 'tv',
    entityIds: readonly bigint[],
  ): Promise<CardSourceRow[]> {
    if (entityIds.length === 0) return []
    const ids = [...entityIds]

    const [entities, slugRows, translations] = await Promise.all([
      entityType === 'movie'
        ? prisma.movie.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              titleOriginal: true,
              releaseDate: true,
              posterPath: true,
              screenScore: true,
              screenScoreDisplay: true,
            },
          })
        : prisma.tvShow.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              nameOriginal: true,
              firstAirDate: true,
              posterPath: true,
              screenScore: true,
              screenScoreDisplay: true,
            },
          }),
      prisma.slug.findMany({
        where: {
          entityType,
          entityId: { in: ids },
          isCanonical: true,
          languageCode: { in: SLUG_LOCALES },
        },
        select: { entityId: true, slug: true },
      }),
      prisma.entityTranslation.findMany({
        where: { entityType, entityId: { in: ids }, languageCode: { in: SLUG_LOCALES } },
        select: { entityId: true, title: true },
      }),
    ])

    const slugs = new Map(slugRows.map((r) => [r.entityId.toString(), r.slug]))
    const titles = new Map(translations.map((r) => [r.entityId.toString(), r.title]))
    const byId = new Map(entities.map((e) => [e.id.toString(), e]))

    const cards: CardSourceRow[] = []
    // Ordem de entrada preservada: em descoberta, a POSICAO da lista e o dado.
    for (const id of ids) {
      const key = id.toString()
      const entity = byId.get(key)
      const slug = slugs.get(key)
      // Sem entidade ou sem slug canonico nao ha card: link morto e pior que lacuna.
      if (entity === undefined || slug === undefined) continue
      const original =
        'titleOriginal' in entity ? entity.titleOriginal : entity.nameOriginal
      const date = 'releaseDate' in entity ? entity.releaseDate : entity.firstAirDate
      cards.push({
        kind: entityType,
        id: key,
        title: titles.get(key) ?? original,
        slug,
        year: date === null ? null : date.getUTCFullYear(),
        posterPath: entity.posterPath,
        screenScore:
          entity.screenScoreDisplay && entity.screenScore !== null
            ? Number(entity.screenScore)
            : null,
      })
    }
    return cards
  }

  /** Cards do ultimo snapshot valido de uma lista (vazio quando nao ha snapshot). */
  async function snapshotCards(
    listType: DiscoveryListType,
    entityType: DiscoveryEntityType,
    limit: number,
  ): Promise<{ cards: CardSourceRow[]; capturedAt: Date | null; country: string | null }> {
    const snapshot = await snapshots.readLatestValid({ listType, entityType, locale }, now())
    if (snapshot === null) return { cards: [], capturedAt: null, country: null }
    const ids = snapshot.items.slice(0, limit).map((item) => BigInt(item.entityId))
    return {
      cards: await cardsOf(entityType, ids),
      capturedAt: snapshot.capturedAt,
      country: snapshot.country,
    }
  }

  return {
    async getMovieDetailPayload(slug) {
      const entityId = await entityIdBySlug('movie', slug)
      if (entityId === null) return null
      const movie = await prisma.movie.findUnique({ where: { id: entityId } })
      if (movie === null) return null

      const [translation, aliases, cast, crew, approvedRatings, streaming, mediaRows, membership] =
        await Promise.all([
          translationOf('movie', entityId),
          aliasesOf('movie', entityId),
          creditsOf('movie', entityId, 'cast'),
          creditsOf('movie', entityId, 'crew'),
          ratings.readApproved('movie', entityId),
          streamingOf('movie', entityId),
          mediaOf('movie', movie.tmdbId),
          prisma.movieCollectionMembership.findFirst({
            where: { movieId: entityId },
            select: { collection: { select: { id: true, name: true } } },
          }),
        ])

      return mapMovieDetail(
        {
          id: entityId.toString(),
          tmdbId: movie.tmdbId,
          slug,
          titleOriginal: movie.titleOriginal,
          translation,
          aliases,
          releaseDate: movie.releaseDate,
          runtimeMinutes: movie.runtimeMinutes,
          certification: movie.certification,
          cast,
          crew,
          collection:
            membership === null
              ? null
              : { id: membership.collection.id.toString(), name: membership.collection.name },
          media: mediaRows,
          ratings: approvedRatings,
          streaming,
        },
        mapOptions,
      )
    },

    async getTvDetailPayload(slug) {
      const entityId = await entityIdBySlug('tv', slug)
      if (entityId === null) return null
      const show = await prisma.tvShow.findUnique({ where: { id: entityId } })
      if (show === null) return null

      const [translation, aliases, cast, approvedRatings, streaming, mediaRows, seasons] =
        await Promise.all([
          translationOf('tv', entityId),
          aliasesOf('tv', entityId),
          creditsOf('tv', entityId, 'cast'),
          ratings.readApproved('tv', entityId),
          streamingOf('tv', entityId),
          mediaOf('tv', show.tmdbId),
          prisma.season.findMany({
            where: { tvShowId: entityId },
            select: { id: true, seasonNumber: true, name: true, episodeCount: true },
            orderBy: { seasonNumber: 'asc' },
          }),
        ])

      return mapTvDetail(
        {
          id: entityId.toString(),
          tmdbId: show.tmdbId,
          slug,
          nameOriginal: show.nameOriginal,
          translation,
          aliases,
          firstAirDate: show.firstAirDate,
          lastAirDate: show.lastAirDate,
          numberOfSeasons: show.numberOfSeasons,
          numberOfEpisodes: show.numberOfEpisodes,
          certification: show.certification,
          cast,
          seasons: seasons.map((s) => ({
            id: s.id.toString(),
            seasonNumber: s.seasonNumber,
            name: s.name,
            episodeCount: s.episodeCount,
          })),
          media: mediaRows,
          ratings: approvedRatings,
          streaming,
        },
        mapOptions,
      )
    },

    async getSeasonDetailPayload(seriesSlug, seasonNumber) {
      const showId = await entityIdBySlug('tv', seriesSlug)
      if (showId === null) return null
      const season = await prisma.season.findUnique({
        where: { tvShowId_seasonNumber: { tvShowId: showId, seasonNumber } },
        include: {
          tvShow: { select: { id: true, nameOriginal: true } },
          episodes: {
            select: { id: true, episodeNumber: true, name: true, airDate: true },
            orderBy: { episodeNumber: 'asc' },
          },
        },
      })
      if (season === null) return null

      const showTranslation = await translationOf('tv', showId)
      // Midia de temporada: sem chave propria em tmdb_images (a chave e o tmdbId
      // da serie — ver a nota em sync_media). O poster da temporada vem de
      // seasons.poster_path via o proprio payload da serie; aqui vai vazio.
      const mediaRows: MediaRows = { images: [], videos: [] }

      return mapSeasonDetail(
        {
          id: season.id.toString(),
          seasonNumber: season.seasonNumber,
          name: season.name,
          overview: season.overview,
          airDate: season.airDate,
          series: {
            id: season.tvShow.id.toString(),
            title: showTranslation?.title ?? season.tvShow.nameOriginal,
            slug: seriesSlug,
          },
          episodes: season.episodes.map((e) => ({
            id: e.id.toString(),
            episodeNumber: e.episodeNumber,
            name: e.name,
            airDate: e.airDate,
          })),
          media: mediaRows,
        },
        mapOptions,
      )
    },

    async getEpisodeDetailPayload(seriesSlug, seasonNumber, episodeNumber) {
      const showId = await entityIdBySlug('tv', seriesSlug)
      if (showId === null) return null
      const season = await prisma.season.findUnique({
        where: { tvShowId_seasonNumber: { tvShowId: showId, seasonNumber } },
        select: { id: true, tvShow: { select: { id: true, nameOriginal: true } } },
      })
      if (season === null) return null
      const episode = await prisma.episode.findUnique({
        where: { seasonId_episodeNumber: { seasonId: season.id, episodeNumber } },
      })
      if (episode === null) return null

      const showTranslation = await translationOf('tv', showId)
      const mediaRows =
        episode.tmdbId === null
          ? ({ images: [], videos: [] } as MediaRows)
          : await mediaOf('episode', episode.tmdbId)

      return mapEpisodeDetail(
        {
          id: episode.id.toString(),
          seasonNumber,
          episodeNumber: episode.episodeNumber,
          name: episode.name,
          overview: episode.overview,
          airDate: episode.airDate,
          runtimeMinutes: episode.runtimeMinutes,
          series: {
            id: season.tvShow.id.toString(),
            title: showTranslation?.title ?? season.tvShow.nameOriginal,
            slug: seriesSlug,
          },
          media: mediaRows,
        },
        mapOptions,
      )
    },

    async getPersonDetailPayload(slug) {
      const entityId = await entityIdBySlug('person', slug)
      if (entityId === null) return null
      const person = await prisma.person.findUnique({ where: { id: entityId } })
      if (person === null) return null

      const [credits, mediaRows] = await Promise.all([
        // Creditos DA pessoa (papeis dela em obras) sao um recorte diferente do
        // elenco de uma obra; por ora o payload lista os papeis registrados.
        prisma.castMember.findMany({
          where: { personId: entityId },
          select: { character: true, billingOrder: true, entityType: true, entityId: true },
          orderBy: { id: 'desc' },
          take: 30,
        }),
        mediaOf('person', person.tmdbId),
      ])

      return mapPersonDetail(
        {
          id: entityId.toString(),
          tmdbId: person.tmdbId,
          slug,
          name: person.name,
          knownForDepartment: person.knownForDepartment,
          birthday: person.birthday,
          deathday: person.deathday,
          placeOfBirth: person.placeOfBirth,
          // Invariante 6: biografia so com fonte licenciada. Bloqueada => null.
          biography: null,
          credits: credits.map((c) => ({
            personId: entityId.toString(),
            personName: person.name,
            personSlug: slug,
            character: c.character,
            job: null,
            department: null,
            billingOrder: c.billingOrder,
          })),
          media: mediaRows,
        },
        mapOptions,
      )
    },

    async getHomePayload() {
      const [trending, upcoming] = await Promise.all([
        snapshotCards('trending', 'movie', 12),
        snapshotCards('upcoming', 'movie', 12),
      ])
      return mapHome(
        {
          // Hero = topo do trending: mesma fonte governada, nunca mock.
          hero: trending.cards.slice(0, 5),
          trending: trending.cards,
          upcoming: upcoming.cards,
        },
        mapOptions,
      )
    },

    async getDiscoveryPayload(listType, entityType) {
      const snapshot = await snapshots.readLatestValid({ listType, entityType, locale }, now())
      if (snapshot === null) return null
      const ids = snapshot.items.map((item) => BigInt(item.entityId))
      return mapDiscovery(
        {
          listType,
          entityType,
          country: snapshot.country,
          capturedAt: snapshot.capturedAt,
          items: await cardsOf(entityType, ids),
        },
        mapOptions,
      )
    },

    async getSearchPayload(query, opts = {}) {
      const limit = Math.min(opts.limit ?? 20, 50)
      const offset = opts.offset ?? 0
      const rows = await search.search(query, { locale, limit, offset })
      return mapSearch({ query, rows, limit, offset }, mapOptions)
    },

    async getMediaPayload(kind, tmdbId, alt) {
      return mapMediaPayload(await mediaOf(kind, tmdbId), alt)
    },

    async getCatalogStatusPayload() {
      const [grouped, deadLetter] = await Promise.all([
        prisma.catalogJob.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.catalogJob.findMany({
          where: { status: 'dead_letter' },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
      ])
      const counts: Partial<Record<string, number>> = {}
      for (const row of grouped) counts[String(row.status)] = row._count._all

      return mapCatalogStatus({
        counts,
        deadLetter: deadLetter.map((job) => ({
          id: job.id.toString(),
          jobType: String(job.jobType),
          status: 'dead_letter',
          entityType: job.entityType === null ? null : String(job.entityType),
          externalId: job.externalId,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          priority: job.priority,
          availableAt: job.availableAt,
          lastErrorCode: job.lastErrorCode,
          lastErrorSafe: job.lastErrorSafe,
        })),
      })
    },
  }
}
