/**
 * Testes do executor HTTP do TMDB: throttle, retry/backoff e circuit breaker.
 * 100% sem rede — transporte, relogio, sleep e random sao injetados.
 */

import { describe, expect, it } from 'vitest'
import { loadTmdbConfig } from '../config.js'
import {
  type HttpRequest,
  type HttpResponse,
  type TmdbHttpDeps,
  TmdbCircuitOpenError,
  TmdbHttpClient,
  TmdbHttpError,
} from '../http.js'

type Scripted = HttpResponse | Error

function makeClient(responses: Scripted[], env: Record<string, string> = {}) {
  const queue: Scripted[] = [...responses]
  const calls: HttpRequest[] = []
  const slept: number[] = []
  let nowMs = 0

  const transport: TmdbHttpDeps['transport'] = async (request) => {
    calls.push(request)
    const next = queue.shift()
    if (next === undefined) throw new Error('teste: sem resposta scriptada')
    if (next instanceof Error) throw next
    return next
  }

  const deps: TmdbHttpDeps = {
    transport,
    now: () => nowMs,
    sleep: async (ms) => {
      slept.push(ms)
      nowMs += ms
    },
    random: () => 0,
  }

  const config = loadTmdbConfig({ TMDB_API_KEY: 'k', ...env })
  const client = new TmdbHttpClient(config, deps)
  return {
    client,
    calls,
    slept,
    advance: (ms: number) => {
      nowMs += ms
    },
  }
}

function ok(body: string): HttpResponse {
  return { status: 200, headers: {}, body }
}

function fail(status: number, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, body: `status ${status}` }
}

describe('TmdbHttpClient', () => {
  it('faz GET de sucesso e devolve JSON parseado, com auth v3 na query', async () => {
    const { client, calls } = makeClient([ok('{"id":1}')])
    const data = await client.request('/movie/1', { language: 'pt-BR' })
    expect(data).toEqual({ id: 1 })
    expect(calls).toHaveLength(1)
    const url = calls[0]?.url ?? ''
    expect(url).toContain('/movie/1')
    expect(url).toContain('language=pt-BR')
    expect(url).toContain('api_key=k')
  })

  it('retenta erro transitorio (500) e tem sucesso na segunda tentativa', async () => {
    const { client, calls } = makeClient([fail(500), ok('{"ok":true}')], { TMDB_MAX_RPS: '1000' })
    const data = await client.request('/movie/1')
    expect(data).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it('nao retenta erro permanente (404) e lanca TmdbHttpError', async () => {
    const { client, calls } = makeClient([fail(404)], { TMDB_MAX_RPS: '1000' })
    await expect(client.request('/movie/999')).rejects.toMatchObject({
      name: 'TmdbHttpError',
      status: 404,
      permanent: true,
    })
    expect(calls).toHaveLength(1)
  })

  it('respeita Retry-After (segundos) em 429', async () => {
    const { client, slept } = makeClient([fail(429, { 'retry-after': '2' }), ok('{}')], {
      TMDB_MAX_RPS: '1000',
    })
    await client.request('/movie/1')
    expect(slept).toContain(2000)
  })

  it('abre o circuito apos N falhas consecutivas e suspende chamadas', async () => {
    const { client, calls } = makeClient([fail(500), fail(500)], {
      TMDB_MAX_RETRIES: '0',
      TMDB_BREAKER_THRESHOLD: '2',
      TMDB_MAX_RPS: '1000',
    })
    await expect(client.request('/a')).rejects.toBeInstanceOf(TmdbHttpError)
    await expect(client.request('/b')).rejects.toBeInstanceOf(TmdbHttpError)
    await expect(client.request('/c')).rejects.toBeInstanceOf(TmdbCircuitOpenError)
    expect(calls).toHaveLength(2)
    expect(client.isCircuitOpen()).toBe(true)
  })

  it('half-open apos cooldown: uma prova de sucesso fecha o circuito', async () => {
    const { client, calls, advance } = makeClient([fail(500), fail(500), ok('{"ok":1}')], {
      TMDB_MAX_RETRIES: '0',
      TMDB_BREAKER_THRESHOLD: '2',
      TMDB_BREAKER_COOLDOWN_MS: '1000',
      TMDB_MAX_RPS: '1000',
    })
    await expect(client.request('/a')).rejects.toBeInstanceOf(TmdbHttpError)
    await expect(client.request('/b')).rejects.toBeInstanceOf(TmdbHttpError)
    expect(client.isCircuitOpen()).toBe(true)
    advance(2000)
    const data = await client.request('/c')
    expect(data).toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
    expect(client.isCircuitOpen()).toBe(false)
  })

  it('aplica throttle entre requisicoes conforme maxRps', async () => {
    const { client, slept } = makeClient([ok('{}'), ok('{}')], { TMDB_MAX_RPS: '2' })
    await client.request('/a')
    await client.request('/b')
    expect(slept).toContain(500)
  })
})
