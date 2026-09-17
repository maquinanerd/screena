/**
 * http-stop.test.ts — A PARADA DO PROCESSO no executor HTTP compartilhado.
 *
 * O que se mede e o EFEITO na rede: quantas requisicoes o transporte recebeu
 * depois do pedido de parada, e quanto `getRequestCount()` — que vira
 * `api_sync_logs.quota_cost` — diz que saiu. Um client que "parasse" contando
 * errado gravaria uma cota falsa; um que retentasse depois do SIGTERM gastaria
 * cota que ninguem registra.
 *
 * Sem rede: transporte falso. A carencia usa relogio real, com milissegundos.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { isStoppedError, RapidApiStoppedError } from '../errors.js'
import {
  createRapidApiFetchTransport,
  type HttpRequest,
  type HttpResponse,
  type RapidApiClientConfig,
  RapidApiHttpClient,
  STOP_IN_FLIGHT_GRACE_MS,
} from '../http.js'

function makeConfig(overrides: Partial<RapidApiClientConfig> = {}): RapidApiClientConfig {
  return {
    providerApi: 'rapidapi-test',
    baseUrl: 'https://example.test',
    host: 'example.test',
    apiKey: 'test-key-0000000000',
    maxRps: 1000,
    maxRetries: 2,
    breakerThreshold: 1,
    breakerCooldownMs: 60_000,
    timeoutMs: 5000,
    cacheTtlMs: 60_000,
    ...overrides,
  }
}

const OK: HttpResponse = { status: 200, headers: {}, body: '{"ok":true}' }
const FIVE_HUNDRED: HttpResponse = { status: 500, headers: {}, body: '{}' }

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('teste: esperava rejeicao, mas resolveu')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parada ANTES da requisicao', () => {
  it('nenhuma requisicao sai, e a contagem continua zero', async () => {
    const stop = new AbortController()
    stop.abort()
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig(), {
      transport: async (request) => {
        calls.push(request)
        return OK
      },
      stopSignal: stop.signal,
    })

    const error = await capture(client.request('/'))

    expect(error).toBeInstanceOf(RapidApiStoppedError)
    expect((error as RapidApiStoppedError).emitted).toBe(false)
    expect(isStoppedError(error)).toBe(true)
    expect(calls).toHaveLength(0)
    expect(client.getRequestCount()).toBe(0)
  })
})

describe('parada durante o BACKOFF', () => {
  it('a retentativa NAO sai: o transporte recebe so a tentativa que falhou', async () => {
    const stop = new AbortController()
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig({ maxRetries: 3 }), {
      transport: async (request) => {
        calls.push(request)
        return FIVE_HUNDRED
      },
      // O SIGTERM chega enquanto o client espera para retentar.
      sleep: async () => {
        stop.abort()
      },
      random: () => 0,
      stopSignal: stop.signal,
    })

    const error = await capture(client.request('/'))

    expect(error).toBeInstanceOf(RapidApiStoppedError)
    expect(calls).toHaveLength(1)
    // A tentativa que falhou SAIU: ela conta na cota.
    expect(client.getRequestCount()).toBe(1)
    // Parada nao e degradacao do fornecedor: o breaker (limiar 1) nao abre.
    expect(client.isCircuitOpen()).toBe(false)
  })

  it('CONTROLE NEGATIVO: sem parada, o mesmo 500 retenta ate o teto', async () => {
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig({ maxRetries: 3 }), {
      transport: async (request) => {
        calls.push(request)
        return FIVE_HUNDRED
      },
      sleep: async () => undefined,
      random: () => 0,
    })

    await capture(client.request('/'))

    expect(calls).toHaveLength(4)
  })

  it('o sleep PADRAO acorda na parada — o processo nao espera o backoff inteiro', async () => {
    const stop = new AbortController()
    const client = new RapidApiHttpClient(makeConfig({ maxRetries: 1 }), {
      transport: async () => FIVE_HUNDRED,
      // Sem `sleep` injetado: vale o `setTimeout` de verdade. O backoff da 1a
      // retentativa sao 250 ms + jitter; a parada chega em 20 ms.
      random: () => 0,
      stopSignal: stop.signal,
    })
    setTimeout(() => stop.abort(), 20)

    const started = Date.now()
    const error = await capture(client.request('/'))
    const elapsed = Date.now() - started

    expect(error).toBeInstanceOf(RapidApiStoppedError)
    expect(elapsed).toBeLessThan(200)
  })
})

describe('parada com a requisicao EM VOO', () => {
  it('a resposta que volta dentro da carencia e USADA — e a proxima nao sai', async () => {
    const stop = new AbortController()
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig(), {
      transport: async (request) => {
        calls.push(request)
        // O SIGTERM chega com esta requisicao na rede; ela volta 10 ms depois.
        stop.abort()
        await new Promise((resolve) => setTimeout(resolve, 10))
        return OK
      },
      stopGraceMs: 1000,
      stopSignal: stop.signal,
    })

    await expect(client.request('/')).resolves.toEqual({ ok: true })
    const next = await capture(client.request('/'))

    expect(next).toBeInstanceOf(RapidApiStoppedError)
    expect(calls).toHaveLength(1)
    expect(client.getRequestCount()).toBe(1)
  })

  it('a requisicao PENDURADA e cortada ao fim da carencia, e a cota a conta', async () => {
    const stop = new AbortController()
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig({ maxRetries: 3 }), {
      transport: (request) => {
        calls.push(request)
        stop.abort()
        // Nunca responde: so termina quando o client a aborta.
        return new Promise<HttpResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('abortada')), {
            once: true,
          })
        })
      },
      stopGraceMs: 30,
      sleep: async () => undefined,
      stopSignal: stop.signal,
    })

    const started = Date.now()
    const error = await capture(client.request('/'))
    const elapsed = Date.now() - started

    expect(error).toBeInstanceOf(RapidApiStoppedError)
    expect((error as RapidApiStoppedError).emitted).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(25)
    expect(elapsed).toBeLessThan(1000)
    // Cortada, nao retentada.
    expect(calls).toHaveLength(1)
    expect(client.getRequestCount()).toBe(1)
    expect(client.isCircuitOpen()).toBe(false)
  })

  it('a carencia padrao cabe na carencia de 10 s do orquestrador', () => {
    expect(STOP_IN_FLIGHT_GRACE_MS).toBeGreaterThan(0)
    expect(STOP_IN_FLIGHT_GRACE_MS).toBeLessThanOrEqual(5000)
  })

  it('sem `stopSignal`, a requisicao nao carrega sinal nenhum (comportamento anterior)', async () => {
    const calls: HttpRequest[] = []
    const client = new RapidApiHttpClient(makeConfig(), {
      transport: async (request) => {
        calls.push(request)
        return OK
      },
    })
    await client.request('/')
    expect(calls[0]?.signal).toBeUndefined()
  })
})

describe('transporte fetch: o sinal da requisicao aborta o fetch', () => {
  it('abortar `request.signal` aborta o `fetch` em curso', async () => {
    let seen: AbortSignal | undefined
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      seen = init.signal
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })
    const transport = createRapidApiFetchTransport(60_000)
    const controller = new AbortController()

    const pending = capture(
      transport({
        url: 'https://example.test/',
        method: 'GET',
        headers: {},
        signal: controller.signal,
      }),
    )
    controller.abort()

    expect(await pending).toBeInstanceOf(Error)
    expect(seen?.aborted).toBe(true)
  })
})
