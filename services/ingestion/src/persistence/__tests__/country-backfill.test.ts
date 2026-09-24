/**
 * Backfill de pais de origem (nucleo, com banco fake de SQL cru).
 *
 * O que so o PostgreSQL prova — o `NOT EXISTS` na instrucao de escrita, o
 * `unnest` dos arrays, a leitura do `jsonb` guardado — esta em
 * `scripts/validate-country-backfill-real-postgres.ts`. Aqui fica a DECISAO:
 * qual fonte ganha, qual motivo de descarte, e que `--dry-run` le sem escrever.
 */

import { describe, expect, it } from 'vitest'
import {
  backfillTitleCountries,
  writeTitleCountriesIfEmpty,
  type CountryBackfillDb,
} from '../country-backfill.js'

interface FakeTitle {
  readonly id: bigint
  readonly tmdbId: number
  readonly title: string
}

/**
 * Banco fake: responde as tres leituras pelo texto do SQL e REGISTRA toda
 * chamada. `cache`/`raw` guardam o CAMPO de pais de cada payload (`undefined`
 * = payload sem o campo; chave ausente = nao ha payload).
 */
function fakeDb(input: {
  readonly movies: readonly FakeTitle[]
  readonly cache?: Readonly<Record<number, unknown>>
  readonly raw?: Readonly<Record<number, unknown>>
  readonly executeResult?: number
}) {
  const reads: string[] = []
  const writes: { sql: string; params: unknown[] }[] = []
  const db = {
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      if (sql.includes('FROM movies e')) {
        reads.push('candidates')
        const after = BigInt(String(params[0]))
        const limit = Number(params[1])
        return input.movies.filter((m) => m.id > after).slice(0, limit).map((m) => ({
          entity_id: m.id,
          tmdb_id: m.tmdbId,
          title: m.title,
        }))
      }
      if (sql.includes('FROM api_cache')) {
        reads.push('api_cache')
        const endpoints = params[0] as string[]
        return endpoints
          .map((endpoint) => Number(endpoint.slice('/movie/'.length)))
          .filter((id) => input.cache !== undefined && id in input.cache)
          .map((id) => ({ key: `/movie/${id}`, countries: { v: input.cache![id] ?? null } }))
      }
      if (sql.includes('FROM tmdb_raw')) {
        reads.push('tmdb_raw')
        const ids = params[0] as number[]
        return ids
          .filter((id) => input.raw !== undefined && id in input.raw)
          .map((id) => ({ key: id, countries: { v: input.raw![id] ?? null } }))
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
    async $executeRawUnsafe(sql: string, ...params: unknown[]) {
      writes.push({ sql, params })
      return input.executeResult ?? (params[0] as unknown[]).length
    },
  }
  return { db: db as unknown as CountryBackfillDb, reads, writes }
}

const US = [{ iso_3166_1: 'US', name: 'United States of America' }]

describe('backfillTitleCountries', () => {
  it('--dry-run LE o banco (candidatos + payload) e NAO escreve nada', async () => {
    const { db, reads, writes } = fakeDb({
      movies: [{ id: 1n, tmdbId: 272, title: 'Batman Begins' }],
      cache: { 272: US },
    })
    const report = await backfillTitleCountries(db, { entityTypes: ['movie'], dryRun: true })
    expect(reads).toEqual(['candidates', 'api_cache', 'tmdb_raw'])
    expect(writes).toEqual([])
    expect(report).toMatchObject({
      dryRun: true,
      candidates: 1,
      recovered: 1,
      titlesWritten: 0,
      rowsWritten: 0,
      externalCallsMade: 0,
    })
    expect(report.samples[0]).toMatchObject({ tmdbId: 272, countries: ['US'], from: 'api_cache' })
  })

  it('--apply grava so os recuperados, pelo id interno, com o guard na escrita', async () => {
    const { db, writes } = fakeDb({
      movies: [
        { id: 1n, tmdbId: 272, title: 'A' },
        { id: 2n, tmdbId: 999, title: 'B' },
      ],
      cache: { 272: US, 999: [] },
    })
    const report = await backfillTitleCountries(db, { entityTypes: ['movie'], dryRun: false })
    expect(writes).toHaveLength(1)
    expect(writes[0]?.sql).toMatch(/NOT EXISTS/)
    expect(writes[0]?.params).toEqual([['US'], [0], '1'])
    expect(report).toMatchObject({ recovered: 1, titlesWritten: 1, rowsWritten: 1 })
    expect(report.skipped).toEqual({ empty_country_list_in_payload: 1 })
  })

  it('separa os motivos: sem payload, payload sem o campo, lista VAZIA do TMDB', async () => {
    const { db } = fakeDb({
      movies: [
        { id: 1n, tmdbId: 10, title: 'sem payload' },
        { id: 2n, tmdbId: 20, title: 'sem campo' },
        { id: 3n, tmdbId: 30, title: 'lista vazia' },
      ],
      cache: { 20: undefined, 30: [] },
    })
    const report = await backfillTitleCountries(db, { entityTypes: ['movie'], dryRun: true })
    expect(report.recovered).toBe(0)
    expect(report.skipped).toEqual({
      no_stored_payload: 1,
      no_country_field_in_payload: 1,
      empty_country_list_in_payload: 1,
    })
  })

  it('cache com lista vazia NAO esconde o tmdb_raw com pais', async () => {
    const { db } = fakeDb({
      movies: [{ id: 1n, tmdbId: 607, title: 'MIB' }],
      cache: { 607: [] },
      raw: { 607: US },
    })
    const report = await backfillTitleCountries(db, { entityTypes: ['movie'], dryRun: true })
    expect(report.byPayloadSource).toEqual({ api_cache: 0, tmdb_raw: 1 })
  })

  it('escrita recusada pelo guard (titulo ganhou pais no meio) vira refusedAlreadyFilled', async () => {
    const { db } = fakeDb({
      movies: [{ id: 1n, tmdbId: 272, title: 'A' }],
      cache: { 272: US },
      executeResult: 0,
    })
    const report = await backfillTitleCountries(db, { entityTypes: ['movie'], dryRun: false })
    expect(report).toMatchObject({ titlesWritten: 0, refusedAlreadyFilled: 1 })
  })
})

describe('writeTitleCountriesIfEmpty', () => {
  it('lista vazia nao vai ao banco', async () => {
    const { db, writes } = fakeDb({ movies: [] })
    expect(await writeTitleCountriesIfEmpty(db, 'tv', 'tmdb_id', 1, [])).toBe(0)
    expect(writes).toEqual([])
  })

  it('chave por tmdb_id (import) usa cast integer; por id (backfill) usa bigint', async () => {
    const { db, writes } = fakeDb({ movies: [] })
    await writeTitleCountriesIfEmpty(db, 'tv', 'tmdb_id', 433, [{ countryCode: 'KR', position: 0 }])
    await writeTitleCountriesIfEmpty(db, 'movie', 'id', 7n, [{ countryCode: 'US', position: 0 }])
    expect(writes[0]?.sql).toMatch(/tv_show_origin_countries/)
    expect(writes[0]?.sql).toMatch(/e\.tmdb_id = \$3::integer/)
    expect(writes[1]?.sql).toMatch(/movie_production_countries/)
    expect(writes[1]?.sql).toMatch(/e\.id = \$3::bigint/)
  })
})
