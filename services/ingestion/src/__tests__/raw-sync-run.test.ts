/**
 * Testes da orquestracao pura do piloto (P0-00d): roteamento por tipo, contagem
 * de nao-suportados, dry-run sem side-effect, create/update/skip por hash,
 * agregacao do relatorio e invariancia sob concorrencia. Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import type { QueueItem } from '../discovery/sync-queue.js'
import { computeRawPayloadHash } from '../raw-sync/hash-decision.js'
import { selectPilotItems } from '../raw-sync/queue.js'
import { runRawSyncPilot } from '../raw-sync/run.js'
import type { RawEntityKey, RawEntityRecord } from '../raw-sync/types.js'
import { stableStringify } from '../utils/hash.js'

const NOW = () => new Date('2026-07-09T00:00:00.000Z')
const LIMITS = { movie: 100, tv: 100, person: 100 }
const RETRY = { maxAttempts: 1, sleep: () => Promise.resolve() }

/** Payload determinista que a fonte fake devolve por (kind,id). */
function payloadFor(kind: string, id: number): { kind: string; id: number } {
  return { kind, id }
}

/** Fonte fake: registra qual metodo foi chamado e devolve payload determinista. */
function makeFakeSource() {
  const calls: Array<{ method: string; id: number }> = []
  return {
    calls,
    getMovie(id: number) {
      calls.push({ method: 'getMovie', id })
      return Promise.resolve(payloadFor('movie', id))
    },
    getTvShow(id: number) {
      calls.push({ method: 'getTvShow', id })
      return Promise.resolve(payloadFor('tv', id))
    },
    getPerson(id: number) {
      calls.push({ method: 'getPerson', id })
      return Promise.resolve(payloadFor('person', id))
    },
  }
}

const keyStr = (k: RawEntityKey) => `${k.entityType}:${k.tmdbId}:${k.baseLanguage}`

/** Store fake em memoria com hashes iniciais opcionais. */
function makeFakeStore(initial: Record<string, string> = {}) {
  const hashes = new Map<string, string>(Object.entries(initial))
  const writes: Array<{ op: 'create' | 'update'; key: string; hash: string }> = []
  return {
    hashes,
    writes,
    readHash(key: RawEntityKey) {
      return Promise.resolve(hashes.get(keyStr(key)) ?? null)
    },
    create(record: RawEntityRecord) {
      hashes.set(keyStr(record), record.payloadHash)
      writes.push({ op: 'create', key: keyStr(record), hash: record.payloadHash })
      return Promise.resolve()
    },
    update(key: RawEntityKey, record: RawEntityRecord) {
      hashes.set(keyStr(key), record.payloadHash)
      writes.push({ op: 'update', key: keyStr(key), hash: record.payloadHash })
      return Promise.resolve()
    },
  }
}

function item(kind: QueueItem['kind'], tmdbId: number): QueueItem {
  return { kind, tmdbId, popularity: null }
}

const rawKey = (entityType: 'movie' | 'tv' | 'person', tmdbId: number): RawEntityKey => ({
  entityType,
  tmdbId,
  baseLanguage: 'pt-BR',
})

