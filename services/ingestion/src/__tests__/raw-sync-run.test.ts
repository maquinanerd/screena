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
})
