/**
 * store-genres.test.ts — Vinculo de genero do adapter Prisma, com Prisma FAKE.
 *
 * REGRESSAO QUE ESTE ARQUIVO TRAVA: `replaceTitleGenres` inseria em
 * `movie_genres`/`tv_show_genres` TODOS os generos do payload, sem consultar o
 * dicionario `genres`. As duas tabelas tem FK COMPOSTA para
 * `genres(media_type, tmdb_id)` (migration `20260820120000`), e uma FK violada
 * nao "pula a linha": ela estoura `P2003` e ABORTA A TRANSACAO INTEIRA do
 * upsert. O filme nao era gravado, os creditos nao eram gravados, os ids
 * externos nao eram gravados — por causa de uma taxonomia desatualizada.
 *
 * O comentario que morava na funcao AFIRMAVA que "o insert e filtrado antes,
 * contra os generos existentes". Nao era: nao havia filtro em lugar nenhum do
 * repositorio. O contrato estava escrito e nao implementado.
 *
 * O caso extremo nao e hipotetico: o dicionario e populado SO por
 * `bin/sync-tmdb.ts genres --apply`, que ABORTA em ambiente production-like e
 * nao tem fila no agendador. Em producao ele pode estar VAZIO — e nesse estado
 * a versao anterior derrubava TODO titulo que tivesse genero.
 *
 * Trava:
 *  - dicionario VAZIO: o titulo entra; zero vinculo de genero; nenhum insert;
 *  - dicionario PARCIAL: so os conhecidos sao inseridos, com a ORDEM do TMDB
 *    preservada (`position` nao e reindexado);
 *  - o filtro consulta o dicionario do media_type CERTO (movie != tv);
 *  - payload sem `genres`: nada e apagado (disciplina de presenca).
 */

import { describe, expect, it } from 'vitest'

import { createPrismaStore } from '../store.js'
import { isUpsertRefused } from '../../ports.js'
import type { EntityUpsertOutcome, EntityUpsertResult } from '../../ports.js'
import { normalizeMovie } from '../../normalizers/movie.js'
import { normalizeTvShow } from '../../normalizers/tv.js'
import type { StoreMovieInput, StoreTvShowInput } from '../../ports.js'
import type { TmdbMovieDetail, TmdbTvDetail } from '@screena/tmdb-client'

/**
 * Narrowing para os testes: o resultado do upsert virou UNIAO (pode ser recusa
 * pelo recorte de idioma, ver `../admission.ts`). Nestes testes o Prisma falso
 * devolve entidade EXISTENTE em `findUnique`, e o gate so barra CRIACAO — entao
 * a recusa nunca acontece aqui. Se um dia acontecer, este helper falha alto em
 * vez de deixar o teste seguir com um objeto sem `id`.
 */
function admitido(result: EntityUpsertResult): EntityUpsertOutcome {
  if (isUpsertRefused(result)) {
    throw new Error(`upsert recusado inesperadamente: ${JSON.stringify(result.refused)}`)
  }
  return result
}



type StoreArg = Parameters<typeof createPrismaStore>[0]

const MOVIE_ROW_ID = 42n
const TV_ROW_ID = 77n
const SYNCED_AT = new Date('2026-08-25T00:00:00.000Z')

interface CreateManyArgs {
  readonly data: readonly Record<string, unknown>[]
}
interface GenreFindManyArgs {
  readonly where: {
    readonly mediaType: 'movie' | 'tv'
    readonly tmdbId: { readonly in: readonly number[] }
  }
}

/**
 * Prisma fake com um DICIONARIO de generos configuravel. O ponto do arquivo e
 * exatamente o que acontece quando esse dicionario nao cobre o payload.
 */
function makeFakePrisma(dictionary: { movie?: readonly number[]; tv?: readonly number[] } = {}) {
  const calls: string[] = []
  const createdRows = new Map<string, Record<string, unknown>[]>()
  const known = {
    movie: new Set(dictionary.movie ?? []),
    tv: new Set(dictionary.tv ?? []),
  }
  const genreQueries: GenreFindManyArgs['where'][] = []

  const record = (name: string): void => {
    calls.push(name)
  }
  const collection = (name: string) => ({
    deleteMany: async (): Promise<{ count: number }> => {
      record(`${name}.deleteMany`)
      return { count: 0 }
    },
    createMany: async (args: CreateManyArgs): Promise<{ count: number }> => {
      record(`${name}.createMany`)
      createdRows.set(name, [...(createdRows.get(name) ?? []), ...args.data])
      return { count: args.data.length }
    },
  })

  const tx = {
    movie: {
      findUnique: async (): Promise<{ id: bigint } | null> => {
        record('movie.findUnique')
        return { id: MOVIE_ROW_ID }
      },
      upsert: async (): Promise<{ id: bigint }> => {
        record('movie.upsert')
        return { id: MOVIE_ROW_ID }
      },
    },
    tvShow: {
      findUnique: async (): Promise<{ id: bigint } | null> => {
        record('tvShow.findUnique')
        return { id: TV_ROW_ID }
      },
      upsert: async (): Promise<{ id: bigint }> => {
        record('tvShow.upsert')
        return { id: TV_ROW_ID }
      },
    },
    genre: {
      findMany: async (args: GenreFindManyArgs): Promise<{ tmdbId: number }[]> => {
        record('genre.findMany')
        genreQueries.push(args.where)
        return args.where.tmdbId.in
          .filter((tmdbId) => known[args.where.mediaType].has(tmdbId))
          .map((tmdbId) => ({ tmdbId }))
      },
    },
    entityExternalId: collection('entityExternalId'),
    castMember: collection('castMember'),
    crewMember: collection('crewMember'),
    movieGenre: collection('movieGenre'),
    tvShowGenre: collection('tvShowGenre'),
    person: {
      upsert: async (): Promise<{ id: bigint }> => {
        record('person.upsert')
        return { id: 1n }
      },
      findMany: async (): Promise<{ id: bigint; tmdbId: number }[]> => {
        record('person.findMany')
        return []
      },
    },
  }

  const prisma = { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx) }
  return { prisma: prisma as unknown as StoreArg, calls, createdRows, genreQueries }
}

