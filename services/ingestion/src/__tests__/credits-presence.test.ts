/**
 * credits-presence.test.ts — Contrato de PRESENCA de creditos do normalizer.
 *
 * `normalizeCredits` precisa distinguir "a fonte nao falou sobre creditos" de
 * "a fonte disse que nao ha creditos". As duas produzem `cast: []`; so os flags
 * `castPresent`/`crewPresent` as separam — e e neles que o adapter Prisma decide
 * se pode rodar o replace-set (que APAGA o que ja estava gravado).
 *
 * O efeito no store esta travado em
 * `services/ingestion/src/persistence/__tests__/store-credits.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import { normalizeCredits } from '../normalizers/credits.js'
import { normalizeMovie } from '../normalizers/movie.js'
import { normalizeTvShow } from '../normalizers/tv.js'

describe('normalizeCredits — presenca declarada pela fonte', () => {
  it('sem bloco `credits` (append ausente): nao presente', () => {
    const result = normalizeCredits(undefined)
    expect(result).toEqual({ cast: [], crew: [], castPresent: false, crewPresent: false })
  })

  it('bloco `credits` vazio (corpo truncado): nao presente', () => {
    const result = normalizeCredits({})
    expect(result.castPresent).toBe(false)
    expect(result.crewPresent).toBe(false)
  })

  it('listas presentes porem VAZIAS: presente (a fonte afirmou que nao ha creditos)', () => {
    const result = normalizeCredits({ cast: [], crew: [] })
    expect(result.castPresent).toBe(true)
    expect(result.crewPresent).toBe(true)
    expect(result.cast).toEqual([])
  })

  it('presenca e por lista: `cast` presente nao implica `crew` presente', () => {
    const result = normalizeCredits({ cast: [{ id: 819, name: 'Edward Norton' }] })
    expect(result.castPresent).toBe(true)
    expect(result.crewPresent).toBe(false)
    expect(result.cast).toHaveLength(1)
  })

  it('lista nao-array (payload anomalo): tratada como ausente, nunca como vazia', () => {
    // FAIL-CLOSED: um corpo malformado nao pode virar autorizacao para apagar.
    const anomalous = { cast: null, crew: 'nao-e-array' } as unknown as Parameters<
      typeof normalizeCredits
    >[0]
    const result = normalizeCredits(anomalous)
    expect(result.castPresent).toBe(false)
    expect(result.crewPresent).toBe(false)
    expect(result.cast).toEqual([])
    expect(result.crew).toEqual([])
  })
})

describe('a presenca chega inteira ate o normalizer da entidade', () => {
  it('normalizeMovie propaga os flags', () => {
    expect(normalizeMovie({ id: 550, original_title: 'Fight Club' })).toMatchObject({
      castPresent: false,
      crewPresent: false,
    })
    expect(
      normalizeMovie({ id: 550, original_title: 'Fight Club', credits: { cast: [], crew: [] } }),
    ).toMatchObject({ castPresent: true, crewPresent: true })
  })

  it('normalizeTvShow propaga os flags', () => {
    expect(normalizeTvShow({ id: 1396, original_name: 'Breaking Bad' })).toMatchObject({
      castPresent: false,
      crewPresent: false,
    })
    expect(
      normalizeTvShow({ id: 1396, original_name: 'Breaking Bad', credits: { crew: [] } }),
    ).toMatchObject({ castPresent: false, crewPresent: true })
  })
})
