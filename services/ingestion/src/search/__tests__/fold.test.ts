/**
 * Testes da dobra de texto acento-insensivel (PURO).
 */

import { describe, expect, it } from 'vitest'
import { foldText } from '../fold.js'

describe('foldText', () => {
  it('remove acentos (NFD + strip combinantes)', () => {
    expect(foldText('Amélie')).toBe('amelie')
    expect(foldText('Coração')).toBe('coracao')
    expect(foldText('Ão')).toBe('ao')
    expect(foldText('José')).toBe('jose')
  })

  it('passa a minusculo', () => {
    expect(foldText('MATRIX')).toBe('matrix')
  })

  it('colapsa espacos e apara as pontas', () => {
    expect(foldText('  O   Senhor  dos  Aneis  ')).toBe('o senhor dos aneis')
  })

  it('termo so de espacos/acentos vira string vazia apos trim', () => {
    expect(foldText('   ')).toBe('')
  })

  it('e idempotente (dobrar o dobrado nao muda)', () => {
    const once = foldText('Crônicas de Nárnia')
    expect(foldText(once)).toBe(once)
  })
})
