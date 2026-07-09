/**
 * Testes da montagem idempotente da fila de sync: dedup por (kind,tmdbId),
 * ordenacao deterministica (kind -> popularidade desc -> id asc). Sem rede.
 */

import { describe, expect, it } from 'vitest'
import { buildSyncQueue, type DiscoverySource } from '../discovery/sync-queue.js'

describe('buildSyncQueue', () => {
  it('dedup por (kind,tmdbId) dentro de uma fonte', () => {
    const sources: DiscoverySource[] = [
      { kind: 'movie', records: [{ id: 1 }, { id: 1 }, { id: 2 }] },
    ]
    const queue = buildSyncQueue(sources)
    expect(queue.map((q) => q.tmdbId)).toEqual([1, 2])
  })

  it('mesmo id em kinds diferentes NAO e deduplicado (entidades distintas)', () => {
    const queue = buildSyncQueue([
      { kind: 'movie', records: [{ id: 5 }] },
      { kind: 'person', records: [{ id: 5 }] },
    ])
    expect(queue).toEqual([
      { kind: 'movie', tmdbId: 5, popularity: null },
      { kind: 'person', tmdbId: 5, popularity: null },
    ])
  })

  it('ordena por kind, depois popularidade desc, depois id asc', () => {
    const queue = buildSyncQueue([
      {
        kind: 'movie',
        records: [
          { id: 30, popularity: 1 },
          { id: 10, popularity: 9 },
          { id: 20, popularity: 9 }, // empate de popularidade -> id asc (10 antes de 20)
          { id: 40 }, // sem popularidade -> por ultimo
        ],
      },
      { kind: 'person', records: [{ id: 7, popularity: 100 }] },
    ])
    expect(queue).toEqual([
      { kind: 'movie', tmdbId: 10, popularity: 9 },
      { kind: 'movie', tmdbId: 20, popularity: 9 },
      { kind: 'movie', tmdbId: 30, popularity: 1 },
      { kind: 'movie', tmdbId: 40, popularity: null },
      { kind: 'person', tmdbId: 7, popularity: 100 },
    ])
  })

  it('e idempotente: ordem de entrada diferente produz a MESMA fila', () => {
    const a = buildSyncQueue([
      { kind: 'movie', records: [{ id: 2, popularity: 5 }, { id: 1, popularity: 8 }] },
    ])
    const b = buildSyncQueue([
      { kind: 'movie', records: [{ id: 1, popularity: 8 }, { id: 2, popularity: 5 }] },
    ])
    expect(a).toEqual(b)
    expect(a.map((q) => q.tmdbId)).toEqual([1, 2])
  })

  it('ignora ids invalidos defensivamente', () => {
    const queue = buildSyncQueue([
      { kind: 'movie', records: [{ id: 0 }, { id: -1 }, { id: 1.5 }, { id: 3 }] },
    ])
    expect(queue.map((q) => q.tmdbId)).toEqual([3])
  })

  it('dedup deterministico: id repetido com popularidade divergente mantem a MAIOR (independe da ordem)', () => {
    const a = buildSyncQueue([
      { kind: 'movie', records: [{ id: 1, popularity: 5 }, { id: 1, popularity: 8 }] },
    ])
    const b = buildSyncQueue([
      { kind: 'movie', records: [{ id: 1, popularity: 8 }, { id: 1, popularity: 5 }] },
    ])
    expect(a).toEqual([{ kind: 'movie', tmdbId: 1, popularity: 8 }])
    expect(a).toEqual(b) // idempotente sob reordenacao (antes: first-seen dependia da ordem)
  })

  it('defesa em profundidade: NUNCA enfileira adult===true nem valor malformado', () => {
    const queue = buildSyncQueue([
      {
        kind: 'movie',
        records: [
          { id: 1, adult: true }, // adulto -> fora, mesmo sem filtro previo
          { id: 2, adult: 'true' as unknown as boolean }, // malformado -> fora
          { id: 3, adult: false }, // seguro
          { id: 4 }, // ausente (value-based) -> seguro
        ],
      },
    ])
    expect(queue.map((q) => q.tmdbId)).toEqual([3, 4])
  })

  it('popularidade nao-finita vira null', () => {
    const queue = buildSyncQueue([
      { kind: 'movie', records: [{ id: 1, popularity: Number.NaN }] },
    ])
    expect(queue[0]?.popularity).toBeNull()
  })
})
