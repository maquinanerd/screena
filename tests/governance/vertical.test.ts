/**
 * Testes de governanca — resolucao de vertical (@screena/ui).
 *
 * Garantem as invariantes 9 (filme = acento vermelho), 10 (serie = acento
 * verde) e, sobretudo, 11 (a diferenciacao filme/serie/neutro NUNCA depende
 * so da cor): para todo tipo de entidade, label e badge sao sempre truthy.
 */

import { describe, expect, it } from 'vitest'
import { resolveVertical, assertNotColorOnly } from '@screena/ui'

describe('resolveVertical', () => {
  it('(1) movie tem acento "red" e label/badge nao vazios', () => {
    const v = resolveVertical('movie')

    expect(v.accent).toBe('red')
    expect(v.vertical).toBe('movie')
    expect(v.label).toBeTruthy()
    expect(v.badge).toBeTruthy()
    expect(assertNotColorOnly(v)).toBe(true)
  })

  it('(2) series tem acento "green" e label/badge nao vazios', () => {
    const v = resolveVertical('series')

    expect(v.accent).toBe('green')
    expect(v.vertical).toBe('series')
    expect(v.label).toBeTruthy()
    expect(v.badge).toBeTruthy()
    expect(assertNotColorOnly(v)).toBe(true)
  })

  it('(3) person resolve para a vertical neutral', () => {
    const v = resolveVertical('person')

    expect(v.vertical).toBe('neutral')
    expect(v.schemaType).toBe('Person')
  })

  it('(4) movie, series e person sempre carregam label e badge truthy (nunca so cor)', () => {
    for (const entityType of ['movie', 'series', 'person'] as const) {
      const v = resolveVertical(entityType)

      expect(v.label).toBeTruthy()
      expect(v.badge).toBeTruthy()
      expect(assertNotColorOnly(v)).toBe(true)
    }
  })
})
