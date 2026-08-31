/**
 * quota-exhaustion.test.ts — O estouro de cota da OMDb, reconhecido.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO PRECISA PROVAR, E O QUE NAO BASTA
 * ============================================================================
 * Nao basta "a string e reconhecida". A OMDb responde **HTTP 200** para TODO
 * erro, entao um classificador que devolvesse `quota` para qualquer
 * `Response: "False"` passaria num teste que so exercitasse o caso positivo — e
 * ai o breaker abriria em cima de um "Movie not found!", matando o lote inteiro
 * por causa de um id ruim.
 *
 * Por isso todo caso positivo aqui vem com o seu CONTROLE NEGATIVO, e o negativo
 * e o que faz o teste valer: ele distingue "reconhece cota" de "reconhece
 * qualquer coisa".
 *
 * E o teste do LOTE nao mede a existencia da clausula — mede o EFEITO: quantos
 * ids foram efetivamente consultados depois da recusa. Um teste que fizesse grep
 * na fonte nao distinguiria mundo nenhum.
 */

import { describe, expect, it } from 'vitest'

import { classifyOmdbError, omdbErrorAbortsBatch } from '../error-response.js'
import { mapOmdbPayload } from '../mapping.js'
import { runOmdbRatingsSync, type OmdbRunDeps, type OmdbRunOptions } from '../run.js'
import type { RatingsEntityCandidate } from '../../ports.js'

const PROVIDER = 'omdb'

/** O corpo que a OMDb devolve, com HTTP 200, quando o teto e atingido. */
const QUOTA_BODY = { Response: 'False', Error: 'Request limit reached!' }
/** A OUTRA redacao publicada para o mesmo fato. */
const QUOTA_BODY_DAILY = { Response: 'False', Error: 'Daily request limit reached!' }
/** O caso legitimo: fato sobre o titulo, o lote deve continuar. */
const NOT_FOUND_BODY = { Response: 'False', Error: 'Movie not found!' }

/** Payload valido com as tres fontes — para provar que o lote seguiria. */
function goodBody(imdbId: string): Record<string, unknown> {
  return {
    Response: 'True',
    imdbID: imdbId,
    Ratings: [
      { Source: 'Internet Movie Database', Value: '7.6/10' },
      { Source: 'Rotten Tomatoes', Value: '85%' },
      { Source: 'Metacritic', Value: '67/100' },
    ],
  }
}

describe('classifyOmdbError distingue o DIA do TITULO', () => {
  it('reconhece as DUAS redacoes de estouro de cota', () => {
    expect(classifyOmdbError('Request limit reached!')).toBe('quota')
    expect(classifyOmdbError('Daily request limit reached!')).toBe('quota')
  })

  it('reconhece variacoes de caixa e pontuacao', () => {
    // Uma igualdade exata contra "Request limit reached!" daria falso para
    // qualquer uma destas — e o modo de falha seria o proprio defeito, com um
    // teste verde por cima.
    expect(classifyOmdbError('REQUEST LIMIT REACHED')).toBe('quota')
    expect(classifyOmdbError('  Daily request-limit reached.  ')).toBe('quota')
  })

  it('CONTROLE NEGATIVO: erro sobre o TITULO nao e cota', () => {
    // Este e o caso que precisa continuar barato: id que nao existe. Se ele
    // virasse `quota`, um unico id ruim mataria o lote inteiro.
    expect(classifyOmdbError('Movie not found!')).toBe('not-found')
    expect(classifyOmdbError('Series not found!')).toBe('not-found')
    expect(classifyOmdbError('Incorrect IMDb ID.')).toBe('not-found')
    expect(classifyOmdbError('Error getting data.')).toBe('not-found')
  })

  it('credencial e um terceiro fato, e tambem interrompe', () => {
    expect(classifyOmdbError('Invalid API key!')).toBe('auth')
    expect(classifyOmdbError('No API key provided.')).toBe('auth')
  })

  it('erro desconhecido cai em not-found (fail-open), nao em cota', () => {
    // Deliberado: tratar o desconhecido como cota abriria o breaker e mataria o
    // ciclo por causa de uma redacao nova. A perda do outro lado e um id.
    expect(classifyOmdbError('Something entirely new happened')).toBe('not-found')
    expect(classifyOmdbError(undefined)).toBe('not-found')
    expect(classifyOmdbError(42)).toBe('not-found')
    expect(classifyOmdbError('')).toBe('not-found')
  })

  it('so cota e credencial interrompem o lote', () => {
    expect(omdbErrorAbortsBatch('quota')).toBe(true)
    expect(omdbErrorAbortsBatch('auth')).toBe(true)
    expect(omdbErrorAbortsBatch('not-found')).toBe(false)
  })
})

