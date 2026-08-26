/**
 * store.ts — Adapter de persistencia de entidades (Prisma). COBERTO por
 * `tsconfig.runtime.json` (`pnpm typecheck` encadeia os dois).
 *
 * Upserts idempotentes por chave natural; creditos por "replace-set" em
 * transacao (remove os antigos da entidade e reinsere); `touch*` via SQL bruto
 * (NAO bumpa `updated_at` — honra o short-circuit de hash).
 */

import type { PrismaClient } from '@screena/db/server'
import type {
  CreditsWriteOutcome,
  EntityStorePort,
  EntityUpsertOutcome,
  SeasonUpsertOutcome,
  StoreMovieInput,
  StorePersonInput,
  StoreSeasonInput,
  StoreTvShowInput,
  SyncTimestamps,
  UpsertOutcome,
} from '../ports.js'
import type {
  CastMemberInput,
  CrewMemberInput,
  ExternalIdInput,
  PersonStub,
  TitleRecommendationLink,
  TitleGenreLink,
  TitleCountryLink,
} from '../types.js'

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

/** Presenca declarada pela fonte (ver `StoreMovieInput.castPresent`). */
interface CreditsPresence {
  readonly castPresent: boolean
  readonly crewPresent: boolean
}

/**
 * Replace-set de creditos — mas SO das listas que a fonte de fato trouxe.
 *
 * O `deleteMany` roda apenas quando `castPresent`/`crewPresent` afirma que a
 * FONTE declarou aquela lista. Antes ele era incondicional: um payload sem o
 * bloco `credits` (raw antigo reprocessado por `reprocess_raw`, corpo truncado)
 * chegava aqui como `cast: []` e APAGAVA o elenco ja gravado, e o ciclo ainda
 * reportava `updated: 1` — perda de dado silenciosa. Lista presente porem
 * VAZIA continua limpando: ali a fonte afirmou que nao ha creditos.
 *
 * Mesma regra que `services/streaming/src/streaming-availability/mapping.ts`
 * ja aplica: corpo anomalo nao roda replace, para nao apagar dado bom.
 */
