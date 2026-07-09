/**
 * Testes do filtro de conteudo adulto (camada 2) — o ponto mais sensivel do
 * P0-00c. FAIL-CLOSED: so `adult === false`/ausente e seguro; qualquer `adult`
 * malformado (`"true"`, `1`, `null`, objeto...) e descartado como unsafe, nunca
 * mantido. Ids invalidos fora. Contagens separadas. Sem rede.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyAdult,
  filterAdult,
  hasValidId,
  isAdultRecord,
} from '../discovery/adult-filter.js'
import type { IdExportRecord } from '../discovery/id-exports.js'

/** Helper para montar registro com `adult` de qualquer tipo (simula JSON cru). */
function rec(id: number, adult?: unknown): IdExportRecord {
  return { id, adult } as unknown as IdExportRecord
}

describe('classifyAdult (fail-closed)', () => {
  it('true -> adult', () => {
    expect(classifyAdult(true)).toBe('adult')
  })

  it('false ou ausente -> safe', () => {
    expect(classifyAdult(false)).toBe('safe')
    expect(classifyAdult(undefined)).toBe('safe')
  })

  it('qualquer valor presente e malformado -> malformed (nunca seguro)', () => {
    expect(classifyAdult('true')).toBe('malformed')
    expect(classifyAdult('false')).toBe('malformed')
    expect(classifyAdult(1)).toBe('malformed')
    expect(classifyAdult(0)).toBe('malformed')
    expect(classifyAdult(null)).toBe('malformed')
    expect(classifyAdult({})).toBe('malformed')
    expect(classifyAdult([])).toBe('malformed')
    expect(classifyAdult('')).toBe('malformed')
  })
})

describe('isAdultRecord (estritamente adult === true)', () => {
  it('true apenas para o booleano true; false para os demais', () => {
    expect(isAdultRecord(rec(1, true))).toBe(true)
    expect(isAdultRecord(rec(1, false))).toBe(false)
    expect(isAdultRecord(rec(1))).toBe(false)
    // Malformado NAO e "adult" (mas tambem nao e seguro — filterAdult o descarta).
    expect(isAdultRecord(rec(1, 'true'))).toBe(false)
    expect(isAdultRecord(rec(1, 1))).toBe(false)
  })
})

describe('hasValidId', () => {
  it('exige inteiro positivo', () => {
    expect(hasValidId(rec(42))).toBe(true)
    expect(hasValidId(rec(0))).toBe(false)
    expect(hasValidId(rec(-5))).toBe(false)
    expect(hasValidId(rec(1.5))).toBe(false)
    expect(hasValidId(rec(NaN))).toBe(false)
    expect(hasValidId({} as unknown as IdExportRecord)).toBe(false)
  })
})

describe('filterAdult (fail-closed)', () => {
  it('mantem apenas id valido + adult seguro (false/ausente), preservando a ordem', () => {
    const records: IdExportRecord[] = [
      rec(1, false),
      rec(2, true), // adulto -> fora
      rec(3), // sem flag -> mantido
      rec(4, true), // adulto -> fora
      rec(5, false),
    ]
    const result = filterAdult(records)
    expect(result.kept.map((r) => r.id)).toEqual([1, 3, 5])
    expect(result.adultDropped).toBe(2)
    expect(result.unsafeDropped).toBe(0)
    expect(result.invalidDropped).toBe(0)
  })

  it('adult malformado NUNCA entra na fila (unsafeDropped)', () => {
    const records: IdExportRecord[] = [
      rec(1, 'true'), // string -> unsafe
      rec(2, 1), // numero -> unsafe
      rec(3, null), // null presente -> unsafe
      rec(4, {}), // objeto -> unsafe
      rec(5, false), // unico seguro
    ]
    const result = filterAdult(records)
    expect(result.kept.map((r) => r.id)).toEqual([5])
    expect(result.unsafeDropped).toBe(4)
    expect(result.adultDropped).toBe(0)
    expect(result.invalidDropped).toBe(0)
  })

  it('descarta ids invalidos e conta separado de adult/unsafe', () => {
    const records: IdExportRecord[] = [
      rec(0, false), // id invalido
      rec(-1), // id invalido
      rec(10, true), // adulto
      rec(11, 'true'), // unsafe
      rec(20), // ok
    ]
    const result = filterAdult(records)
    expect(result.kept.map((r) => r.id)).toEqual([20])
    expect(result.invalidDropped).toBe(2)
    expect(result.adultDropped).toBe(1)
    expect(result.unsafeDropped).toBe(1)
  })

  it('id invalido tem precedencia (checado primeiro), mesmo com adult true/malformado', () => {
    expect(filterAdult([rec(0, true)])).toMatchObject({
      kept: [],
      invalidDropped: 1,
      adultDropped: 0,
      unsafeDropped: 0,
    })
    expect(filterAdult([rec(0, 'true')])).toMatchObject({
      kept: [],
      invalidDropped: 1,
      unsafeDropped: 0,
    })
  })

  it('entrada vazia devolve tudo zerado', () => {
    expect(filterAdult([])).toEqual({
      kept: [],
      adultDropped: 0,
      unsafeDropped: 0,
      invalidDropped: 0,
    })
  })
})
