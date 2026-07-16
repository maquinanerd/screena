/**
 * Testes da chave de idempotencia de enfileiramento (PURO, sem DB).
 */

import { describe, expect, it } from 'vitest'
import { buildIdempotencyKey } from '../idempotency.js'

describe('buildIdempotencyKey', () => {
  it('e deterministica para a mesma entrada', () => {
    const a = buildIdempotencyKey({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
    })
    const b = buildIdempotencyKey({
      jobType: 'sync_details',
      entityType: 'movie',
      externalId: '603',
    })
    expect(a).toBe(b)
    expect(a).toBe('sync_details:movie:603:-')
  })

  it('distingue tipo, alvo e id externo', () => {
    const base = { jobType: 'sync_details', entityType: 'movie', externalId: '603' } as const
    expect(buildIdempotencyKey({ ...base, jobType: 'sync_credits' })).not.toBe(
      buildIdempotencyKey(base),
    )
    expect(buildIdempotencyKey({ ...base, entityType: 'tv' })).not.toBe(buildIdempotencyKey(base))
    expect(buildIdempotencyKey({ ...base, externalId: '604' })).not.toBe(buildIdempotencyKey(base))
  })

  it('o discriminador separa jobs do mesmo alvo (ex.: janela de changes)', () => {
    const a = buildIdempotencyKey({
      jobType: 'sync_changes',
      entityType: 'movie',
      discriminator: '2026-07-10',
    })
    const b = buildIdempotencyKey({
      jobType: 'sync_changes',
      entityType: 'movie',
      discriminator: '2026-07-16',
    })
    expect(a).not.toBe(b)
  })

  it('preenche segmentos ausentes com "-"', () => {
    expect(buildIdempotencyKey({ jobType: 'bootstrap' })).toBe('bootstrap:-:-:-')
  })

  it('normaliza espacos em branco para "_"', () => {
    expect(buildIdempotencyKey({ jobType: 'sync_lists', discriminator: 'movie popular' })).toBe(
      'sync_lists:-:-:movie_popular',
    )
  })
})