async function replaceCredits(
  tx: Tx,
  entityType: CreditEntityType,
  entityId: bigint,
  cast: readonly CastMemberInput[],
  crew: readonly CrewMemberInput[],
  presence: CreditsPresence,
  lastSyncedAt: Date,
): Promise<CreditsWriteOutcome> {
  const { castPresent, crewPresent } = presence
  const empty: CreditsWriteOutcome = {
    castReplaced: false,
    crewReplaced: false,
    castLinked: 0,
    crewLinked: 0,
    castDropped: 0,
    crewDropped: 0,
  }
  // A fonte nao falou de elenco NEM de equipe: nada a fazer. Sai antes de
  // tocar `people` para nao carimbar `last_synced_at` a toa.
  if (!castPresent && !crewPresent) return empty

  const stubs: PersonStub[] = [
    ...(castPresent ? cast.map((c) => c.person) : []),
    ...(crewPresent ? crew.map((c) => c.person) : []),
  ]
  const idByTmdb = await upsertPeopleStubs(tx, stubs, lastSyncedAt)

  let castLinked = 0
  let crewLinked = 0
  let castDropped = 0
  let crewDropped = 0

  if (castPresent) {
    await tx.castMember.deleteMany({ where: { entityType, entityId } })
    const castData = cast
      .map((credit) => {
        const personId = idByTmdb.get(credit.personTmdbId)
        // Stub de pessoa ausente: o credito nao tem onde se ligar. Contado em
        // `castDropped` — antes era descartado sem deixar rastro.
        if (personId === undefined) {
          castDropped += 1
          return undefined
        }
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
    castLinked = castData.length
  }

  if (crewPresent) {
    await tx.crewMember.deleteMany({ where: { entityType, entityId } })
    const crewData = crew
      .map((credit) => {
        const personId = idByTmdb.get(credit.personTmdbId)
        if (personId === undefined) {
          crewDropped += 1
          return undefined
        }
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
    crewLinked = crewData.length
  }

  return {
    castReplaced: castPresent,
    crewReplaced: crewPresent,
    castLinked,
    crewLinked,
    castDropped,
    crewDropped,
  }
}

/**
 * Substitui os vinculos de recomendacao de UM titulo.
 *
 * NAO APAGA quando a fonte nao falou (`present === false`) — raw antigo, sem os
 * blocos, e o caso real. Mesma disciplina de `replaceCredits`.
 *
 * Escreve por TMDB_ID, sem FK: o alvo pertence ao universo do TMDB e a maioria
 * ainda nao foi ingerida. A leitura resolve por id e ignora quem nao existe.
 */
async function replaceTitleRecommendations(
  tx: Tx,
  sourceMediaType: 'movie' | 'tv',
  sourceTmdbId: number,
  links: readonly TitleRecommendationLink[],
  present: boolean,
): Promise<number> {
  if (!present) return 0
  await tx.titleRecommendation.deleteMany({ where: { sourceMediaType, sourceTmdbId } })
  if (links.length === 0) return 0
  await tx.titleRecommendation.createMany({
    data: links.map((l) => ({
      sourceMediaType,
      sourceTmdbId,
      kind: l.kind,
      targetMediaType: l.targetMediaType,
      targetTmdbId: l.targetTmdbId,
      position: l.position,
    })),
    skipDuplicates: true,
  })
  return links.length
}

/**
 * Substitui os vinculos de genero de UM titulo.
 *
 * NAO APAGA quando a fonte nao falou. `present === false` significa "o payload
 * nao trouxe o campo", e nunca "este titulo nao tem genero" — a mesma distincao
 * que `replaceCredits` faz, pelo mesmo motivo historico: creditos ja foram
 * apagados em massa aqui porque payload sem `credits` foi lido como lista vazia.
 *
 * Quando a fonte falou, e replace-set: delete + insert dentro da transacao do
 * upsert. Genero e uma lista pequena e fechada; diffar seria mais codigo para o
 * mesmo resultado.
 */
/**
 * Substitui os PAISES DE ORIGEM do titulo (replace-set), com a mesma
 * disciplina de presenca dos generos: `present === false` significa "o payload
 * nao falou de pais" e NAO apaga o que existe (a licao do apagao de creditos).
 * Sem dicionario a filtrar: o codigo ISO e travado por CHECK na tabela.
 */
async function replaceTitleCountries(
  tx: Tx,
  kind: 'movie' | 'tv',
  titleId: bigint,
  countries: readonly TitleCountryLink[],
  present: boolean,
): Promise<void> {
  if (!present) return
  if (kind === 'movie') {
    await tx.movieProductionCountry.deleteMany({ where: { movieId: titleId } })
    if (countries.length === 0) return
    await tx.movieProductionCountry.createMany({
      data: countries.map((c) => ({
        movieId: titleId,
        countryCode: c.countryCode,
        position: c.position,
      })),
    })
    return
  }
  await tx.tvShowOriginCountry.deleteMany({ where: { tvShowId: titleId } })
  if (countries.length === 0) return
  await tx.tvShowOriginCountry.createMany({
    data: countries.map((c) => ({
      tvShowId: titleId,
      countryCode: c.countryCode,
      position: c.position,
    })),
  })
}

/**
 * Mantem apenas os generos que o DICIONARIO (`genres`) ja conhece.
 *
 * ============ POR QUE ESTA FUNCAO PRECISOU EXISTIR ============
 *
 * `movie_genres`/`tv_show_genres` tem FK COMPOSTA para
 * `genres(media_type, tmdb_id)` (migration `20260820120000`). Um genero ausente
 * do dicionario nao "pula a linha": ele estoura `P2003` e aborta a TRANSACAO
 * INTEIRA do upsert — o filme nao e gravado, os creditos nao sao gravados, os
 * ids externos nao sao gravados. Uma taxonomia desatualizada derruba o titulo.
 *
 * O comentario que morava aqui AFIRMAVA que "o insert e filtrado antes, contra
 * os generos existentes". Nao era. Nao havia filtro em lugar nenhum do
 * repositorio — o contrato estava escrito e nao implementado, que e a forma de
 * defeito mais dificil de ver: quem le o codigo le a promessa.
 *
 * `skipDuplicates` NAO cobre isto. Ele resolve conflito de PK, nunca FK.
 *
 * O dicionario e populado SO por `bin/sync-tmdb.ts genres --apply`, que aborta
 * em ambiente production-like e nao tem fila no agendador. Ou seja: em producao
 * ele pode estar vazio, e nesse estado TODO titulo com genero falha. Esta funcao
 * degrada isso para "o titulo entra sem vinculo de genero" em vez de "o titulo
 * nao entra".
 */
async function keepKnownGenres(
  tx: Tx,
  mediaType: 'movie' | 'tv',
  genres: readonly TitleGenreLink[],
): Promise<TitleGenreLink[]> {
  const known = await tx.genre.findMany({
    where: { mediaType, tmdbId: { in: genres.map((g) => g.tmdbId) } },
    select: { tmdbId: true },
  })
  const knownIds = new Set(known.map((row) => row.tmdbId))
  // `position` NAO e recalculado: ele carrega a ordem editorial do TMDB (o
  // genero mais representativo primeiro). Reindexar depois do descarte moveria
  // o chip do hero por causa de uma lacuna do dicionario.
  return genres.filter((g) => knownIds.has(g.tmdbId))
}

async function replaceTitleGenres(
  tx: Tx,
  kind: 'movie' | 'tv',
  titleId: bigint,
  genres: readonly TitleGenreLink[],
  present: boolean,
): Promise<number> {
  if (!present) return 0
  if (kind === 'movie') {
    await tx.movieGenre.deleteMany({ where: { movieId: titleId } })
    if (genres.length === 0) return 0
    const linkable = await keepKnownGenres(tx, 'movie', genres)
    if (linkable.length === 0) return 0
    await tx.movieGenre.createMany({
      data: linkable.map((g) => ({
        movieId: titleId,
        genreMediaType: 'movie',
        genreTmdbId: g.tmdbId,
        position: g.position,
      })),
      skipDuplicates: true,
    })
    return linkable.length
  }
  await tx.tvShowGenre.deleteMany({ where: { tvShowId: titleId } })
  if (genres.length === 0) return 0
  const linkable = await keepKnownGenres(tx, 'tv', genres)
  if (linkable.length === 0) return 0
  await tx.tvShowGenre.createMany({
    data: linkable.map((g) => ({
      tvShowId: titleId,
      genreMediaType: 'tv',
      genreTmdbId: g.tmdbId,
      position: g.position,
    })),
    skipDuplicates: true,
  })
  return linkable.length
}

/** Cria um `EntityStorePort` apoiado no Prisma. */
export function createPrismaStore(prisma: PrismaClient): EntityStorePort {
  return {
    async upsertMovie(input: StoreMovieInput): Promise<EntityUpsertOutcome> {
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
          budget: input.movie.budget,
          releaseDateBr: dateOrNull(input.movie.releaseDateBr),
          // Classificacao BR: so sobrescreve quando o recorte TROUXE valor —
          // um payload sem release_dates nao pode apagar a classificacao que
          // um sync anterior gravou (mesma familia do apagao de creditos).
          ...(input.movie.certification === null
            ? {}
            : { certification: input.movie.certification }),
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
        await replaceTitleRecommendations(
          tx,
          'movie',
          input.movie.tmdbId,
          input.recommendations,
          input.recommendationsPresent,
        )
        await replaceTitleGenres(tx, 'movie', row.id, input.genres, input.genresPresent)
        await replaceTitleCountries(tx, 'movie', row.id, input.countries, input.countriesPresent)
        const credits = await replaceCredits(
          tx,
          'movie',
          row.id,
          input.cast,
          input.crew,
          { castPresent: input.castPresent, crewPresent: input.crewPresent },
          input.timestamps.lastSyncedAt,
        )
        return { id: row.id.toString(), created: existing === null, credits }
      })
    },

    async touchMovie(tmdbId: number, timestamps: SyncTimestamps): Promise<boolean> {
      const count = await prisma.$executeRaw`
        UPDATE "movies"
        SET "last_synced_at" = ${timestamps.lastSyncedAt}, "stale_after" = ${timestamps.staleAfter}
        WHERE "tmdb_id" = ${tmdbId}`
      return count > 0
    },

    async upsertTvShow(input: StoreTvShowInput): Promise<EntityUpsertOutcome> {
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
          ...(input.tvShow.certification === null
            ? {}
            : { certification: input.tvShow.certification }),
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
        await replaceTitleRecommendations(
          tx,
          'tv',
          input.tvShow.tmdbId,
          input.recommendations,
          input.recommendationsPresent,
        )
        await replaceTitleGenres(tx, 'tv', row.id, input.genres, input.genresPresent)
        await replaceTitleCountries(tx, 'tv', row.id, input.countries, input.countriesPresent)
        const credits = await replaceCredits(
          tx,
          'tv',
          row.id,
          input.cast,
          input.crew,
          { castPresent: input.castPresent, crewPresent: input.crewPresent },
          input.timestamps.lastSyncedAt,
        )
        return { id: row.id.toString(), created: existing === null, credits }
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
          // Gravar o TEXTO nao autoriza exibi-lo: `biographySourceStatus` NAO e
          // tocado aqui e continua no default `unknown`, entao o gate de licenca
          // (invariante 6) segue barrando a tela. Sao dois passos, como em
          // ratings e em streaming.
          biography: input.person.biography,
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
