/**
 * shutdown.test.ts — O SIGTERM no meio de um lote da OMDb.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * O agendador aborta a CLI filha no desligamento de todo redeploy. O nucleo
 * grava `api_sync_logs` UMA vez, no FIM do lote — e a CLI morria antes. O lote
 * cortado nao deixava linha, e a cota que ele ja tinha gastado sumia de
 * `readSpentToday`: o leitor podia ficar sem cota mais tarde no mesmo dia.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO MEDE
 * ============================================================================
 * O EFEITO, nunca a clausula: quantas requisicoes sairam, quantas escritas o id
 * em voo completou, e a linha de `api_sync_logs` — status, `error_code` e a cota
 * que ela registra contra a cota que o client emitiu.
 *
 * E cada caso positivo tem o seu CONTROLE NEGATIVO: o mesmo lote sem pedido de
 * parada vai ate o fim (o harness nao para nada sozinho), e o mesmo processo
 * sem a parada cooperativa, quando o SIGKILL chega, nao tem linha nenhuma.
 */

import { OmdbClient } from '@screena/omdb-client'
import { RapidApiStoppedError, type HttpRequest, type HttpResponse } from '@screena/rapidapi-core'
import { describe, expect, it } from 'vitest'

import type { RatingsEntityCandidate, SyncLogInput } from '../../ports.js'
import {
  OMDB_SHUTDOWN_ERROR_CODE,
  runOmdbRatingsSync,
  type OmdbRunDeps,
  type OmdbRunOptions,
} from '../run.js'
import type { ExternalRatingRow } from '../types.js'
import { OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

const IDS = ['tt0000001', 'tt0000002', 'tt0000003', 'tt0000004', 'tt0000005'] as const

const OPTIONS: OmdbRunOptions = {
  apply: true,
  sample: false,
  entityType: 'movie',
  id: null,
  limit: IDS.length,
  providerApi: 'omdb',
  cacheTtlMs: 1000,
  ignoreFreshness: false,
  mode: 'coverage',
  consumer: 'seed',
}

/** O payload real da fixture, com o id pedido (tres fontes por titulo). */
function bodyFor(imdbId: string): unknown {
  return { ...OMDB_GUARDIANS_PAYLOAD, imdbID: imdbId }
}

interface World {
  readonly deps: OmdbRunDeps
  /** Ids que chegaram a `fetchTitle`, na ordem. */
  readonly asked: string[]
  /** `api_cache` gravado (request_key). */
  readonly cached: string[]
  /** Linhas de `external_ratings` gravadas. */
  readonly upserts: ExternalRatingRow[]
  /** Linhas de `api_sync_logs`. */
  readonly logs: SyncLogInput[]
}

function world(overrides: Partial<OmdbRunDeps> & Pick<OmdbRunDeps, 'fetchTitle'>): World {
  const asked: string[] = []
  const cached: string[] = []
  const upserts: ExternalRatingRow[] = []
  const logs: SyncLogInput[] = []
  const candidates: RatingsEntityCandidate[] = IDS.map((imdbId, index) => ({
    entityType: 'movie',
    entityId: String(index + 1),
    imdbId,
    tmdbId: null,
  }))
  const { fetchTitle, ...rest } = overrides

  return {
    asked,
    cached,
    upserts,
    logs,
    deps: {
      fetchTitle: (imdbId) => {
        asked.push(imdbId)
        return fetchTitle(imdbId)
      },
      cache: {
        write: async (input) => {
          cached.push(input.requestKey)
        },
      },
      syncLog: {
        write: async (input) => {
          logs.push(input)
        },
      },
      entities: {
        findByImdbId: async () => null,
        findByTmdbId: async () => null,
      },
      candidates: {
        selectStaleByType: async () => ({ candidates, skippedFresh: 0 }),
      },
      ratings: {
        upsert: async (row) => {
          upserts.push(row)
          return { created: true, changed: true }
        },
      },
      now: () => new Date('2026-09-17T12:00:00.000Z'),
      requestCount: () => asked.length,
      ...rest,
    },
  }
}

describe('SIGTERM no meio do lote: o nucleo para ENTRE ids e grava a linha', () => {
  it('o id em voo termina as escritas, o proximo nao sai, e a linha registra a cota real', async () => {
    const stop = new AbortController()
    const w = world({
      fetchTitle: async (imdbId) => {
        // O SIGTERM chega com a requisicao do 2o id na rede.
        if (imdbId === IDS[1]) stop.abort()
        return bodyFor(imdbId)
      },
      stopSignal: stop.signal,
    })

    const result = await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(w.asked).toEqual([IDS[0], IDS[1]])
    // O 2o id nao ficou pela metade: cache E as tres notas.
    expect(w.cached).toHaveLength(2)
    expect(w.upserts.filter((row) => row.entityId === '2')).toHaveLength(3)
    expect(w.upserts).toHaveLength(6)

    expect(w.logs).toHaveLength(1)
    const [log] = w.logs
    expect(log?.status).toBe('aborted')
    expect(log?.errorCode).toBe(OMDB_SHUTDOWN_ERROR_CODE)
    expect(log?.quotaCost).toBe(2)
    expect(log?.itemsProcessed).toBe(2)

    expect(result.idsInterrupted).toBe(3)
    expect(result.idsFailed).toBe(0)
    expect(result.rejections.some((r) => r.reason === 'shutdown-requested')).toBe(true)
  })

  it('a requisicao cortada em voo NAO vira falha de rede — e a cota dela conta', async () => {
    const stop = new AbortController()
    let emitted = 0
    const w = world({
      fetchTitle: async (imdbId) => {
        emitted += 1
        if (imdbId === IDS[2]) {
          stop.abort()
          // O que o client real lanca quando a carencia acaba.
          throw new RapidApiStoppedError('omdb', '/', true)
        }
        return bodyFor(imdbId)
      },
      requestCount: () => emitted,
      stopSignal: stop.signal,
    })

    const result = await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(w.asked).toEqual([IDS[0], IDS[1], IDS[2]])
    expect(result.idsFailed).toBe(0)
    expect(result.idsQueried).toBe(2)
    expect(result.idsInterrupted).toBe(3)
    // O codigo da linha e a PARADA, nunca o nome da classe do erro.
    expect(w.logs[0]?.errorCode).toBe(OMDB_SHUTDOWN_ERROR_CODE)
    expect(w.logs[0]?.status).toBe('aborted')
    expect(w.logs[0]?.quotaCost).toBe(3)
  })

  it('parada ANTES do primeiro id: nenhuma requisicao, e a linha sai mesmo assim', async () => {
    const stop = new AbortController()
    stop.abort()
    const w = world({ fetchTitle: async (imdbId) => bodyFor(imdbId), stopSignal: stop.signal })

    const result = await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(w.asked).toEqual([])
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]?.status).toBe('aborted')
    expect(w.logs[0]?.quotaCost).toBe(0)
    expect(result.idsInterrupted).toBe(IDS.length)
  })

  it('CONTROLE NEGATIVO: sem pedido de parada, o MESMO lote vai ate o fim', async () => {
    const w = world({ fetchTitle: async (imdbId) => bodyFor(imdbId) })

    const result = await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(w.asked).toEqual([...IDS])
    expect(w.logs[0]?.status).toBe('success')
    expect(w.logs[0]?.errorCode).toBeNull()
    expect(result.idsInterrupted).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A composicao da CLI: client REAL (throttle, retry, carencia) + nucleo.
// ---------------------------------------------------------------------------

/** O mesmo formato de config de producao, sem o throttle de 1 rps. */
function clientWith(
  transport: (request: HttpRequest) => Promise<HttpResponse>,
  stopSignal: AbortSignal | undefined,
  stopGraceMs: number,
): OmdbClient {
  return new OmdbClient(
    {
      providerApi: 'omdb',
      baseUrl: 'https://omdb.invalid',
      host: 'omdb.invalid',
      apiKey: 'chave-falsa-de-teste',
      maxRps: 1000,
      maxRetries: 3,
      breakerThreshold: 5,
      breakerCooldownMs: 30_000,
      timeoutMs: 15_000,
      cacheTtlMs: 1000,
      auth: { kind: 'query-param', param: 'apikey' },
    },
    { transport, stopSignal, stopGraceMs },
  )
}

function idOf(request: HttpRequest): string {
  return new URL(request.url).searchParams.get('i') ?? ''
}

describe('client real + nucleo: a cota da linha e a que o client EMITIU', () => {
  it('SIGTERM com o 2o id em voo: ele volta na carencia, o 3o nunca sai, quota_cost = 2', async () => {
    const stop = new AbortController()
    const sent: string[] = []
    const client = clientWith(
      async (request) => {
        sent.push(idOf(request))
        if (sent.length === 2) stop.abort()
        return { status: 200, headers: {}, body: JSON.stringify(bodyFor(idOf(request))) }
      },
      stop.signal,
      1000,
    )
    const w = world({
      fetchTitle: (imdbId) => client.getByImdbId(imdbId),
      requestCount: () => client.getRequestCount(),
      stopSignal: stop.signal,
    })

    await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(sent).toEqual([IDS[0], IDS[1]])
    expect(w.upserts).toHaveLength(6)
    expect(w.logs[0]?.status).toBe('aborted')
    expect(w.logs[0]?.quotaCost).toBe(2)
  })

  it('requisicao PENDURADA: a carencia a corta, a linha sai e conta a requisicao cortada', async () => {
    const stop = new AbortController()
    const sent: string[] = []
    const client = clientWith(
      (request) => {
        sent.push(idOf(request))
        if (sent.length < 2) {
          return Promise.resolve({
            status: 200,
            headers: {},
            body: JSON.stringify(bodyFor(idOf(request))),
          })
        }
        stop.abort()
        return new Promise<HttpResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('abortada')), {
            once: true,
          })
        })
      },
      stop.signal,
      30,
    )
    const w = world({
      fetchTitle: (imdbId) => client.getByImdbId(imdbId),
      requestCount: () => client.getRequestCount(),
      stopSignal: stop.signal,
    })

    const result = await runOmdbRatingsSync(OPTIONS, w.deps)

    expect(sent).toEqual([IDS[0], IDS[1]])
    expect(w.logs).toHaveLength(1)
    expect(w.logs[0]?.status).toBe('aborted')
    expect(w.logs[0]?.errorCode).toBe(OMDB_SHUTDOWN_ERROR_CODE)
    expect(w.logs[0]?.quotaCost).toBe(2)
    expect(result.idsQueried).toBe(1)
    expect(result.idsFailed).toBe(0)
  })

  it('CONTROLE NEGATIVO: sem a parada cooperativa, quando o SIGKILL chega NAO ha linha', async () => {
    // O mesmo lote e a mesma requisicao pendurada, com o client e o nucleo sem
    // `stopSignal` — o estado anterior a esta mudanca. O SIGTERM nao tem a quem
    // chegar; 200 ms depois (o SIGKILL do orquestrador, encurtado) o processo
    // morreria com a linha ainda por gravar e uma requisicao ja paga.
    const sent: string[] = []
    const client = clientWith(
      (request) => {
        sent.push(idOf(request))
        if (sent.length < 2) {
          return Promise.resolve({
            status: 200,
            headers: {},
            body: JSON.stringify(bodyFor(idOf(request))),
          })
        }
        return new Promise<HttpResponse>(() => undefined)
      },
      undefined,
      30,
    )
    const w = world({
      fetchTitle: (imdbId) => client.getByImdbId(imdbId),
      requestCount: () => client.getRequestCount(),
    })

    void runOmdbRatingsSync(OPTIONS, w.deps)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(client.getRequestCount()).toBe(2)
    expect(w.logs).toHaveLength(0)
  })
})
