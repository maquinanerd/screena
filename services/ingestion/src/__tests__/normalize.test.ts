/**
 * Testes das normalizacoes puras de campos TMDB.
 */

import { describe, expect, it } from 'vitest'
import {
  isKnownLanguage,
  normalizeDate,
  normalizeImdbId,
  normalizeOriginalLanguage,
  nullableNumber,
  nullableString,
} from '../utils/normalize.js'

describe('normalize utils', () => {
  it('normalizeImdbId: vazio/espaco/ausente -> null; valido -> mantido', () => {
    expect(normalizeImdbId('')).toBeNull()
    expect(normalizeImdbId('   ')).toBeNull()
    expect(normalizeImdbId(undefined)).toBeNull()
    expect(normalizeImdbId(null)).toBeNull()
    expect(normalizeImdbId('tt1375666')).toBe('tt1375666')
  })

  it('normalizeDate: aceita so YYYY-MM-DD; resto -> null', () => {
    expect(normalizeDate('1999-03-31')).toBe('1999-03-31')
    expect(normalizeDate('')).toBeNull()
    expect(normalizeDate('1999')).toBeNull()
    expect(normalizeDate('31/03/1999')).toBeNull()
    expect(normalizeDate(null)).toBeNull()
  })

  it('normalizeOriginalLanguage: so idioma do seed; senao null (R1)', () => {
    expect(normalizeOriginalLanguage('en')).toBe('en')
    expect(normalizeOriginalLanguage('es')).toBe('es')
    expect(normalizeOriginalLanguage('pt-BR')).toBe('pt-BR')
    expect(normalizeOriginalLanguage('ja')).toBeNull()
    expect(normalizeOriginalLanguage('pt')).toBeNull()
    expect(normalizeOriginalLanguage('')).toBeNull()
  })

  it('nullableNumber / nullableString', () => {
    expect(nullableNumber(0)).toBe(0)
    expect(nullableNumber(8.4)).toBe(8.4)
    expect(nullableNumber(null)).toBeNull()
    expect(nullableNumber(Number.NaN)).toBeNull()
    expect(nullableString('  x  ')).toBe('x')
    expect(nullableString('')).toBeNull()
    expect(nullableString(undefined)).toBeNull()
  })

  it('isKnownLanguage reflete o seed languages', () => {
    expect(isKnownLanguage('pt-BR')).toBe(true)
    expect(isKnownLanguage('en')).toBe(true)
    expect(isKnownLanguage('ja')).toBe(false)
  })
})