/** Generos do detalhe do TMDB: id + nome, na ordem editorial da fonte. */
function genreBlock(...ids: number[]): { id: number; name: string }[] {
  return ids.map((id) => ({ id, name: `Genero ${id}` }))
}

function movieInput(detail: TmdbMovieDetail): StoreMovieInput {
  const n = normalizeMovie(detail)
  return {
    movie: n.movie,
    externalIds: n.externalIds,
    cast: n.cast,
    crew: n.crew,
    castPresent: n.castPresent,
    crewPresent: n.crewPresent,
    recommendations: n.recommendations,
    recommendationsPresent: n.recommendationsPresent,
    genres: n.genres,
    genresPresent: n.genresPresent,
    countries: n.countries,
    countriesPresent: n.countriesPresent,
    timestamps: { lastSyncedAt: SYNCED_AT, staleAfter: null },
  }
}

function tvInput(detail: TmdbTvDetail): StoreTvShowInput {
  const n = normalizeTvShow(detail)
  return {
    tvShow: n.tvShow,
    externalIds: n.externalIds,
    cast: n.cast,
    crew: n.crew,
    castPresent: n.castPresent,
    crewPresent: n.crewPresent,
    recommendations: n.recommendations,
    recommendationsPresent: n.recommendationsPresent,
    genres: n.genres,
    genresPresent: n.genresPresent,
    countries: n.countries,
    countriesPresent: n.countriesPresent,
    timestamps: { lastSyncedAt: SYNCED_AT, staleAfter: null },
  }
}

describe('replaceTitleGenres — genero fora do dicionario nao derruba o titulo', () => {
  it('dicionario VAZIO: o filme entra, e nenhum vinculo de genero e inserido', async () => {
    const fake = makeFakePrisma({ movie: [] })
    const store = createPrismaStore(fake.prisma)

    const outcome = admitido(
      await store.upsertMovie(
        movieInput({ id: 550, original_title: 'Fight Club', genres: genreBlock(18, 53) }),
      ),
    )

    // O CORACAO DA REGRESSAO: com o dicionario vazio, a versao anterior
    // inseria (18, 53), estourava P2003 e abortava a transacao inteira.
    expect(fake.calls).not.toContain('movieGenre.createMany')
    expect(fake.calls).toContain('genre.findMany')
    // O titulo continua sendo gravado — que era exatamente o que se perdia.
    expect(fake.calls).toContain('movie.upsert')
    expect(outcome.id).toBe(MOVIE_ROW_ID.toString())
  })

  it('dicionario PARCIAL: so os conhecidos entram, com a ORDEM do TMDB preservada', async () => {
    const fake = makeFakePrisma({ movie: [28, 878] })
    const store = createPrismaStore(fake.prisma)

    await store.upsertMovie(
      // 12 (desconhecido) esta no MEIO: se o filtro reindexasse `position`,
      // 878 subiria de 2 para 1 e trocaria o chip exibido no hero.
      movieInput({ id: 27205, original_title: 'Inception', genres: genreBlock(28, 12, 878) }),
    )

    expect(fake.createdRows.get('movieGenre')).toEqual([
      { movieId: MOVIE_ROW_ID, genreMediaType: 'movie', genreTmdbId: 28, position: 0 },
      { movieId: MOVIE_ROW_ID, genreMediaType: 'movie', genreTmdbId: 878, position: 2 },
    ])
  })

  it('serie consulta o dicionario de `tv`, nunca o de `movie`', async () => {
    // 10765 (Sci-Fi & Fantasy) so existe na taxonomia de TV. Consultar o
    // dicionario errado descartaria genero valido — ou pior, aceitaria um id
    // que a FK do outro media_type recusaria.
    const fake = makeFakePrisma({ movie: [], tv: [10765] })
    const store = createPrismaStore(fake.prisma)

    await store.upsertTvShow(tvInput({ id: 1399, original_name: 'Game of Thrones', genres: genreBlock(10765) }))

    expect(fake.genreQueries.map((q) => q.mediaType)).toEqual(['tv'])
    expect(fake.createdRows.get('tvShowGenre')).toEqual([
      { tvShowId: TV_ROW_ID, genreMediaType: 'tv', genreTmdbId: 10765, position: 0 },
    ])
  })

  it('payload SEM o array `genres`: nada e consultado e nada e apagado', async () => {
    const fake = makeFakePrisma({ movie: [18] })
    const store = createPrismaStore(fake.prisma)

    await store.upsertMovie(movieInput({ id: 550, original_title: 'Fight Club' }))

    // Disciplina de presenca: ausencia do campo NAO e "este filme nao tem
    // genero". Sem delete, o vinculo ja gravado sobrevive.
    expect(fake.calls).not.toContain('movieGenre.deleteMany')
    expect(fake.calls).not.toContain('genre.findMany')
  })
})
