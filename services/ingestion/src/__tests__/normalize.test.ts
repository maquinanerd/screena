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

  // ESTE TESTE AFIRMAVA O DEFEITO. Ele exigia `ja -> null` e `pt -> null`:
  // japones e portugues, dois dos CINCO idiomas que o dono manda MANTER. O
  // filtro nunca foi um literal no codigo — era `languages` ter tres linhas —,
  // e o teste petrificava a consequencia como se fosse a intencao.
  it('normalizeOriginalLanguage: grava o codigo do TMDB, sem lista fechada', () => {
    expect(normalizeOriginalLanguage('en')).toBe('en')
    expect(normalizeOriginalLanguage('es')).toBe('es')
    expect(normalizeOriginalLanguage('pt-BR')).toBe('pt-BR')
    expect(normalizeOriginalLanguage('ja')).toBe('ja')
    expect(normalizeOriginalLanguage('pt')).toBe('pt')
    expect(normalizeOriginalLanguage('te')).toBe('te')
    // Ausencia e codigo desconhecido continuam virando null (guarda de FK).
    expect(normalizeOriginalLanguage('')).toBeNull()
    expect(normalizeOriginalLanguage('zzz')).toBeNull()
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

  it('isKnownLanguage reflete o seed languages (agora o ISO 639-1 inteiro)', () => {
    expect(isKnownLanguage('pt-BR')).toBe(true)
    expect(isKnownLanguage('en')).toBe(true)
    // Era `false` — e por isso todo titulo japones perdia o idioma.
    expect(isKnownLanguage('ja')).toBe(true)
    expect(isKnownLanguage('pt')).toBe(true)
    expect(isKnownLanguage('te')).toBe(true)
    // O dicionario e grande, nao infinito: codigo inventado continua fora.
    expect(isKnownLanguage('zzz')).toBe(false)
  })
})
