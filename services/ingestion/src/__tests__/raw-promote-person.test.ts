/**
 * Testes da promocao de PESSOA via o core generico (P0-00f.3): a strategy
 * `person` promove SO a ficha basica (people) + external_ids + slug + traducao
 * (title=name), reusando `promoteFromRaw`. Prova que NAO cria filmografia
 * (cast/crew), NAO tem bio/summary e que os tres wrappers (movie/tv/person)
 * passam pelo MESMO core. Sem rede, sem DB — fakes.
 */

import { describe, expect, it } from 'vitest'
import type {
  CreditsWriteOutcome,
  EntityStorePort,
  StorePersonInput,
  UpsertOutcome,
} from '../ports.js'
import {
  promoteMoviesFromRaw,
  promotePeopleFromRaw,
  promoteTvShowsFromRaw,
  readPersonDisplayFields,
} from '../raw-promote/run.js'
import type {
  CatalogFinalizePort,
  RawEntityRow,
  RawMovieSource,
  RawPersonSource,
  RawTvSource,
} from '../raw-promote/types.js'

const NOW = () => new Date('2026-07-09T00:00:00.000Z')
const FETCHED = new Date('2026-07-01T00:00:00.000Z')

/** Payload de pessoa valido para normalizePerson. */
function personRow(id: number, over: Record<string, unknown> = {}): RawEntityRow {
  return {
    tmdbId: id,
    baseLanguage: 'pt-BR',
    fetchedAt: FETCHED,
    payload: {
      id,
      name: `Pessoa ${id}`,
      known_for_department: 'Acting',
      birthday: '1980-05-01',
      deathday: null,
      place_of_birth: 'Rio de Janeiro',
      profile_path: `/pf${id}.jpg`,
      imdb_id: `nm000${id}138`,
      // A biografia SEMPRE chegou no payload. Ate 20/08/2026 esta linha dizia
      // "a promocao NAO a persiste (fora de escopo)" e fixava o descarte como
      // esperado — `people` tinha a coluna de governanca da bio e nao tinha a de
      // texto. Agora tem, e a promocao grava.
      biography: 'Uma biografia longa, escrita pela fonte.',
      ...over,
    },
  }
}

function makePersonSource(rows: readonly RawEntityRow[]): RawPersonSource & { listed: number[] } {
  const listed: number[] = []
  return {
    listed,
    countPeople: () => Promise.resolve(rows.length),
    listPersonPayloads: (limit: number) => {
      const slice = rows.slice(0, Math.max(0, limit))
      listed.push(slice.length)
      return Promise.resolve(slice)
    },
  }
}

/** Resumo neutro: estes spies nunca devem ser chamados pela promocao de pessoa. */
const NO_CREDITS_WRITTEN: CreditsWriteOutcome = {
  castReplaced: false,
  crewReplaced: false,
  castLinked: 0,
  crewLinked: 0,
  castDropped: 0,
  crewDropped: 0,
}

/** Store fake: upsertPerson idempotente + spies em upsertMovie/upsertTvShow. */
function makePersonStore(seeded: number[] = []) {
  const seen = new Set<number>(seeded)
  const personCalls: StorePersonInput[] = []
  const movieCalls: unknown[] = []
  const tvCalls: unknown[] = []
  let idSeq = 700
  const store: EntityStorePort = {
    upsertPerson(input: StorePersonInput): Promise<UpsertOutcome> {
      const created = !seen.has(input.person.tmdbId)
      seen.add(input.person.tmdbId)
      idSeq += 1
      personCalls.push(input)
      return Promise.resolve({ id: String(idSeq), created })
    },
    upsertMovie: (input) => {
      movieCalls.push(input)
      return Promise.resolve({ id: '0', created: true, credits: NO_CREDITS_WRITTEN })
    },
    upsertTvShow: (input) => {
      tvCalls.push(input)
      return Promise.resolve({ id: '0', created: true, credits: NO_CREDITS_WRITTEN })
    },
    touchMovie: () => Promise.reject(new Error('n/a')),
    touchTvShow: () => Promise.reject(new Error('n/a')),
    upsertSeasonWithEpisodes: () => Promise.reject(new Error('n/a')),
    touchSeason: () => Promise.reject(new Error('n/a')),
    touchPerson: () => Promise.reject(new Error('n/a')),
  }
  return { store, personCalls, movieCalls, tvCalls }
}