describe('o mapper devolve motivos DISTINTOS para cota e para titulo', () => {
  it('cota vira `omdb-quota-exhausted`', () => {
    const mapping = mapOmdbPayload(QUOTA_BODY, PROVIDER)
    expect(mapping.recognized).toBe(false)
    expect(mapping.ratings).toHaveLength(0)
    expect(mapping.rejections.map((r) => r.reason)).toEqual(['omdb-quota-exhausted'])
    // O detalhe carrega o texto do fornecedor: e a UNICA evidencia externa de
    // cota que temos, porque a OMDb nao publica cabecalho nenhum.
    expect(mapping.rejections[0]?.detail).toContain('Request limit reached!')
  })

  it('CONTROLE NEGATIVO: titulo inexistente continua `omdb-error-response`', () => {
    const mapping = mapOmdbPayload(NOT_FOUND_BODY, PROVIDER)
    expect(mapping.rejections.map((r) => r.reason)).toEqual(['omdb-error-response'])
  })

  it('os dois motivos NAO colapsam — era o defeito', () => {
    const cota = mapOmdbPayload(QUOTA_BODY_DAILY, PROVIDER).rejections[0]?.reason
    const titulo = mapOmdbPayload(NOT_FOUND_BODY, PROVIDER).rejections[0]?.reason
    expect(cota).not.toBe(titulo)
  })
})

// ---------------------------------------------------------------------------
// O LOTE: o que importa e quantos ids foram REALMENTE consultados.
// ---------------------------------------------------------------------------

interface Harness {
  readonly deps: OmdbRunDeps
  /** Ids efetivamente pedidos a rede, na ordem. */
  readonly asked: string[]
  /** Quantas vezes o circuito foi mandado abrir. */
  readonly trips: () => number
}

function harness(bodyFor: (imdbId: string) => unknown, candidates: readonly string[]): Harness {
  const asked: string[] = []
  let trips = 0
  const rows: RatingsEntityCandidate[] = candidates.map((imdbId, index) => ({
    entityType: 'movie',
    entityId: String(index + 1),
    imdbId,
    tmdbId: null,
  }))

  return {
    asked,
    trips: () => trips,
    deps: {
      fetchTitle: (imdbId: string) => {
        asked.push(imdbId)
        return Promise.resolve(bodyFor(imdbId))
      },
      cache: { write: () => Promise.resolve() },
      syncLog: { write: () => Promise.resolve() },
      entities: {
        findByImdbId: () => Promise.resolve(null),
        findByTmdbId: () => Promise.resolve(null),
      },
      candidates: {
        selectStaleByType: () => Promise.resolve({ candidates: rows, skippedFresh: 0 }),
      },
      ratings: { upsert: () => Promise.resolve({ created: false, changed: false }) },
      now: () => new Date('2026-08-31T12:00:00.000Z'),
      requestCount: () => asked.length,
      tripProviderCircuit: () => {
        trips += 1
      },
    },
  }
}

