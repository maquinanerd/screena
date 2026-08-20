/**
 * store-credits.test.ts — Replace-set de creditos do adapter Prisma, com Prisma FAKE.
 *
 * REGRESSAO QUE ESTE ARQUIVO TRAVA: `replaceCredits` apagava `cast_members` e
 * `crew_members` INCONDICIONALMENTE antes de saber se havia algo a inserir. Como
 * `credits` e opcional no payload do TMDB, um detalhe SEM o append `credits`
 * (linha antiga de `tmdb_raw` reprocessada por `reprocess_raw`, corpo truncado,
 * `sync_external_ids`) chegava aqui como `cast: []` e APAGAVA o elenco ja
 * gravado — enquanto o relatorio dizia `updated: 1` / `cast: 0`, ou seja,
 * sucesso. Perda de dado silenciosa.
 *
 * Os testes partem do PAYLOAD BRUTO e passam pelo normalizer real, para provar a
 * cadeia inteira (`normalizeCredits` -> `NormalizedMovie` -> `StoreMovieInput` ->
 * `replaceCredits`), nao so o ultimo elo.
 *
 * Trava:
 *  - payload SEM bloco `credits`: NENHUM delete de elenco/equipe;
 *  - `credits` presente com listas VAZIAS: o delete roda (limpeza legitima);
 *  - presenca PARCIAL: so a lista que a fonte trouxe e substituida;
 *  - creditos descartados por stub de pessoa ausente entram num CONTADOR.
 *
 * Mesma regra que `services/streaming/src/streaming-availability/mapping.ts` ja
 * aplicava: corpo anomalo nao roda replace, para nao apagar dado bom.
 */

import { describe, expect, it } from 'vitest'

import { createPrismaStore } from '../store.js'
import { createMovieStrategy } from '../../raw-promote/run.js'
import { normalizeMovie } from '../../normalizers/movie.js'
import { normalizeTvShow } from '../../normalizers/tv.js'
import type { StoreMovieInput, StoreTvShowInput } from '../../ports.js'
import type { TmdbCredits, TmdbMovieDetail, TmdbTvDetail } from '@screena/tmdb-client'

type StoreArg = Parameters<typeof createPrismaStore>[0]

const MOVIE_ROW_ID = 42n
const TV_ROW_ID = 77n
const SYNCED_AT = new Date('2026-08-11T00:00:00.000Z')

interface CreateManyArgs {
  readonly data: readonly Record<string, unknown>[]
}
interface PersonUpsertArgs {
  readonly where: { readonly tmdbId: number }
}
interface PersonFindManyArgs {
  readonly where: { readonly tmdbId: { readonly in: readonly number[] } }
}

/**
 * Prisma fake: registra cada chamada por nome (`castMember.deleteMany`, ...) e
 * guarda as linhas de `createMany`. `unresolvablePeople` simula um stub de
 * pessoa que nao volta do `findMany` — o caso que alimenta o contador de
 * descartados.
 */
function makeFakePrisma(options: { readonly unresolvablePeople?: readonly number[] } = {}) {
  const calls: string[] = []
  const createdRows = new Map<string, Record<string, unknown>[]>()
  const unresolvable = new Set(options.unresolvablePeople ?? [])

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
    entityExternalId: collection('entityExternalId'),
    castMember: collection('castMember'),
    crewMember: collection('crewMember'),
    person: {
      upsert: async (args: PersonUpsertArgs): Promise<{ id: bigint }> => {
        record('person.upsert')
        return { id: BigInt(1000 + args.where.tmdbId) }
      },
      findMany: async (
        args: PersonFindManyArgs,
      ): Promise<{ id: bigint; tmdbId: number }[]> => {
        record('person.findMany')
        return args.where.tmdbId.in
          .filter((tmdbId) => !unresolvable.has(tmdbId))
          .map((tmdbId) => ({ id: BigInt(1000 + tmdbId), tmdbId }))
      },
    },
  }

  const prisma = { $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => fn(tx) }
  return { prisma: prisma as unknown as StoreArg, calls, createdRows }
}

/**
 * Detalhe de filme cru; `credits` so aparece se o teste passar um — e o ponto
 * inteiro do bug e o payload que NAO tem essa chave.
 */
function movieDetail(credits?: unknown): TmdbMovieDetail {
  const detail: TmdbMovieDetail = { id: 550, original_title: 'Fight Club' }
  if (credits === undefined) return detail
  // `unknown` de proposito: alguns casos exercitam corpo anomalo (nao-array).
  return { ...detail, credits: credits as TmdbCredits }
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
    timestamps: { lastSyncedAt: SYNCED_AT, staleAfter: null },
  }
}

const FULL_CREDITS = {
  cast: [{ id: 819, name: 'Edward Norton', character: 'The Narrator', order: 0 }],
  crew: [{ id: 7467, name: 'David Fincher', department: 'Directing', job: 'Director' }],
}

