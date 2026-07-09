/**
 * Testes do filtro de conteudo adulto (camada 2) — o ponto mais sensivel do
 * P0-00c. Trava: `adult === true` estritamente, ids invalidos fora, contagens
 * separadas. Sem rede.
 */

import { describe, expect, it } from 'vitest'
import { filterAdult, hasValidId, isAdultRecord } from '../discovery/adult-filter.js'
import type { IdExportRecord } from '../discovery/id-exports.js'

describe('isAdultRecord (estritamente adult === true)', () => {
  it('true apenas para o booleano true', () => {
    expect(isAdultRecord({ id: 1, adult: true })).toBe(true)
  })

  it('false para adult=false, ausente ou nao-booleano', () => {
    expect(isAdultRecord({ id: 1, adult: false })).toBe(false)
    expect(isAdultRecord({ id: 1 })).toBe(false)
    // Valores nao-booleanos NAO viram adulto por acidente (defensivo).
    expect(isAdultRecord({ id: 1, adult: 'true' } as unknown as IdExportRecord)).toBe(false)
    expect(isAdultRecord({ id: 1, adult: 1 } as unknown as IdExportRecord)).toBe(false)
  })
})

describe('hasValidId', () => {
  it('exige inteiro positivo', () => {
    expect(hasValidId({ id: 42 })).toBe(true)
    expect(hasValidId({ id: 0 })).toBe(false)
    expect(hasValidId({ id: -5 })).toBe(false)
    expect(hasValidId({ id: 1.5 })).toBe(false)
    expect(hasValidId({ id: NaN })).toBe(false)
    expect(hasValidId({} as unknown as IdExportRecord)).toBe(false)
  })
})

describe('filterAdult', () => {
  it('descarta adult===true e mantem os demais, preservando a ordem', () => {
    const records: IdExportRecord[] = [
      { id: 1, adult: false },
      { id: 2, adult: true }, // adulto -> fora
      { id: 3 }, // sem flag -> mantido
      { id: 4, adult: true }, // adulto -> fora
      { id: 5, adult: false },
    ]
    const result = filterAdult(records)
    expect(result.kept.map((r) => r.id)).toEqual([1, 3, 5])
    expect(result.adultDropped).toBe(2)
    expect(result.invalidDropped).toBe(0)
  })

  it('descarta ids invalidos e conta separado do adult', () => {
    const records: IdExportRecord[] = [
      { id: 0, adult: false }, // id invalido
      { id: -1 }, // id invalido
      { id: 10, adult: true }, // adulto
      { id: 20 }, // ok
    ]
    const result = filterAdult(records)
    expect(result.kept.map((r) => r.id)).toEqual([20])
    expect(result.invalidDropped).toBe(2)
    expect(result.adultDropped).toBe(1)
  })

  it('id invalido E adulto conta como invalido (checado primeiro), nao como adulto', () => {
    const result = filterAdult([{ id: 0, adult: true }])
    expect(result.kept).toEqual([])
    expect(result.invalidDropped).toBe(1)
    expect(result.adultDropped).toBe(0)
  })

  it('entrada vazia devolve tudo zerado', () => {
    expect(filterAdult([])).toEqual({ kept: [], adultDropped: 0, invalidDropped: 0 })
  })
})
