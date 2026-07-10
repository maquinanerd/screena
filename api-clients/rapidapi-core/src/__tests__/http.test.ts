/**
 * Testes do executor HTTP resiliente compartilhado dos clients RapidAPI.
 *
 * 100% sem rede e sem tempo real: transporte, relogio, sleep e random sao
 * injetados. O foco principal e SEGREDO: a `x-rapidapi-key` viaja SO em header,
 * nunca em URL/erro/log.
 */

import { describe, expect, it } from 'vitest'
import {
  RapidApiCircuitOpenError,
  RapidApiHttpError,
  RapidApiInvalidPayloadError,
} from '../errors.js'
import {
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
  type RapidApiClientConfig,
  type RapidApiHttpDeps,
  RAPIDAPI_HOST_HEADER,
  RAPIDAPI_KEY_HEADER,
  RapidApiHttpClient,
  parseRetryAfterMs,
} from '../http.js'

/** Chave OBVIAMENTE falsa (>= 8 chars). Nunca uma credencial real em teste. */
const API_KEY = 'test-key-0000000000'

type Scripted = HttpResponse | Error

function makeConfig(overrides: Partial<RapidApiClientConfig> = {}): RapidApiClientConfig {
  return {
    providerApi: 'rapidapi-test',
    baseUrl: 'https://example.test',
    host: 'example.test',
    apiKey: API_KEY,
    maxRps: 1000,
    maxRetries: 2,
    breakerThreshold: 5,
    breakerCooldownMs: 1000,
    timeoutMs: 5000,
    cacheTtlMs: 60_000,
    ...overrides,
  }
}

interface Harness {
  readonly client: RapidApiHttpClient
  readonly calls: HttpRequest[]
  readonly slept: number[]
  readonly advance: (ms: number) => void
}

function makeClient(
  responses: readonly Scripted[],
  configOverrides: Partial<RapidApiClientConfig> = {},
): Harness {
  const queue: Scripted[] = [...responses]
  const calls: HttpRequest[] = []
  const slept: number[] = []
  let nowMs = 0

  const transport: HttpTransport = async (request) => {
    calls.push(request)
    const next = queue.shift()
    if (next === undefined) throw new Error('teste: sem resposta scriptada')
    if (next instanceof Error) throw next
    return next
  }

  const deps: RapidApiHttpDeps = {
    transport,
    now: () => nowMs,
    sleep: async (ms) => {
      slept.push(ms)
      nowMs += ms
    },
    random: () => 0,
  }

  const client = new RapidApiHttpClient(makeConfig(configOverrides), deps)
  return {
    client,
    calls,
    slept,
    advance: (ms) => {
      nowMs += ms
    },
  }
}

function ok(body: string): HttpResponse {
  return { status: 200, headers: {}, body }
}

function fail(status: number, headers: Record<string, string> = {}, body?: string): HttpResponse {
  return { status, headers, body: body ?? `{"status":${status}}` }
}

/** Concatena TODOS os valores de propriedade propria do erro, para caca-vazamento. */
function ownStringValues(err: object): string {
  return Object.getOwnPropertyNames(err)
    .map((key) => {
      try {
        return String((err as Record<string, unknown>)[key])
      } catch {
        return ''
      }
    })
    .join(' ')
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('teste: esperava rejeicao, mas resolveu')
}

describe('RapidApiHttpClient — segredo', () => {
  it('NUNCA coloca a chave na URL; ela viaja so em header (x-rapidapi-key + host)', async () => {
    const { client, calls } = makeClient([ok('{"ok":true}')])
    await client.request('/popular/', { type: 'film' })

    expect(calls).toHaveLength(1)
    const req = calls[0]
    if (!req) throw new Error('teste: request nao capturada')

    // A chave nunca aparece na URL nem em nenhum valor de query.
    expect(req.url).not.toContain(API_KEY)
    expect(req.url).toContain('/popular/')
    expect(req.url).toContain('type=film')

    // ...mas viaja em header, junto do host.
    expect(req.headers[RAPIDAPI_KEY_HEADER]).toBe(API_KEY)
    expect(req.headers[RAPIDAPI_HOST_HEADER]).toBe('example.test')
  })
})

describe('RapidApiHttpClient — erros permanentes (4xx)', () => {
  for (const status of [401, 403, 404]) {
    it(`lanca RapidApiHttpError permanente em ${status}, sem retry e sem vazar a chave`, async () => {
      const { client, calls } = makeClient([fail(status, {}, '{"message":"denied"}')])

      const caught = await capture(client.request('/popular/', { type: 'film' }))

      expect(caught).toBeInstanceOf(RapidApiHttpError)
      const err = caught as RapidApiHttpError
      expect(err.status).toBe(status)
      expect(err.permanent).toBe(true)

      // NAO retenta erro permanente.
      expect(calls).toHaveLength(1)
      expect(client.isCircuitOpen()).toBe(false)

      // A chave nunca esta na mensagem, no corpo ou em qualquer campo do erro.
      expect(err.message).not.toContain(API_KEY)
      expect(err.body).not.toContain(API_KEY)
      expect(ownStringValues(err)).not.toContain(API_KEY)

      // O erro nao expoe headers nem url (poderiam carregar segredo num log futuro).
      expect('url' in (err as object)).toBe(false)
      expect('headers' in (err as object)).toBe(false)
    })
  }
})