describe('runRawSyncPilot', () => {
  it('roteia movie/tv/person para o metodo correto do client', async () => {
    const source = makeFakeSource()
    const store = makeFakeStore()
    const selection = selectPilotItems(
      [item('movie', 1), item('tv', 2), item('person', 3)],
      LIMITS,
    )
    await runRawSyncPilot({
      selection,
      source,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY,
    })
    expect(source.calls).toEqual([
      { method: 'getMovie', id: 1 },
      { method: 'getTvShow', id: 2 },
      { method: 'getPerson', id: 3 },
    ])
  })

  it('conta collection/network/company/keyword como unsupportedSkipped (nunca somem)', async () => {
    const source = makeFakeSource()
    const store = makeFakeStore()
    const selection = selectPilotItems(
      [
        item('movie', 1),
        item('collection', 10),
        item('network', 11),
        item('company', 12),
        item('keyword', 13),
      ],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      retry: RETRY,
    })
    expect(report.unsupportedSkipped).toBe(4)
    expect(report.unsupportedByKind).toEqual({ collection: 1, network: 1, company: 1, keyword: 1 })
    // So o filme foi buscado; nao-suportados nunca chamam a fonte.
    expect(source.calls).toEqual([{ method: 'getMovie', id: 1 }])
  })

  it('dry-run NAO toca fonte nem store e zera desfechos', async () => {
    const throwingSource = {
      getMovie: () => Promise.reject(new Error('nao deveria buscar')),
      getTvShow: () => Promise.reject(new Error('nao deveria buscar')),
      getPerson: () => Promise.reject(new Error('nao deveria buscar')),
    }
    const throwingStore = {
      readHash: () => Promise.reject(new Error('nao deveria ler')),
      create: () => Promise.reject(new Error('nao deveria gravar')),
      update: () => Promise.reject(new Error('nao deveria gravar')),
    }
    const selection = selectPilotItems([item('movie', 1), item('tv', 2)], LIMITS)
    const report = await runRawSyncPilot({
      selection,
      source: throwingSource,
      store: throwingStore,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: true,
      retry: RETRY,
    })
    expect(report.mode).toBe('dry-run')
    expect(report.perKindSelected).toEqual({ movie: 1, tv: 1, person: 0 })
    expect(report.totals).toEqual({ created: 0, updated: 0, skipped: 0, failed: 0 })
  })

  it('create quando ausente; skip quando hash igual; update quando hash difere', async () => {
    // Pre-semeia o store: movie:2 com o MESMO hash do payload (=> skip);
    // movie:3 com hash divergente (=> update); movie:1 ausente (=> create).
    const sameHash = computeRawPayloadHash(payloadFor('movie', 2))
    const store = makeFakeStore({
      [keyStr(rawKey('movie', 2))]: sameHash,
      [keyStr(rawKey('movie', 3))]: 'hash-antigo-diferente',
    })
    const source = makeFakeSource()
    const selection = selectPilotItems(
      [item('movie', 1), item('movie', 2), item('movie', 3)],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY,
    })
    expect(report.perKind.movie).toEqual({ created: 1, updated: 1, skipped: 1, failed: 0 })
    expect(report.totals).toEqual({ created: 1, updated: 1, skipped: 1, failed: 0 })
    // skip NAO grava (sem bump de updatedAt); so create(1) e update(3) escrevem.
    expect(store.writes).toEqual([
      { op: 'create', key: keyStr(rawKey('movie', 1)), hash: computeRawPayloadHash(payloadFor('movie', 1)) },
      { op: 'update', key: keyStr(rawKey('movie', 3)), hash: computeRawPayloadHash(payloadFor('movie', 3)) },
    ])
  })

  it('erro de uma entidade vira `failed` e nao aborta o lote', async () => {
    const source = {
      getMovie: (id: number) =>
        id === 2
          ? Promise.reject({ permanent: true, status: 404 })
          : Promise.resolve(payloadFor('movie', id)),
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: () => Promise.reject(new Error('n/a')),
    }
    const store = makeFakeStore()
    const selection = selectPilotItems([item('movie', 1), item('movie', 2), item('movie', 3)], LIMITS)
    const report = await runRawSyncPilot({
      selection,
      source,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY,
    })
    expect(report.perKind.movie).toEqual({ created: 2, updated: 0, skipped: 0, failed: 1 })
  })

  it('agrega payload size por tipo — create E skip contam; failed nao', async () => {
    const bytesOf = (p: unknown) => Buffer.byteLength(stableStringify(p), 'utf8')
    const pMovie1 = { kind: 'movie', id: 1, blob: 'a'.repeat(10) }
    const pMovie2 = { kind: 'movie', id: 2, blob: 'b'.repeat(500) }
    const source = {
      getMovie: (id: number) => Promise.resolve(id === 1 ? pMovie1 : pMovie2),
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: (id: number) =>
        id === 9
          ? Promise.reject({ permanent: true, status: 404 })
          : Promise.resolve({ kind: 'person', id }),
    }
    // movie:2 pre-semeado com o MESMO hash do payload => skip (mas conta tamanho).
    const store = makeFakeStore({ [keyStr(rawKey('movie', 2))]: computeRawPayloadHash(pMovie2) })
    const selection = selectPilotItems(
      [item('movie', 1), item('movie', 2), item('person', 9)],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY,
    })

    const m = report.payloadSizes.movie
    expect(m.count).toBe(2) // create(movie1) + skip(movie2) — ambos com payload
    expect(m.maxBytes).toBe(Math.max(bytesOf(pMovie1), bytesOf(pMovie2)))
    expect(m.minBytes).toBe(Math.min(bytesOf(pMovie1), bytesOf(pMovie2)))
    expect(m.avgBytes).toBe(Math.round((bytesOf(pMovie1) + bytesOf(pMovie2)) / 2))
    // person 9 falhou (404) => sem amostra de tamanho.
    expect(report.payloadSizes.person.count).toBe(0)
    expect(report.perKind.person.failed).toBe(1)
    // total agrega so os tipos com amostra.
    expect(report.payloadSizesTotal.count).toBe(2)
    expect(report.payloadSizesTotal.maxBytes).toBe(m.maxBytes)
  })

  it('dry-run nao mede payload (todas as amostras = 0)', async () => {
    const throwing = {
      getMovie: () => Promise.reject(new Error('x')),
      getTvShow: () => Promise.reject(new Error('x')),
      getPerson: () => Promise.reject(new Error('x')),
    }
    const store = makeFakeStore()
    const selection = selectPilotItems([item('movie', 1), item('tv', 2)], LIMITS)
    const report = await runRawSyncPilot({
      selection,
      source: throwing,
      store,
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: true,
      retry: RETRY,
    })
    expect(report.payloadSizes.movie.count).toBe(0)
    expect(report.payloadSizes.tv.count).toBe(0)
    expect(report.payloadSizesTotal).toEqual({ count: 0, avgBytes: 0, maxBytes: 0, minBytes: 0 })
  })

  it('a contagem independe da concorrencia (1 vs 3)', async () => {
    const queue = [
      item('movie', 1),
      item('movie', 2),
      item('tv', 3),
      item('person', 4),
      item('person', 5),
    ]
    const selection = selectPilotItems(queue, LIMITS)
    const run = (concurrency: number) =>
      runRawSyncPilot({
        selection,
        source: makeFakeSource(),
        store: makeFakeStore(),
        baseLanguage: 'pt-BR',
        limits: LIMITS,
        now: NOW,
        dryRun: false,
        concurrency,
        retry: RETRY,
      })
    const [seq, par] = await Promise.all([run(1), run(3)])
    expect(par.totals).toEqual(seq.totals)
    expect(par.totals).toEqual({ created: 5, updated: 0, skipped: 0, failed: 0 })
  })

  it('sem teto/breaker: requests conta cada fetch, aborted=false, notProcessed=0', async () => {
    const selection = selectPilotItems(
      [item('movie', 1), item('movie', 2), item('person', 3)],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source: makeFakeSource(),
      store: makeFakeStore(),
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY, // maxAttempts: 1 => 1 request por item
    })
    expect(report.requests).toBe(3)
    expect(report.aborted).toBe(false)
    expect(report.abortReason).toBeNull()
    expect(report.notProcessed).toBe(0)
  })

  it('teto efetivo de requisicoes: para de iniciar itens e marca aborted/request-ceiling', async () => {
    const source = makeFakeSource()
    const selection = selectPilotItems(
      [item('movie', 1), item('movie', 2), item('movie', 3), item('movie', 4), item('movie', 5)],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source,
      store: makeFakeStore(),
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY, // 1 request por item => teto exato
      maxRequests: 2,
    })
    expect(report.requests).toBe(2)
    expect(report.totals).toEqual({ created: 2, updated: 0, skipped: 0, failed: 0 })
    expect(report.aborted).toBe(true)
    expect(report.abortReason).toBe('request-ceiling')
    expect(report.notProcessed).toBe(3) // 5 selecionados - 2 processados
    // Nao buscou os itens nao iniciados (retomavel no proximo ciclo).
    expect(source.calls.map((c) => c.id)).toEqual([1, 2])
  })

  it('circuito aberto (client) aborta o lote graciosamente e nao toca o resto', async () => {
    const calls: number[] = []
    const source = {
      getMovie: (id: number) => {
        calls.push(id)
        return id === 2
          ? Promise.reject({ name: 'TmdbCircuitOpenError', openUntil: 1 })
          : Promise.resolve(payloadFor('movie', id))
      },
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: () => Promise.reject(new Error('n/a')),
    }
    const selection = selectPilotItems(
      [item('movie', 1), item('movie', 2), item('movie', 3), item('movie', 4)],
      LIMITS,
    )
    const report = await runRawSyncPilot({
      selection,
      source,
      store: makeFakeStore(),
      baseLanguage: 'pt-BR',
      limits: LIMITS,
      now: NOW,
      dryRun: false,
      concurrency: 1,
      retry: RETRY,
    })
    expect(report.aborted).toBe(true)
    expect(report.abortReason).toBe('circuit-open')
    expect(report.totals).toEqual({ created: 1, updated: 0, skipped: 0, failed: 1 })
    expect(report.notProcessed).toBe(2) // itens 3 e 4 nunca iniciados
    expect(calls).toEqual([1, 2]) // nao marretou 3 e 4 contra o breaker aberto
  })
})
