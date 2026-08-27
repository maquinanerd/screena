/**
 * catalog-in-clause-fits-postgres.test.ts — NENHUMA CONSULTA DA HOME/LISTAGEM
 * MANDA O CATALOGO INTEIRO NUM `IN (...)`.
 *
 * ============ POR QUE ESTE ARQUIVO EXISTE ============
 *
 * Em 27/08/2026 a home devolveu 500 com
 *
 *   prisma.entityTranslation.findMany() — too many bind variables:
 *   max 32767, received 32769   (P2035)
 *
 * O PostgreSQL carrega a contagem de parametros de uma consulta preparada num
 * campo de 16 bits: 32.767 e teto de PROTOCOLO, nao de configuracao. Os
 * loaders liam "todos os ids do catalogo" e os devolviam num unico
 * `entityId: { in: ids }` — correto com 129 filmes, fatal com 32.767.
 *
 * O que este teste mede e o TAMANHO DO LOTE, nao o markup: um cliente Prisma
 * falso registra cada consulta, e a assercao varre recursivamente todo `in:`
 * de todo `where`. Com o defeito de pe, o catalogo de 12.001 titulos abaixo
 * produz um lote de 12.001 ids e o teste reprova; com o fatiamento, nenhum
 * lote passa de `PRISMA_IN_CHUNK_SIZE`.
 *
 * O catalogo falso e deliberadamente MAIOR que um lote e MENOR que o teto real
 * (12.001 > 5.000): o teste precisa provar o fatiamento, e nao gastar segundos
 * montando 33 mil objetos para provar a mesma coisa.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PRISMA_IN_CHUNK_SIZE } from '../../lib/prisma-in-chunks'

/** Teto REAL do protocolo do PostgreSQL: parametros por consulta preparada. */
const POSTGRES_MAX_BIND_VARIABLES = 32_767

/** Catalogo falso maior que um lote — sem isso o fatiamento nao seria exercido. */
const CATALOG_SIZE = 12_001
const CATALOG_IDS = Array.from({ length: CATALOG_SIZE }, (_, i) => BigInt(i + 1))

const NOW = new Date('2026-08-27T12:00:00.000Z')
const FUTURE = new Date('2027-01-01T00:00:00.000Z')

interface RecordedCall {
  model: string
  method: string
  args: Record<string, unknown>
}

const calls: RecordedCall[] = []

/** Ids pedidos por um `where` (ou o catalogo inteiro, quando o filtro nao existe). */
function requestedIds(where: unknown): bigint[] {
  const filter = (where ?? {}) as Record<string, { in?: bigint[] } | undefined>
  const scoped = filter.entityId?.in ?? filter.id?.in
  return scoped ?? CATALOG_IDS
}

function rowsFor(model: string, method: string, args: Record<string, unknown>): unknown {
  if (method !== 'findMany') return method === 'count' ? 0 : null

  const where = args.where as Record<string, unknown> | undefined
  const entityType = (where?.entityType as string | undefined) ?? 'movie'
  const ids = requestedIds(where)

  switch (model) {
    case 'slug':
      return ids.map((entityId) => ({ entityType, entityId, slug: `titulo-${entityId}` }))
    case 'entityTranslation':
      return ids.map((entityId) => ({
        entityType,
        entityId,
        title: `Titulo ${entityId}`,
        summary: `Resumo ${entityId}`,
      }))
    case 'movie':
      return ids.map((id) => ({
        id,
        tmdbId: Number(id),
        titleOriginal: `Filme ${id}`,
        releaseDate: FUTURE,
        voteCountTmdb: 1_000,
        status: 'Released',
        certification: null,
        screenScore: null,
        screenScoreScale: null,
        screenScoreDisplay: false,
        backdropPath: '/b.jpg',
        posterPath: '/p.jpg',
      }))
    case 'tvShow':
      return ids.map((id) => ({
        id,
        tmdbId: Number(id),
        nameOriginal: `Serie ${id}`,
        firstAirDate: FUTURE,
        lastAirDate: null,
        voteCountTmdb: 1_000,
        status: 'Returning Series',
        numberOfSeasons: 1,
        numberOfEpisodes: 8,
        certification: null,
        screenScore: null,
        screenScoreScale: null,
        screenScoreDisplay: false,
        backdropPath: '/b.jpg',
        posterPath: '/p.jpg',
      }))
    case 'person':
      return ids.map((id) => ({
        id,
        name: `Pessoa ${id}`,
        knownForDepartment: 'Acting',
        profilePath: null,
      }))
    default:
      return []
  }
}

