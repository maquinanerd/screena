/**
 * admission.test.ts — A PORTA DO CATALOGO (Parte C da leva do recorte).
 *
 * Duas coisas sao provadas aqui, e a segunda importa tanto quanto a primeira:
 *
 *   1. titulo fora do recorte NAO e criado;
 *   2. a recusa NAO e silenciosa — ela e contada, por idioma e por tipo, e
 *      carrega um `error_code` consultavel em `api_sync_logs`.
 *
 * O gate roda contra o `createPrismaStore` DE PRODUCAO, com um Prisma falso. Um
 * teste que exercitasse so `createCatalogAdmissionPolicy` provaria que a
 * politica sabe decidir, nao que a persistencia a consulta — e o defeito
 * historico deste projeto e exatamente esse tipo de folga entre "existe" e
 * "esta ligado".
 */

import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@screena/db/server'

import { isUpsertRefused } from '../../ports.js'
import type { StoreMovieInput, StoreTvShowInput } from '../../ports.js'
import {
  createAdmissionRefusalCounter,
  createCatalogAdmissionPolicy,
  formatRefusalTally,
  refusalErrorCode,
} from '../admission.js'
import { createPrismaStore } from '../store.js'

const MOVIE_ROW_ID = 77n
const TV_ROW_ID = 88n
const SYNCED_AT = new Date('2026-08-31T12:00:00.000Z')

/**
 * Prisma falso. `existe` controla o que `findUnique` devolve — que e o eixo do
 * gate: ele barra CRIACAO, nunca atualizacao.
 */
function makeFakePrisma(existe: boolean) {
  const calls: string[] = []
  const record = (name: string): void => {
    calls.push(name)
  }
  const tx = {
    movie: {
      findUnique: async () => {
        record('movie.findUnique')
        return existe ? { id: MOVIE_ROW_ID } : null
      },
      upsert: async () => {
        record('movie.upsert')
        return { id: MOVIE_ROW_ID }
      },
    },
    tvShow: {
      findUnique: async () => {
        record('tvShow.findUnique')
        return existe ? { id: TV_ROW_ID } : null
      },
      upsert: async () => {
        record('tvShow.upsert')
        return { id: TV_ROW_ID }
      },
    },
    entityExternalId: {
      deleteMany: async () => {
        record('entityExternalId.deleteMany')
        return { count: 0 }
      },
      createMany: async () => {
        record('entityExternalId.createMany')
        return { count: 0 }
      },
    },
    titleRecommendation: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    movieGenre: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    tvShowGenre: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    genre: { findMany: async () => [] },
    movieProductionCountry: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    tvShowProductionCountry: {
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
    },
    country: { findMany: async () => [] },
    castMember: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    crewMember: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
    person: { upsert: async () => ({ id: 1n }), findMany: async () => [] },
  }
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient
  return { prisma, calls }
}

function movieInput(originalLanguage: string | null): StoreMovieInput {
  return {
    movie: {
      tmdbId: 999,
      imdbId: null,
      titleOriginal: 'ధృవ',
      originalLanguage,
      releaseDate: null,
      runtimeMinutes: null,
      status: null,
      popularity: null,
      voteAverageTmdb: null,
      voteCountTmdb: null,
      posterPath: null,
      backdropPath: null,
      certification: null,
      budget: null,
      releaseDateBr: null,
    },
    externalIds: [],
    cast: [],
    crew: [],
    castPresent: false,
    crewPresent: false,
    recommendations: [],
    recommendationsPresent: false,
    genres: [],
    genresPresent: false,
    countries: [],
    countriesPresent: false,
    timestamps: { lastSyncedAt: SYNCED_AT, staleAfter: null },
  } as unknown as StoreMovieInput
}

function tvInput(originalLanguage: string | null): StoreTvShowInput {
  return {
    tvShow: {
      tmdbId: 998,
      imdbId: null,
      nameOriginal: '血まみれスケバンチェーンソー',
      originalLanguage,
      firstAirDate: null,
      lastAirDate: null,
      status: null,
      numberOfSeasons: null,
      numberOfEpisodes: null,
      popularity: null,
      voteAverageTmdb: null,
      voteCountTmdb: null,
      posterPath: null,
      backdropPath: null,
      certification: null,
    },
    externalIds: [],
    cast: [],
    crew: [],
    castPresent: false,
    crewPresent: false,
    recommendations: [],
    recommendationsPresent: false,
    genres: [],
    genresPresent: false,
    countries: [],
    countriesPresent: false,
    timestamps: { lastSyncedAt: SYNCED_AT, staleAfter: null },
  } as unknown as StoreTvShowInput
}

