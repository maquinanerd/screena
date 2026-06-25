/**
 * store.ts — Adapter de persistencia de entidades (Prisma). EXCLUIDO do typecheck.
 *
 * Upserts idempotentes por chave natural; creditos por "replace-set" em
 * transacao (remove os antigos da entidade e reinsere); `touch*` via SQL bruto
 * (NAO bumpa `updated_at` — honra o short-circuit de hash).
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  EntityStorePort,
  SeasonUpsertOutcome,
  StoreMovieInput,
  StorePersonInput,
  StoreSeasonInput,
  StoreTvShowInput,
  SyncTimestamps,
  UpsertOutcome,
} from '../ports.js'
import type { CastMemberInput, CrewMemberInput, ExternalIdInput, PersonStub } from '../types.js'

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

type CreditEntityType = 'movie' | 'tv'

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value)
}

async function replaceExternalIds(
  tx: Tx,
  entityType: 'movie' | 'tv' | 'person',
  entityId: bigint,
  ids: readonly ExternalIdInput[],
): Promise<void> {
  await tx.entityExternalId.deleteMany({ where: { entityType, entityId } })
  if (ids.length > 0) {
    // SEM skipDuplicates: um conflito no unique (source, external_id) significa
    // que OUTRA entidade ja reivindica esse id externo — isso e um problema de
    // integridade que deve FALHAR/aparecer (e reverter a transacao), nunca ser
    // mascarado silenciosamente. (O delete acima ja limpou os ids desta entidade.)
    await tx.entityExternalId.createMany({
      data: ids.map((id) => ({
        entityType,
        entityId,
        source: id.source,
        externalId: id.externalId,
        url: id.url,
      })),
    })
  }
}

async function upsertPeopleStubs(
  tx: Tx,
  stubs: readonly PersonStub[],
  lastSyncedAt: Date,
): Promise<Map<number, bigint>> {
  const unique = new Map<number, PersonStub>()
  for (const stub of stubs) {
    if (!unique.has(stub.tmdbId)) unique.set(stub.tmdbId, stub)
  }

  for (const stub of unique.values()) {
    // Em update so preenche campos nao-nulos do credito (nao rebaixa pessoa rica).
    const update: Record<string, unknown> = {}
    if (stub.name !== '') update.name = stub.name
    if (stub.knownForDepartment !== null) update.knownForDepartment = stub.knownForDepartment
    if (stub.gender !== null) update.gender = stub.gender
    if (stub.profilePath !== null) update.profilePath = stub.profilePath

    await tx.person.upsert({
      where: { tmdbId: stub.tmdbId },
      create: {
        tmdbId: stub.tmdbId,
        name: stub.name,
        knownForDepartment: stub.knownForDepartment,
        gender: stub.gender,
        profilePath: stub.profilePath,
        lastSyncedAt,
      },
      update,
    })
  }

  const rows = await tx.person.findMany({
    where: { tmdbId: { in: [...unique.keys()] } },
    select: { id: true, tmdbId: true },
  })
  return new Map(rows.map((row) => [row.tmdbId, row.id]))
}

async function replaceCredits(
  tx: Tx,
  entityType: CreditEntityType,
  entityId: bigint,
  cast: readonly CastMemberInput[],
  crew: readonly CrewMemberInput[],
  lastSyncedAt: Date,
): Promise<void> {
  const stubs: PersonStub[] = [...cast.map((c) => c.person), ...crew.map((c) => c.person)]
  const idByTmdb = await upsertPeopleStubs(tx, stubs, lastSyncedAt)

  await tx.castMember.deleteMany({ where: { entityType, entityId } })
  await tx.crewMember.deleteMany({ where: { entityType, entityId } })

  const castData = cast
    .map((credit) => {
      const personId = idByTmdb.get(credit.personTmdbId)
      if (personId === undefined) return undefined
      return {
        personId,
        entityType,
        entityId,
        character: credit.character,
        billingOrder: credit.billingOrder,
        creditId: credit.creditId,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
  if (castData.length > 0) {
    await tx.castMember.createMany({ data: castData, skipDuplicates: true })
  }

  const crewData = crew
    .map((credit) => {
      const personId = idByTmdb.get(credit.personTmdbId)
      if (personId === undefined) return undefined
      return {
        personId,
        entityType,
        entityId,
        department: credit.department,
        job: credit.job,
        creditId: credit.creditId,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== undefined)
  if (crewData.length > 0) {
    await tx.crewMember.createMany({ data: crewData, skipDuplicates: true })
  }
}

/** Cria um `EntityStorePort` apoiado no Prisma. */
export function createPrismaStore(prisma: PrismaClient): EntityStorePort {
  return {
    async upsertMovie(input: StoreMovieInput): Promise<UpsertOutcome> {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.movie.findUnique({
          where: { tmdbId: input.movie.tmdbId },
          select: { id: true },
        })
        const data = {
          imdbId: input.movie.imdbId,
          titleOriginal: input.movie.titleOriginal,
          originalLanguage: input.movie.originalLanguage,
          releaseDate: dateOrNull(input.movie.releaseDate),
          runtimeMinutes: input.movie.runtimeMinutes,
          status: input.movie.status,
          popularity: input.movie.popularity,
          voteAverageTmdb: input.movie.voteAverageTmdb,
          voteCountTmdb: input.movie.voteCountTmdb,
          posterPath: input.movie.posterPath,
          backdropPath: input.movie.backdropPath,
          lastSyncedAt: input.timestamps.lastSyncedAt,
          staleAfter: input.timestamps.staleAfter,
        }
        const row = await tx.movie.upsert({
          where: { tmdbId: input.movie.tmdbId },
          create: { tmdbId: input.movie.tmdbId, ...data },
          update: data,
          select: { id: true },
        })
        await replaceExternalIds(tx, 'movie', row.id, input.externalIds)
        await replaceCredits(tx, 'movie', row.id, input.cast, input.crew, input.timestamps.lastSyncedAt)
        return { id: row.id.toString(), created: existing === null }
      })
    },

    async touchMovie(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean> {
      const count = await prisma.$executeRaw`
        UPDATE "movies"
        SET "last_synced_at" = ${timestamps.lastSyncedAt}, "stale_after" = ${timestamps.staleAfter}
        WHERE "tmdb_id" = ${tmdbId}`
      return count > 0
    },

    async upsertTvShow(input: StoreTvShowInput): Promise<UpsertOutcome> {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.tvShow.findUnique({
          where: { tmdbId: input.tvShow.tmdbId },
          select: { id: true },
        })
        const data = {
          imdbId: input.tvShow.imdbId,
          nameOriginal: input.tvShow.nameOriginal,
          originalLanguage: input.tvShow.originalLanguage,
          firstAirDate: dateOrNull(input.tvShow.firstAirDate),
          lastAirDate: dateOrNull(input.tvShow.lastAirDate),
          status: input.tvShow.status,
          numberOfSeasons: input.tvShow.numberOfSeasons,
          numberOfEpisodes: input.tvShow.numberOfEpisodes,
          popularity: input.tvShow.popularity,
          voteAverageTmdb: input.tvShow.voteAverageTmdb,
          voteCountTmdb: input.tvShow.voteCountTmdb,
          posterPath: input.tvShow.posterPath,
          backdropPath: input.tvShow.backdropPath,
          lastSyncedAt: input.timestamps.lastSyncedAt,
          staleAfter: input.timestamps.staleAfter,
        }
        const row = await tx.tvShow.upsert({
          where: { tmdbId: input.tvShow.tmdbId },
          create: { tmdbId: input.tvShow.tmdbId, ...data },
          update: data,
          select: { id: true },
        })
        await replaceExternalIds(tx, 'tv', row.id, input.externalIds)
        await replaceCredits(tx, 'tv', row.id, input.cast, input.crew, input.timestamps.lastSyncedAt)
        return { id: row.id.toString(), created: existing === null }
      })
    },

    async touchTvShow(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean> {
      const count = await prisma.$executeRaw`
        UPDATE "tv_shows"
        SET "last_synced_at" = ${timestamps.lastSyncedAt}, "stale_after" = ${timestamps.staleAfter}
        WHERE "tmdb_id" = ${tmdbId}`
      return count > 0
    },

    async upsertSeasonWithEpisodes(input: StoreSeasonInput): Promise<SeasonUpsertOutcome> {
      return prisma.$transaction(async (tx) => {
        const tv = await tx.tvShow.findUnique({
          where: { tmdbId: input.tvShowTmdbId },
          select: { id: true },
        })
        if (tv === null) {
          throw new Error(
            `tv_show tmdb_id=${input.tvShowTmdbId} ausente; importe a serie antes da temporada.`,
          )
        }
        const seasonWhere = {
          tvShowId_seasonNumber: { tvShowId: tv.id, seasonNumber: input.season.seasonNumber },
        }
        const existing = await tx.season.findUnique({ where: seasonWhere, select: { id: true } })
        const seasonData = {
          tmdbId: input.season.tmdbId,
          name: input.season.name,
          overview: input.season.overview,
          airDate: dateOrNull(input.season.airDate),
          episodeCount: input.season.episodeCount,
          posterPath: input.season.posterPath,
          lastSyncedAt: input.lastSyncedAt,
        }
        const season = await tx.season.upsert({
          where: seasonWhere,
          create: { tvShowId: tv.id, seasonNumber: input.season.seasonNumber, ...seasonData },
          update: seasonData,
          select: { id: true },
        })

        let episodesUpserted = 0
        for (const episode of input.episodes) {
          const episodeData = {
            tmdbId: episode.tmdbId,
            name: episode.name,
            overview: episode.overview,
            airDate: dateOrNull(episode.airDate),
            runtimeMinutes: episode.runtimeMinutes,
            stillPath: episode.stillPath,
            lastSyncedAt: input.lastSyncedAt,
          }
          await tx.episode.upsert({
            where: {
              seasonId_episodeNumber: { seasonId: season.id, episodeNumber: episode.episodeNumber },
            },
            create: {
              seasonId: season.id,
              tvShowId: tv.id,
              episodeNumber: episode.episodeNumber,
              ...episodeData,
            },
            update: episodeData,
          })
          episodesUpserted += 1
        }

        return { id: season.id.toString(), created: existing === null, episodesUpserted }
      })
    },

    async touchSeason(
      tvShowTmdbId: number,
      seasonNumber: number,
      lastSyncedAt: Date,
    ): Promise<boolean> {
      const count = await prisma.$executeRaw`
        UPDATE "seasons" AS s
        SET "last_synced_at" = ${lastSyncedAt}
        FROM "tv_shows" AS t
        WHERE s."tv_show_id" = t."id"
          AND t."tmdb_id" = ${tvShowTmdbId}
          AND s."season_number" = ${seasonNumber}`
      return count > 0
    },

    async upsertPerson(input: StorePersonInput): Promise<UpsertOutcome> {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.person.findUnique({
          where: { tmdbId: input.person.tmdbId },
          select: { id: true },
        })
        const data = {
          imdbId: input.person.imdbId,
          name: input.person.name,
          knownForDepartment: input.person.knownForDepartment,
          gender: input.person.gender,
          birthday: dateOrNull(input.person.birthday),
          deathday: dateOrNull(input.person.deathday),
          placeOfBirth: input.person.placeOfBirth,
          profilePath: input.person.profilePath,
          lastSyncedAt: input.lastSyncedAt,
        }
        const row = await tx.person.upsert({
          where: { tmdbId: input.person.tmdbId },
          create: { tmdbId: input.person.tmdbId, ...data },
          update: data,
          select: { id: true },
        })
        await replaceExternalIds(tx, 'person', row.id, input.externalIds)
        return { id: row.id.toString(), created: existing === null }
      })
    },

    async touchPerson(tmdbId: number, lastSyncedAt: Date): Promise<boolean> {
      const count = await prisma.$executeRaw`
        UPDATE "people" SET "last_synced_at" = ${lastSyncedAt} WHERE "tmdb_id" = ${tmdbId}`
      return count > 0
    },
  }
}
