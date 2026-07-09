/**
 * Testes de IDEMPOTENCIA de RE-RUN do raw sync (P0-00e): rodar duas vezes o mesmo
 * lote nao duplica payload em tmdb_raw, itens que falharam sao retomaveis no
 * ciclo seguinte, e payload que mudou vira update (nunca linha nova). Sem rede,
 * sem DB — o store fake simula a chave natural unica de `tmdb_raw`
 * (`@@unique([entityType, tmdbId, baseLanguage])`): um segundo `create` na MESMA
 * chave e REJEITADO, exatamente como o Postgres faria. Assim, qualquer regressao
 * que tentasse gravar duas vezes viraria `failed` e quebraria estes testes.
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

const keyStr = (k: RawEntityKey) => `${k.entityType}:${k.tmdbId}:${k.baseLanguage}`

function item(kind: QueueItem['kind'], tmdbId: number): QueueItem {
  return { kind, tmdbId, popularity: null }
}

/** Payload determinista por (kind,id). */
function payloadFor(kind: string, id: number): { kind: string; id: number } {
  return { kind, id }
}

/**
 * Store fake que guarda LINHAS (payload + hash) por chave natural e falha um
 * segundo `create` na mesma chave — espelha o unique de `tmdb_raw`. Permite
 * afirmar "sem payload duplicado" de forma forte.
 */
function makeFakeStore() {
  const rows = new Map<string, { payloadHash: string; payload: unknown; fetchedAt: Date }>()
  const writes: Array<{ op: 'create' | 'update'; key: string; hash: string }> = []
  return {
    rows,
    writes,
    readHash(key: RawEntityKey) {
      return Promise.resolve(rows.get(keyStr(key))?.payloadHash ?? null)
    },
    create(record: RawEntityRecord) {
      const k = keyStr(record)
      if (rows.has(k)) {
        return Promise.reject(new Error(`unique violation: create em chave existente ${k}`))
      }
      rows.set(k, { payloadHash: record.payloadHash, payload: record.payload, fetchedAt: record.fetchedAt })
      writes.push({ op: 'create', key: k, hash: record.payloadHash })
      return Promise.resolve()
    },
    update(key: RawEntityKey, record: RawEntityRecord) {
      const k = keyStr(key)
      rows.set(k, { payloadHash: record.payloadHash, payload: record.payload, fetchedAt: record.fetchedAt })
      writes.push({ op: 'update', key: k, hash: record.payloadHash })
      return Promise.resolve()
    },
  }
}

/** Fonte fake determinista (payload por (kind,id)); registra chamadas. */
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

type Store = ReturnType<typeof makeFakeStore>
type Source = {
  getMovie(id: number): Promise<unknown>
  getTvShow(id: number): Promise<unknown>
  getPerson(id: number): Promise<unknown>
}

/** Roda o piloto (apply) sobre uma fila e um store persistente entre execucoes. */
function runOnce(items: readonly QueueItem[], source: Source, store: Store) {
  return runRawSyncPilot({
    selection: selectPilotItems(items, LIMITS),
    source,
    store,
    baseLanguage: 'pt-BR',
    limits: LIMITS,
    now: NOW,
    dryRun: false,
    concurrency: 1,
    retry: RETRY,
  })
}

describe('raw sync — idempotencia de re-run', () => {
  it('re-run do MESMO lote: run1 cria tudo, run2 pula tudo (zero write novo, sem duplicata)', async () => {
    const items = [item('movie', 1), item('tv', 2), item('person', 3)]
    const store = makeFakeStore()

    const r1 = await runOnce(items, makeFakeSource(), store)
    expect(r1.totals).toEqual({ created: 3, updated: 0, skipped: 0, failed: 0 })
    expect(store.writes).toHaveLength(3)

    const r2 = await runOnce(items, makeFakeSource(), store)
    expect(r2.totals).toEqual({ created: 0, updated: 0, skipped: 3, failed: 0 })
    // Nenhum write novo no re-run; store mantem exatamente 1 linha por chave.
    expect(store.writes).toHaveLength(3)
    expect(store.rows.size).toBe(3)
    // Hash estavel entre execucoes (idempotencia real).
    expect(store.rows.get('movie:1:pt-BR')?.payloadHash).toBe(
      computeRawPayloadHash(payloadFor('movie', 1)),
    )
  })

  it('falha parcial e RETOMAVEL: item que falhou nao e gravado e vira create no re-run', async () => {
    const store = makeFakeStore()
    const items = [item('movie', 1), item('movie', 2), item('movie', 3)]

    // Run 1: movie:2 falha (permanente) — nada e gravado para ele.
    const failing: Source = {
      getMovie: (id: number) =>
        id === 2
          ? Promise.reject({ permanent: true, status: 404 })
          : Promise.resolve(payloadFor('movie', id)),
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: () => Promise.reject(new Error('n/a')),
    }
    const r1 = await runOnce(items, failing, store)
    expect(r1.totals).toEqual({ created: 2, updated: 0, skipped: 0, failed: 1 })
    expect(store.rows.has('movie:2:pt-BR')).toBe(false)

    // Run 2: fonte saudavel — movie:2 vira create; os ja gravados pulam.
    const r2 = await runOnce(items, makeFakeSource(), store)
    expect(r2.totals).toEqual({ created: 1, updated: 0, skipped: 2, failed: 0 })
    expect(store.rows.size).toBe(3) // sem duplicata; o lote convergiu
  })

  it('payload que MUDOU vira update (mesma linha), nunca payload duplicado', async () => {
    const store = makeFakeStore()
    const items = [item('movie', 1)]
    const sourceA: Source = {
      getMovie: () => Promise.resolve({ v: 'A' }),
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: () => Promise.reject(new Error('n/a')),
    }
    const sourceB: Source = {
      getMovie: () => Promise.resolve({ v: 'B' }),
      getTvShow: () => Promise.reject(new Error('n/a')),
      getPerson: () => Promise.reject(new Error('n/a')),
    }

    const r1 = await runOnce(items, sourceA, store)
    expect(r1.totals).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 })

    const r2 = await runOnce(items, sourceB, store)
    expect(r2.totals).toEqual({ created: 0, updated: 1, skipped: 0, failed: 0 })
    expect(store.rows.size).toBe(1) // update, nao linha nova
    expect(store.rows.get('movie:1:pt-BR')?.payloadHash).toBe(computeRawPayloadHash({ v: 'B' }))
  })

  it('fila com id repetido nao gera create duplicado (dedup no seletor)', async () => {
    const store = makeFakeStore()
    // A mesma (movie,1) tres vezes: se nao houvesse dedup, o 2o create bateria no
    // unique do store e viraria `failed`. Com dedup, e 1 create limpo.
    const items = [item('movie', 1), item('movie', 1), item('movie', 1)]
    const source = makeFakeSource()
    const r = await runOnce(items, source, store)
    expect(r.totals).toEqual({ created: 1, updated: 0, skipped: 0, failed: 0 })
    expect(store.rows.size).toBe(1)
    expect(source.calls).toEqual([{ method: 'getMovie', id: 1 }]) // buscado uma vez so
  })
})