function makeFinalize() {
  const slugCalls: Array<{ entityType: string; entityId: string; desiredSlug: string; tmdbId: number }> = []
  const translationCalls: Array<{ entityType: string; entityId: string; title: string; summary: string | null }> = []
  const finalize: CatalogFinalizePort = {
    upsertCanonicalSlug(entityType, entityId, desiredSlug, tmdbId) {
      slugCalls.push({ entityType, entityId, desiredSlug, tmdbId })
      return Promise.resolve(desiredSlug)
    },
    upsertTranslation(entityType, entityId, title, summary) {
      translationCalls.push({ entityType, entityId, title, summary })
      return Promise.resolve()
    },
  }
  return { finalize, slugCalls, translationCalls }
}

const personOpts = (
  source: RawPersonSource,
  store: EntityStorePort,
  finalize: CatalogFinalizePort,
  over: Partial<Parameters<typeof promotePeopleFromRaw>[0]> = {},
): Parameters<typeof promotePeopleFromRaw>[0] => ({
  source,
  store,
  finalize,
  baseLanguage: 'pt-BR',
  limit: 100,
  now: NOW,
  dryRun: false,
  ...over,
})

describe('readPersonDisplayFields', () => {
  /**
   * A biografia passou a ser PERSISTIDA (em `people.biography`), e mesmo assim
   * ela continua fora de `overview`. Nao e inconsistencia: `overview` alimenta
   * `entity_translations.summary`, que e o resumo curto da entidade. Biografia e
   * conteudo editorial longo, com governanca propria (`biography_source_status`)
   * e coluna propria. Misturar os dois faria a bio inteira virar meta-description.
   */
  it('le so o name; overview sempre null MESMO com bio no payload', () => {
    // A bio de pessoa tem leitor PROPRIO (`readPersonBiography`), com a mesma
    // cadeia topo -> `translations` pt-BR. Ela continua fora de `overview`.
    expect(readPersonDisplayFields({ name: 'Fernanda Montenegro', biography: 'x' })).toEqual({
      title: 'Fernanda Montenegro',
      overview: null,
      overviewSource: null,
    })
    expect(readPersonDisplayFields({})).toEqual({ title: '', overview: null, overviewSource: null })
    expect(readPersonDisplayFields(null)).toEqual({
      title: '',
      overview: null,
      overviewSource: null,
    })
  })
})

