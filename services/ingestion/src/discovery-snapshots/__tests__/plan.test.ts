/**
 * Testes do planejador PURO de snapshots de descoberta (sem rede/DB).
 */

import { describe, expect, it } from 'vitest'
import {
  DISCOVERY_TTL_MS,
  extractListItems,
  isSnapshotValid,
  planDiscoverySnapshot,
} from '../index.js'

const capturedAt = new Date('2026-07-16T12:00:00.000Z')

describe('extractListItems', () => {
  it('extrai results[] preservando a ordem e a popularidade', () => {
    const items = extractListItems({
      results: [
        { id: 603, popularity: 80.5 },
        { id: 604, popularity: 60 },
      ],
    })
    expect(items).toEqual([
      { entityTmdbId: 603, position: 0, providerScore: 80.5 },
      { entityTmdbId: 604, position: 1, providerScore: 60 },
    ])
  })

  it('descarta itens sem id inteiro positivo', () => {
    const items = extractListItems({
      results: [{ id: 603 }, { id: 0 }, { id: -1 }, { id: 'x' }, {}, { id: 604 }],
    })
    expect(items.map((i) => i.entityTmdbId)).toEqual([603, 604])
  })

  it('continua a numeracao a partir de startPosition (paginacao)', () => {
    const items = extractListItems({ results: [{ id: 700 }, { id: 701 }] }, 20)
    expect(items.map((i) => i.position)).toEqual([20, 21])
  })

  it('payload invalido => lista vazia', () => {
    expect(extractListItems(null)).toEqual([])
    expect(extractListItems({})).toEqual([])
    expect(extractListItems({ results: 'nope' })).toEqual([])
  })

  it('popularity ausente/invalida vira null (nunca inventa score)', () => {
    const items = extractListItems({ results: [{ id: 1 }, { id: 2, popularity: 'alta' }] })
    expect(items.every((i) => i.providerScore === null)).toBe(true)
  })
})

describe('planDiscoverySnapshot', () => {
  it('deriva expiresAt do TTL do tipo de lista', () => {
    const plan = planDiscoverySnapshot({
      listType: 'trending',
      entityType: 'movie',
      locale: 'pt-BR',
      items: [],
      payloadHash: 'h1',
      capturedAt,
    })
    expect(plan.expiresAt.getTime() - capturedAt.getTime()).toBe(DISCOVERY_TTL_MS.trending)
    expect(plan.provider).toBe('tmdb')
  })

  it('reindexa as posicoes para ficarem densas e 0-based', () => {
    const plan = planDiscoverySnapshot({
      listType: 'popular',
      entityType: 'movie',
      locale: 'pt-BR',
      items: [
        { entityTmdbId: 1, position: 7, providerScore: null },
        { entityTmdbId: 2, position: 19, providerScore: null },
      ],
      payloadHash: 'h',
      capturedAt,
    })
    expect(plan.items.map((i) => i.position)).toEqual([0, 1])
  })

  it('normaliza country/window ausentes para null', () => {
    const plan = planDiscoverySnapshot({
      listType: 'popular',
      entityType: 'tv',
      locale: 'pt-BR',
      items: [],
      payloadHash: 'h',
      capturedAt,
    })
    expect(plan.country).toBeNull()
    expect(plan.window).toBeNull()
  })

  it('aceita TTL explicito', () => {
    const plan = planDiscoverySnapshot({
      listType: 'discover',
      entityType: 'movie',
      locale: 'pt-BR',
      items: [],
      payloadHash: 'h',
      capturedAt,
      ttlMs: 1000,
    })
    expect(plan.expiresAt.getTime()).toBe(capturedAt.getTime() + 1000)
  })
})

describe('isSnapshotValid', () => {
  it('valido antes de expirar, invalido depois', () => {
    const snap = { expiresAt: new Date('2026-07-16T18:00:00.000Z') }
    expect(isSnapshotValid(snap, capturedAt)).toBe(true)
    expect(isSnapshotValid(snap, new Date('2026-07-16T18:00:01.000Z'))).toBe(false)
  })
})
