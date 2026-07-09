/**
 * Testes do contrato do incremental via /changes (nao executa nada). Sem rede.
 */

import { describe, expect, it } from 'vitest'
import {
  CHANGES_KINDS,
  CHANGES_MAX_WINDOW_DAYS,
  formatChangesDate,
  planChangesRequests,
} from '../discovery/changes-plan.js'

describe('contrato /changes', () => {
  it('so movie/tv/person tem endpoint de changes', () => {
    expect(CHANGES_KINDS).toEqual(['movie', 'tv', 'person'])
  })

  it('formatChangesDate usa YYYY-MM-DD em UTC', () => {
    expect(formatChangesDate(new Date(Date.UTC(2026, 6, 9)))).toBe('2026-07-09')
  })

  it('planeja um request por kind com path e janela corretos', () => {
    const start = new Date(Date.UTC(2026, 6, 8))
    const end = new Date(Date.UTC(2026, 6, 9))
    expect(planChangesRequests(start, end)).toEqual([
      { kind: 'movie', path: '/movie/changes', startDate: '2026-07-08', endDate: '2026-07-09' },
      { kind: 'tv', path: '/tv/changes', startDate: '2026-07-08', endDate: '2026-07-09' },
      { kind: 'person', path: '/person/changes', startDate: '2026-07-08', endDate: '2026-07-09' },
    ])
  })

  it('respeita subconjunto de kinds', () => {
    const d = new Date(Date.UTC(2026, 6, 9))
    expect(planChangesRequests(d, d, ['movie'])).toEqual([
      { kind: 'movie', path: '/movie/changes', startDate: '2026-07-09', endDate: '2026-07-09' },
    ])
  })

  it('lanca se end < start', () => {
    const start = new Date(Date.UTC(2026, 6, 9))
    const end = new Date(Date.UTC(2026, 6, 8))
    expect(() => planChangesRequests(start, end)).toThrow(/anterior/)
  })

  it('lanca se a janela exceder o maximo do TMDB (14 dias)', () => {
    const start = new Date(Date.UTC(2026, 0, 1))
    const end = new Date(Date.UTC(2026, 0, 1 + CHANGES_MAX_WINDOW_DAYS + 1))
    expect(() => planChangesRequests(start, end)).toThrow(/excede o maximo/)
  })
})