describe('promotePeopleFromRaw', () => {
  it('promove ficha basica (people) via upsertPerson', async () => {
    const { store, personCalls } = makePersonStore()
    const { finalize } = makeFinalize()
    const report = await promotePeopleFromRaw(personOpts(makePersonSource([personRow(1)]), store, finalize))

    expect(report.entityType).toBe('person')
    expect(report.counts).toEqual({ created: 1, updated: 0, failed: 0 })
    const input = personCalls[0]!
    expect(input.person.name).toBe('Pessoa 1')
    expect(input.person.knownForDepartment).toBe('Acting')
    expect(input.person.placeOfBirth).toBe('Rio de Janeiro')
    expect(input.person.profilePath).toBe('/pf1.jpg')
    expect(input.person.biography).toBe('Uma biografia longa, escrita pela fonte.')
    expect(input.lastSyncedAt).toEqual(FETCHED)
  })

  it('biografia AUSENTE ou vazia vira null — nunca string vazia', async () => {
    // Um paragrafo em branco no banco seria pior que a ausencia: a pagina o
    // renderizaria como bloco vazio em vez de registrar `no_biography_source`.
    for (const valor of [undefined, null, '', '   ']) {
      const { store, personCalls } = makePersonStore()
      const { finalize } = makeFinalize()
      await promotePeopleFromRaw(
        personOpts(makePersonSource([personRow(1, { biography: valor })]), store, finalize),
      )
      expect(personCalls[0]!.person.biography, `valor: ${JSON.stringify(valor)}`).toBeNull()
    }
  })

  it('NEGATIVO: persistir o texto NAO liga a exibicao', async () => {
    // Sao dois passos, como em ratings e em streaming. `biographySourceStatus`
    // (a coluna que governa a tela, invariante 6) nao e escrita pela promocao:
    // ela nem aparece no upsert. Se um dia aparecer, este teste reprova.
    const { store, personCalls } = makePersonStore()
    const { finalize } = makeFinalize()
    await promotePeopleFromRaw(personOpts(makePersonSource([personRow(1)]), store, finalize))
    expect(Object.keys(personCalls[0]!.person)).not.toContain('biographySourceStatus')
  })

  it('promove external_ids (imdb + tmdb_person)', async () => {
    const { store, personCalls } = makePersonStore()
    const { finalize } = makeFinalize()
    await promotePeopleFromRaw(personOpts(makePersonSource([personRow(1)]), store, finalize))
    const input = personCalls[0]!
    expect(input.externalIds.length).toBeGreaterThan(0)
    expect(input.externalIds.some((e) => e.source === 'imdb')).toBe(true)
  })

  it('cria slug canonico + traducao pt-BR do tipo person (title=name, summary=null)', async () => {
    const { store } = makePersonStore()
    const { finalize, slugCalls, translationCalls } = makeFinalize()
    await promotePeopleFromRaw(personOpts(makePersonSource([personRow(1)]), store, finalize))

    // slug sem ano (pessoa nao tem ano): slugify(name).
    expect(slugCalls[0]).toMatchObject({ entityType: 'person', desiredSlug: 'pessoa-1', tmdbId: 1 })
    expect(translationCalls[0]).toEqual({
      entityType: 'person',
      entityId: slugCalls[0]!.entityId,
      title: 'Pessoa 1',
      summary: null, // sem bio: a person-page nao le translation.summary
    })
  })

  it('NAO cria filmografia (nao chama upsertMovie/upsertTvShow)', async () => {
    const { store, personCalls, movieCalls, tvCalls } = makePersonStore()
    const { finalize } = makeFinalize()
    await promotePeopleFromRaw(personOpts(makePersonSource([personRow(1), personRow(2)]), store, finalize))
    expect(personCalls).toHaveLength(2)
    expect(movieCalls).toHaveLength(0)
    expect(tvCalls).toHaveLength(0)
  })

  it('re-run e idempotente: 2a execucao vira updated', async () => {
    const rows = [personRow(1), personRow(2)]
    const { store, personCalls } = makePersonStore()
    const { finalize } = makeFinalize()
    const r1 = await promotePeopleFromRaw(personOpts(makePersonSource(rows), store, finalize))
    expect(r1.counts).toEqual({ created: 2, updated: 0, failed: 0 })
    const r2 = await promotePeopleFromRaw(personOpts(makePersonSource(rows), store, finalize))
    expect(r2.counts).toEqual({ created: 0, updated: 2, failed: 0 })
    expect(personCalls).toHaveLength(4)
  })

  it('dry-run: so conta (nao chama store nem finalize)', async () => {
    const source = makePersonSource([personRow(1), personRow(2), personRow(3)])
    const { store, personCalls } = makePersonStore()
    const { finalize, slugCalls } = makeFinalize()
    const report = await promotePeopleFromRaw(personOpts(source, store, finalize, { limit: 2, dryRun: true }))

    expect(report.mode).toBe('dry-run')
    expect(report.available).toBe(3)
    expect(report.selected).toBe(2)
    expect(source.listed).toEqual([])
    expect(personCalls).toHaveLength(0)
    expect(slugCalls).toHaveLength(0)
  })
})

describe('os tres wrappers passam pelo core (entityType correto)', () => {
  it('movie -> movie, tv -> tv, person -> person', async () => {
    const { store } = makePersonStore()
    const { finalize } = makeFinalize()
    const movieSource: RawMovieSource = {
      countMovies: () => Promise.resolve(0),
      listMoviePayloads: () => Promise.resolve([]),
    }
    const tvSource: RawTvSource = {
      countTvShows: () => Promise.resolve(0),
      listTvShowPayloads: () => Promise.resolve([]),
    }
    const common = { store, finalize, baseLanguage: 'pt-BR', limit: 5, now: NOW, dryRun: true }
    const movie = await promoteMoviesFromRaw({ source: movieSource, ...common })
    const tv = await promoteTvShowsFromRaw({ source: tvSource, ...common })
    const person = await promotePeopleFromRaw({ source: makePersonSource([]), ...common })
    expect(movie.entityType).toBe('movie')
    expect(tv.entityType).toBe('tv')
    expect(person.entityType).toBe('person')
  })
})