const OPTIONS: OmdbRunOptions = {
  apply: false,
  sample: true,
  entityType: 'movie',
  id: null,
  limit: 5,
  providerApi: PROVIDER,
  cacheTtlMs: 1000,
  ignoreFreshness: false,
  mode: 'coverage',
}

const IDS = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005']

describe('estouro de cota INTERROMPE o lote', () => {
  it('a recusa no 2o id impede que o 3o, 4o e 5o sejam consultados', async () => {
    // A medida e o EFEITO: `asked` tem os ids que a rede realmente recebeu.
    // Antes desta leva, `asked` teria os cinco — cada um contado pelo
    // fornecedor, nenhum trazendo nota.
    const h = harness((id) => (id === IDS[1] ? QUOTA_BODY : goodBody(id)), IDS)
    const result = await runOmdbRatingsSync(OPTIONS, h.deps)

    expect(h.asked).toEqual([IDS[0], IDS[1]])
    expect(h.asked).toHaveLength(2)
    expect(result.idsAbortedByProviderQuota).toBe(3)
    expect(result.status).toBe('aborted')
    expect(result.errorCode).toBe('omdb-quota-exhausted')
    expect(result.rejections.some((r) => r.reason === 'batch-aborted')).toBe(true)
  })

  it('o circuito e ABERTO — o proximo processo nao recomeca gastando', async () => {
    const h = harness(() => QUOTA_BODY, IDS)
    await runOmdbRatingsSync(OPTIONS, h.deps)
    expect(h.trips()).toBe(1)
  })

  it('credencial invalida interrompe pelo mesmo motivo', async () => {
    const h = harness(
      (id) => (id === IDS[0] ? { Response: 'False', Error: 'Invalid API key!' } : goodBody(id)),
      IDS,
    )
    const result = await runOmdbRatingsSync(OPTIONS, h.deps)
    expect(h.asked).toHaveLength(1)
    expect(result.errorCode).toBe('omdb-auth-rejected')
    expect(h.trips()).toBe(1)
  })

  it('o id barrado NAO e marcado como sem nota: nada e gravado por ele', async () => {
    // Cota e fato sobre o DIA. Se o id virasse "sem nota", ele sairia da fila de
    // candidatos e a pagina nasceria muda para sempre.
    const h = harness(() => QUOTA_BODY, IDS)
    const result = await runOmdbRatingsSync(OPTIONS, h.deps)
    expect(result.counters.ratingsWritten).toBe(0)
    expect(result.counters.ratingsRecognized).toBe(0)
  })
})

describe('CONTROLE NEGATIVO do lote: "nao encontrado" NAO interrompe', () => {
  it('um id inexistente no meio deixa os cinco serem consultados', async () => {
    // Este e o caso legitimo, e e ele que da valor ao teste positivo: se a
    // interrupcao disparasse aqui tambem, um unico id ruim custaria o lote.
    const h = harness((id) => (id === IDS[1] ? NOT_FOUND_BODY : goodBody(id)), IDS)
    const result = await runOmdbRatingsSync(OPTIONS, h.deps)

    expect(h.asked).toEqual(IDS)
    expect(h.asked).toHaveLength(5)
    expect(result.idsAbortedByProviderQuota).toBe(0)
    expect(result.status).not.toBe('aborted')
    expect(result.errorCode).toBeNull()
    expect(h.trips()).toBe(0)
  })

  it('varios ids inexistentes seguidos tambem nao abrem o circuito', async () => {
    // O breaker de rede conta 3 falhas consecutivas de TRANSPORTE. Estas sao
    // HTTP 200 com corpo de erro — nao sao falhas de transporte, e nao devem
    // acionar aquele contador por tabela.
    const h = harness(() => NOT_FOUND_BODY, IDS)
    const result = await runOmdbRatingsSync(OPTIONS, h.deps)
    expect(h.asked).toHaveLength(5)
    expect(h.trips()).toBe(0)
    expect(result.idsFailed).toBe(0)
  })
})