/** Cliente Prisma falso que REGISTRA toda consulta (qualquer modelo/metodo). */
const fakePrisma = new Proxy(
  {},
  {
    get(_target, model: string | symbol) {
      if (typeof model === 'symbol') return undefined
      return new Proxy(
        {},
        {
          get(_inner, method: string | symbol) {
            if (typeof method === 'symbol') return undefined
            return (args: Record<string, unknown> = {}) => {
              calls.push({ model, method, args })
              return Promise.resolve(rowsFor(model, method, args))
            }
          },
        },
      )
    },
  },
)

vi.mock('@screena/db/server', () => ({
  getPrismaClient: () => fakePrisma,
}))

/** Todo array sob uma chave `in:`, em qualquer profundidade do `where`. */
function inClauseSizes(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) {
    for (const item of value) inClauseSizes(item, out)
    return out
  }
  if (value === null || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'in' || key === 'notIn') && Array.isArray(child)) out.push(child.length)
    else inClauseSizes(child, out)
  }
  return out
}

/** Parametros de uma consulta: os ids do `IN (...)` MAIS os escalares do lado. */
function scalarCount(value: unknown): number {
  if (value === null || typeof value !== 'object') return 1
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + scalarCount(item), 0)
  return Object.entries(value as Record<string, unknown>).reduce<number>(
    (sum, [, child]) => sum + scalarCount(child),
    0,
  )
}

function assertEveryQueryFits(): void {
  expect(calls.length).toBeGreaterThan(0)
  for (const call of calls) {
    for (const size of inClauseSizes(call.args.where)) {
      expect(
        size,
        `${call.model}.${call.method} recebeu um lote de ${size} ids`,
      ).toBeLessThanOrEqual(PRISMA_IN_CHUNK_SIZE)
    }
    const binds = scalarCount(call.args.where)
    expect(
      binds,
      `${call.model}.${call.method} gastaria ${binds} bind variables`,
    ).toBeLessThanOrEqual(POSTGRES_MAX_BIND_VARIABLES)
  }
}

/** O maior lote observado — a medida que o defeito de producao estourava. */
function largestBatch(): number {
  return calls
    .flatMap((call) => inClauseSizes(call.args.where))
    .reduce((max, size) => Math.max(max, size), 0)
}

beforeEach(() => {
  calls.length = 0
})

describe(`catalogo de ${CATALOG_SIZE} titulos nao estoura o IN (...)`, () => {
  it('(1) hero da home: nenhuma consulta leva o catalogo inteiro', async () => {
    const { loadHeroSlides } = await import('../home-hero')
    await loadHeroSlides(fakePrisma as never, 'home', NOW)

    // O caminho FOI exercido: sem isto, um loader que nao consultasse nada
    // passaria calado (asserção sobre lote vazio é sempre verdadeira).
    expect(largestBatch()).toBeGreaterThan(0)
    assertEveryQueryFits()
  })

  it('(2) "Em breve" da home: idem, incluindo os trailers por tmdb_id', async () => {
    const { getHomeUpcomingMovies } = await import('../home-upcoming')
    await getHomeUpcomingMovies()

    expect(calls.some((call) => call.model === 'tmdbVideo')).toBe(true)
    assertEveryQueryFits()
  })

  it('(3) listagem /pt/filmes: idem', async () => {
    const { getMovieIndexData } = await import('../entity-indexes')
    await getMovieIndexData()

    expect(largestBatch()).toBeGreaterThan(0)
    assertEveryQueryFits()
  })

  it('(4) listagem /pt/pessoas: idem', async () => {
    const { getPersonIndexData } = await import('../entity-indexes')
    await getPersonIndexData()

    expect(largestBatch()).toBeGreaterThan(0)
    assertEveryQueryFits()
  })
})
