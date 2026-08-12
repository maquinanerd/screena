/**
 * value.test.ts — Parser dos tres formatos de `Ratings[].Value` da OMDb.
 *
 * Um caso por formato, mais os caminhos de recusa exigidos: `N/A`, vazio e
 * formato inesperado. Cada recusa e verificada pelo MOTIVO, nao so por "nao
 * passou" — recusar pela razao errada esconde bug.
 */

import { describe, expect, it } from 'vitest'

import { parseOmdbRatingValue, PERCENT_SCALE } from '../value.js'

describe('parseOmdbRatingValue — os tres formatos reais', () => {
  it('"7.6/10" (IMDb) -> valor 7.6 na escala 10', () => {
    const result = parseOmdbRatingValue('7.6/10')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.parsed).toEqual({ value: 7.6, scale: 10 })
  })

  it('"85%" (Rotten Tomatoes) -> valor 85 na escala 100', () => {
    const result = parseOmdbRatingValue('85%')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.parsed).toEqual({ value: 85, scale: PERCENT_SCALE })
  })

  it('"67/100" (Metacritic) -> valor 67 na escala 100', () => {
    const result = parseOmdbRatingValue('67/100')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.parsed).toEqual({ value: 67, scale: 100 })
  })

  it('NAO normaliza 85% para 8.5: a escala sai do proprio literal', () => {
    const percent = parseOmdbRatingValue('85%')
    const fraction = parseOmdbRatingValue('8.5/10')
    expect(percent.ok && percent.parsed.scale).toBe(100)
    expect(fraction.ok && fraction.parsed.scale).toBe(10)
    // Os dois descrevem "85% de aprovacao" e "8,5 de 10" e NAO sao o mesmo
    // numero. Se algum dia colapsarem, a invariante 1 foi violada.
    expect(percent.ok && percent.parsed.value).not.toBe(fraction.ok && fraction.parsed.value)
  })
})

describe('parseOmdbRatingValue — recusas, cada uma com seu motivo', () => {
  it('"N/A" -> not-available (a fonte nao publicou nota)', () => {
    const result = parseOmdbRatingValue('N/A')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('not-available')
    expect(result.detail).toContain('N/A')
  })

  it('"n/a" em minusculas tambem e reconhecido como sentinela', () => {
    const result = parseOmdbRatingValue('n/a')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('not-available')
  })

  it('string vazia -> empty', () => {
    const result = parseOmdbRatingValue('')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('empty')
  })

  it('so espacos -> empty', () => {
    const result = parseOmdbRatingValue('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('empty')
  })

  it('campo ausente (undefined) -> empty, nunca crash', () => {
    const result = parseOmdbRatingValue(undefined)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('empty')
  })

  it('numero cru (nao string) -> empty: a OMDb sempre manda string', () => {
    const result = parseOmdbRatingValue(7.6)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('empty')
  })

  it('formato inesperado ("Fresh") -> unrecognized-format, com o valor no detalhe', () => {
    const result = parseOmdbRatingValue('Fresh')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('unrecognized-format')
    expect(result.detail).toContain('Fresh')
  })

  it('formato inesperado ("7,6 de 10") -> unrecognized-format', () => {
    const result = parseOmdbRatingValue('7,6 de 10')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('unrecognized-format')
  })

  it('denominador zero -> invalid-number (nunca divide nem assume escala)', () => {
    const result = parseOmdbRatingValue('5/0')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('invalid-number')
  })

  it('valor acima da propria escala ("11/10") -> value-exceeds-scale', () => {
    const result = parseOmdbRatingValue('11/10')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('value-exceeds-scale')
  })

  it('percentual acima de 100 ("120%") -> value-exceeds-scale', () => {
    const result = parseOmdbRatingValue('120%')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal).toBe('value-exceeds-scale')
  })

  it('nenhuma recusa e silenciosa: toda recusa tem detalhe nao vazio', () => {
    const inputs: readonly unknown[] = ['N/A', '', '   ', 'Fresh', '5/0', '11/10', '120%', null, 42]
    for (const input of inputs) {
      const result = parseOmdbRatingValue(input)
      expect(result.ok, `esperava recusa para ${JSON.stringify(input)}`).toBe(false)
      if (result.ok) continue
      expect(result.detail.trim().length).toBeGreaterThan(0)
    }
  })
})