describe('a porta barra CRIACAO de titulo fora do recorte', () => {
  it('filme em `te` NAO e criado — e `movie.upsert` nunca acontece', async () => {
    const fake = makeFakePrisma(false)
    const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())

    const result = await store.upsertMovie(movieInput('te'))

    expect(isUpsertRefused(result)).toBe(true)
    // A PROVA e a chamada ausente: nao basta devolver um objeto de recusa se a
    // linha foi escrita assim mesmo.
    expect(fake.calls).not.toContain('movie.upsert')
    expect(fake.calls).not.toContain('entityExternalId.createMany')
    if (isUpsertRefused(result)) {
      expect(result.refused).toEqual({ reason: 'language_not_allowed', language: 'te' })
    }
  })

  it('serie em `ru` NAO e criada — e a cascata de temporada nem comeca', async () => {
    const fake = makeFakePrisma(false)
    const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())

    const result = await store.upsertTvShow(tvInput('ru'))

    expect(isUpsertRefused(result)).toBe(true)
    expect(fake.calls).not.toContain('tvShow.upsert')
  })

  it('os CINCO do recorte entram normalmente', async () => {
    for (const code of ['pt', 'en', 'es', 'ja', 'ko']) {
      const fake = makeFakePrisma(false)
      const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())
      const result = await store.upsertMovie(movieInput(code))
      expect(isUpsertRefused(result), `idioma ${code}`).toBe(false)
      expect(fake.calls, `idioma ${code}`).toContain('movie.upsert')
    }
  })

  it('`pt-BR` tambem entra — o gate compara pelo subtag base', async () => {
    const fake = makeFakePrisma(false)
    const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())
    expect(isUpsertRefused(await store.upsertMovie(movieInput('pt-BR')))).toBe(false)
  })

  it('payload SEM idioma e recusado, mas com motivo PROPRIO', async () => {
    const fake = makeFakePrisma(false)
    const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())
    const result = await store.upsertMovie(movieInput(null))
    expect(isUpsertRefused(result)).toBe(true)
    if (isUpsertRefused(result)) {
      // NAO e `language_not_allowed`: nao houve decisao de idioma nenhuma. Se
      // este balde crescer, o defeito e nosso — e so um rotulo separado deixa
      // isso visivel.
      expect(result.refused.reason).toBe('language_unknown')
    }
  })
})

describe('o gate e de criacao, nao de atualizacao', () => {
  it('titulo que JA existe em `te` continua sendo atualizado', async () => {
    const fake = makeFakePrisma(true)
    const store = createPrismaStore(fake.prisma, createCatalogAdmissionPolicy())

    const result = await store.upsertMovie(movieInput('te'))

    // Entre este PR e o apagamento da Parte D esses titulos ainda existem.
    // Conge-los faria todo job de reparo reportar falha em massa por linhas que
    // estao para sumir — ruido que esconde defeito de verdade.
    expect(isUpsertRefused(result)).toBe(false)
    expect(fake.calls).toContain('movie.upsert')
  })
})

describe('o recorte e configuravel, e a porta obedece', () => {
  it('acrescentar `te` ao recorte faz o mesmo filme entrar', async () => {
    const fake = makeFakePrisma(false)
    const store = createPrismaStore(
      fake.prisma,
      createCatalogAdmissionPolicy(['pt', 'en', 'es', 'ja', 'ko', 'te']),
    )
    expect(isUpsertRefused(await store.upsertMovie(movieInput('te')))).toBe(false)
    expect(fake.calls).toContain('movie.upsert')
  })
})

describe('C.4 — nenhuma recusa em silencio', () => {
  it('o contador agrega por idioma e por tipo', () => {
    const counter = createAdmissionRefusalCounter()
    const policy = createCatalogAdmissionPolicy()
    for (const code of ['te', 'te', 'ru', 'ml']) {
      const refusal = policy.admit(code)
      expect(refusal).not.toBeNull()
      if (refusal !== null) counter.record('movie', refusal)
    }
    const semIdioma = policy.admit(null)
    if (semIdioma !== null) counter.record('tv', semIdioma)

    const tally = counter.snapshot()
    expect(tally.total).toBe(5)
    expect(tally.byLanguage).toEqual({ te: 2, ru: 1, ml: 1 })
    expect(tally.byEntityType).toEqual({ movie: 4, tv: 1 })
    // "Sem idioma" fica FORA de `byLanguage`: somar os dois faria um payload
    // quebrado parecer uma decisao editorial.
    expect(tally.unknownLanguage).toBe(1)
  })

  it('a primeira chave de `byLanguage` e a de maior volume', () => {
    const counter = createAdmissionRefusalCounter()
    const policy = createCatalogAdmissionPolicy()
    for (const code of ['ml', 'te', 'te', 'te', 'ru', 'ru']) {
      const refusal = policy.admit(code)
      if (refusal !== null) counter.record('movie', refusal)
    }
    expect(Object.keys(counter.snapshot().byLanguage)).toEqual(['te', 'ru', 'ml'])
  })

  it('o `error_code` distingue os dois motivos e carrega o idioma', () => {
    expect(refusalErrorCode({ reason: 'language_not_allowed', language: 'te' })).toBe(
      'language_not_allowed:te',
    )
    expect(refusalErrorCode({ reason: 'language_unknown', language: null })).toBe(
      'language_unknown',
    )
  })

  it('contador zerado diz que nada foi recusado — nao imprime tabela vazia', () => {
    expect(formatRefusalTally(createAdmissionRefusalCounter().snapshot())).toBe(
      'recorte de idioma: nenhum titulo recusado',
    )
  })

  it('a linha de log traz os idiomas e os tipos', () => {
    const counter = createAdmissionRefusalCounter()
    const policy = createCatalogAdmissionPolicy()
    for (const code of ['te', 'te', 'ru']) {
      const refusal = policy.admit(code)
      if (refusal !== null) counter.record('movie', refusal)
    }
    const linha = formatRefusalTally(counter.snapshot())
    expect(linha).toContain('3 titulo(s) recusado(s)')
    expect(linha).toContain('te=2')
    expect(linha).toContain('ru=1')
    expect(linha).toContain('movie=3')
  })
})
