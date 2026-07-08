/**
 * Testes puros do planejamento de slugs de pessoa a partir dos creditos TMDB.
 * Travam a garantia central (P0-10): toda pessoa creditada com id numerico
 * recebe um slug base NAO-vazio (fallback `tmdb-{id}`), deduplicada por id.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbCredits } from '@screena/tmdb-client'

import { planCreditedPeople } from '../public-catalog-people.js'

const credits: TmdbCredits = {
  cast: [
    { id: 1, name: 'Keanu Reeves' },
    { id: 2, name: 'Amélie Poulain' },
    { id: 1, name: 'Keanu Reeves' }, // duplicado -> uma so entrada
    { id: 3, name: '   ' }, // nome vazio -> fallback tmdb
  ],
  crew: [
    { id: 10, name: 'Lana Wachowski' },
    { id: 2, name: 'Amélie Poulain' }, // ja apareceu no cast -> nao duplica
  ],
}

describe('planCreditedPeople', () => {
  it('inclui toda pessoa creditada (cast + crew), deduplicada por tmdbId', () => {
    const ids = planCreditedPeople(credits).map((p) => p.tmdbId)
    expect(ids).toEqual([1, 2, 3, 10])
  })

  it('gera slug base NAO-vazio para cada pessoa (fallback tmdb-{id})', () => {
    const bySlug = new Map(planCreditedPeople(credits).map((p) => [p.tmdbId, p.baseSlug]))
    expect(bySlug.get(1)).toBe('keanu-reeves')
    expect(bySlug.get(2)).toBe('amelie-poulain')
    expect(bySlug.get(3)).toBe('tmdb-3') // nome vazio nunca vira slug vazio
    expect(bySlug.get(10)).toBe('lana-wachowski')
    for (const slug of bySlug.values()) expect(slug).not.toBe('')
  })

  it('descarta entradas sem id numerico (nunca inventa pessoa)', () => {
    const dirty = {
      cast: [{ name: 'Sem Id' } as unknown as { id: number; name: string }, { id: 5, name: 'Com Id' }],
    } satisfies TmdbCredits
    expect(planCreditedPeople(dirty).map((p) => p.tmdbId)).toEqual([5])
  })

  it('creditos ausentes -> plano vazio', () => {
    expect(planCreditedPeople(undefined)).toEqual([])
    expect(planCreditedPeople(null)).toEqual([])
    expect(planCreditedPeople({})).toEqual([])
  })
})