describe('RapidApiHttpClient — 429 / Retry-After', () => {
  it('retenta respeitando Retry-After (segundos -> ms)', async () => {
    const { client, slept, calls } = makeClient([
      fail(429, { 'retry-after': '2' }),
      ok('{"ok":true}'),
    ])

    const data = await client.request('/popular/')

    expect(data).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(slept).toContain(2000)
  })

  it('limita o Retry-After ao teto de 10_000ms', async () => {
    const { client, slept } = makeClient([fail(429, { 'retry-after': '30' }), ok('{}')])

    await client.request('/popular/')

    expect(slept).toContain(10_000)
    expect(slept).not.toContain(30_000)
  })
})

describe('RapidApiHttpClient — 5xx transitorio', () => {
  it('retenta ate maxRetries e lanca RapidApiHttpError permanent=false', async () => {
    const { client, calls } = makeClient([fail(500), fail(500), fail(500)], { maxRetries: 2 })

    const caught = await capture(client.request('/popular/'))

    expect(caught).toBeInstanceOf(RapidApiHttpError)
    const err = caught as RapidApiHttpError
    expect(err.status).toBe(500)
    expect(err.permanent).toBe(false)
    expect(calls).toHaveLength(3) // maxRetries + 1
  })
})

describe('RapidApiHttpClient — falha de transporte (rede/timeout)', () => {
  it('trata excecao do transporte como transitoria, retenta e NAO propaga o erro cru', async () => {
    const rawError = new Error(`boom-cru-do-fetch ${API_KEY}`)
    const { client, calls } = makeClient([rawError, rawError], { maxRetries: 1 })

    const caught = await capture(client.request('/popular/'))

    // Retentou: duas tentativas.
    expect(calls).toHaveLength(2)

    // NAO e o erro cru do transporte (que carregaria url/headers/chave em cause).
    expect(caught).not.toBe(rawError)
    expect(caught).toBeInstanceOf(Error)
    const err = caught as Error
    expect(err.message).toMatch(/rede|timeout/)
    expect(err.message).not.toContain(API_KEY)
  })
})

describe('RapidApiHttpClient — circuit breaker', () => {
  it('abre apos breakerThreshold falhas, bloqueia o transporte e reabre apos cooldown', async () => {
    const { client, calls, advance } = makeClient([fail(500), fail(500), ok('{"ok":1}')], {
      maxRetries: 0,
      breakerThreshold: 2,
      breakerCooldownMs: 1000,
    })

    await expect(client.request('/a')).rejects.toBeInstanceOf(RapidApiHttpError)
    await expect(client.request('/b')).rejects.toBeInstanceOf(RapidApiHttpError)

    // Breaker aberto: a proxima chamada nao toca o transporte.
    expect(client.isCircuitOpen()).toBe(true)
    const caught = await capture(client.request('/c'))
    expect(caught).toBeInstanceOf(RapidApiCircuitOpenError)
    expect(calls).toHaveLength(2) // /c NAO chamou o transporte

    // Passado o cooldown, o transporte volta a ser chamado.
    advance(2000)
    expect(client.isCircuitOpen()).toBe(false)
    const data = await client.request('/c')
    expect(data).toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
  })

  it('um 4xx permanente NAO conta para o breaker', async () => {
    const { client, calls } = makeClient([fail(404), fail(404), ok('{"ok":1}')], {
      maxRetries: 0,
      breakerThreshold: 1, // abriria apos UMA falha real
    })

    await expect(client.request('/a')).rejects.toBeInstanceOf(RapidApiHttpError)
    expect(client.isCircuitOpen()).toBe(false)
    await expect(client.request('/b')).rejects.toBeInstanceOf(RapidApiHttpError)
    expect(client.isCircuitOpen()).toBe(false)

    // O breaker nunca abriu, entao o transporte continua sendo chamado.
    const data = await client.request('/c')
    expect(data).toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
  })
})

describe('RapidApiHttpClient — throttle', () => {
  it('espera ~500ms na segunda requisicao quando maxRps=2', async () => {
    const { client, slept } = makeClient([ok('{}'), ok('{}')], { maxRps: 2 })

    await client.request('/a')
    await client.request('/b')

    expect(slept).toEqual([500])
  })
})

describe('RapidApiHttpClient — contagem de requisicoes', () => {
  it('getRequestCount conta toda tentativa, inclusive retries', async () => {
    const { client } = makeClient([fail(500), ok('{"ok":1}')], { maxRetries: 1 })

    const data = await client.request('/popular/')

    expect(data).toEqual({ ok: 1 })
    expect(client.getRequestCount()).toBe(2)
  })
})

describe('parseRetryAfterMs', () => {
  it('converte segundos em ms', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
    expect(parseRetryAfterMs('0')).toBe(0)
  })

  it('devolve null para ausente/invalido/negativo/data HTTP', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs('abc')).toBeNull()
    expect(parseRetryAfterMs('-5')).toBeNull()
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT')).toBeNull()
  })
})

describe('RapidApiHttpClient — payload invalido', () => {
  it('lanca RapidApiInvalidPayloadError quando um 2xx traz corpo nao-JSON', async () => {
    const { client } = makeClient([{ status: 200, headers: {}, body: 'nao <<< json' }])

    const caught = await capture(client.request('/popular/'))

    expect(caught).toBeInstanceOf(RapidApiInvalidPayloadError)
  })
})