describe('replaceCredits — payload sem `credits` NAO apaga elenco/equipe', () => {
  it('filme sem bloco `credits`: nenhum delete, nenhum insert, nada reportado como escrito', async () => {
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertMovie(movieInput(movieDetail()))

    // O CORACAO DA REGRESSAO: sem delete, o elenco ja gravado sobrevive.
    expect(fake.calls).not.toContain('castMember.deleteMany')
    expect(fake.calls).not.toContain('crewMember.deleteMany')
    expect(fake.calls).not.toContain('castMember.createMany')
    expect(fake.calls).not.toContain('crewMember.createMany')
    // Sem lista nenhuma, nem `people` e tocado (nao carimba last_synced_at a toa).
    expect(fake.calls).not.toContain('person.upsert')
    expect(fake.calls).not.toContain('person.findMany')
    // A ficha do filme continua sendo atualizada normalmente.
    expect(fake.calls).toContain('movie.upsert')

    expect(outcome.credits).toEqual({
      castReplaced: false,
      crewReplaced: false,
      castLinked: 0,
      crewLinked: 0,
      castDropped: 0,
      crewDropped: 0,
    })
  })

  it('serie sem bloco `credits`: nenhum delete de elenco/equipe', async () => {
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertTvShow(tvInput({ id: 1396, original_name: 'Breaking Bad' }))

    expect(fake.calls).not.toContain('castMember.deleteMany')
    expect(fake.calls).not.toContain('crewMember.deleteMany')
    expect(fake.calls).toContain('tvShow.upsert')
    expect(outcome.credits.castReplaced).toBe(false)
    expect(outcome.credits.crewReplaced).toBe(false)
  })

  it('`reprocess_raw` de um raw ANTIGO (sem `credits`) preserva o elenco', async () => {
    // Gatilho real: `reprocess_raw` existe para reprocessar linhas de `tmdb_raw`
    // gravadas ANTES do append set atual — justamente as que nao tem `credits`.
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const { outcome } = await createMovieStrategy(store).promote({
      tmdbId: 550,
      baseLanguage: 'en',
      payload: movieDetail(),
      fetchedAt: SYNCED_AT,
    })

    // A prova aqui sao as chamadas: `PromoteStrategy` declara `UpsertOutcome`
    // (o core generico so le `id`/`created`, e a estrategia de pessoa nem tem
    // creditos), entao o resumo nao atravessa esta fronteira de proposito.
    expect(fake.calls).not.toContain('castMember.deleteMany')
    expect(fake.calls).not.toContain('crewMember.deleteMany')
    expect(outcome.created).toBe(false)
  })

  it('`credits: {}` (bloco presente, listas ausentes) tambem preserva', async () => {
    // Bloco presente porem sem `cast`/`crew` = corpo anomalo/truncado: nao
    // aprendemos nada sobre os creditos, entao nao mexemos neles.
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    await store.upsertMovie(movieInput(movieDetail({})))

    expect(fake.calls).not.toContain('castMember.deleteMany')
    expect(fake.calls).not.toContain('crewMember.deleteMany')
  })
})

describe('replaceCredits — lista presente porem VAZIA limpa (afirmacao da fonte)', () => {
  it('`credits.cast = []` e `crew = []`: delete roda, sem insert', async () => {
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertMovie(movieInput(movieDetail({ cast: [], crew: [] })))

    // Aqui a fonte AFIRMOU que nao ha creditos — limpar e o comportamento certo.
    expect(fake.calls).toContain('castMember.deleteMany')
    expect(fake.calls).toContain('crewMember.deleteMany')
    expect(fake.calls).not.toContain('castMember.createMany')
    expect(fake.calls).not.toContain('crewMember.createMany')
    expect(outcome.credits.castReplaced).toBe(true)
    expect(outcome.credits.crewReplaced).toBe(true)
    expect(outcome.credits.castLinked).toBe(0)
  })
})

describe('replaceCredits — presenca por lista e independente', () => {
  it('so `cast` presente: elenco substituido, equipe intocada', async () => {
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertMovie(movieInput(movieDetail({ cast: FULL_CREDITS.cast })))

    expect(fake.calls).toContain('castMember.deleteMany')
    expect(fake.calls).toContain('castMember.createMany')
    expect(fake.calls).not.toContain('crewMember.deleteMany')
    expect(fake.calls).not.toContain('crewMember.createMany')
    expect(outcome.credits).toMatchObject({
      castReplaced: true,
      crewReplaced: false,
      castLinked: 1,
      crewLinked: 0,
    })
  })

  it('creditos completos: elenco e equipe substituidos e ligados a pessoa', async () => {
    const fake = makeFakePrisma()
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertMovie(movieInput(movieDetail(FULL_CREDITS)))

    expect(fake.calls).toContain('castMember.deleteMany')
    expect(fake.calls).toContain('crewMember.deleteMany')
    expect(outcome.credits).toMatchObject({ castLinked: 1, crewLinked: 1, castDropped: 0 })
    expect(fake.createdRows.get('castMember')?.[0]).toMatchObject({
      personId: 1819n,
      entityType: 'movie',
      entityId: MOVIE_ROW_ID,
      character: 'The Narrator',
    })
    expect(fake.createdRows.get('crewMember')?.[0]).toMatchObject({ job: 'Director' })
  })
})

describe('replaceCredits — credito sem pessoa resolvida entra num contador', () => {
  it('stub ausente: o credito e descartado, mas contado (nao some em silencio)', async () => {
    // Antes o `.filter` engolia o credito sem deixar rastro algum.
    const fake = makeFakePrisma({ unresolvablePeople: [819] })
    const store = createPrismaStore(fake.prisma)

    const outcome = await store.upsertMovie(movieInput(movieDetail(FULL_CREDITS)))

    expect(outcome.credits.castDropped).toBe(1)
    expect(outcome.credits.castLinked).toBe(0)
    // A equipe, cuja pessoa resolve, segue gravada normalmente.
    expect(outcome.credits.crewDropped).toBe(0)
    expect(outcome.credits.crewLinked).toBe(1)
    expect(fake.calls).not.toContain('castMember.createMany')
  })
})
