/**
 * Testes da projecao de entidade para search_documents (PURO).
 */

import { describe, expect, it } from 'vitest'
import { buildSearchDocument } from '../projection.js'

describe('buildSearchDocument', () => {
  it('dobra primaryText + aliases em normalizedText', () => {
    const row = buildSearchDocument({
      entityType: 'movie',
      entityId: '603',
      locale: 'pt-BR',
      primaryText: 'Matrix',
      alternativeTitles: ['The Matrix'],
    })
    expect(row.normalizedText).toBe('matrix the matrix')
    expect(row.primaryText).toBe('Matrix')
    expect(row.alternativeText).toBe('The Matrix')
    expect(row.normalizedAliases).toBe('the matrix')
  })

  it('junta aliases com " | ", remove vazios e duplicatas (por dobra)', () => {
    const row = buildSearchDocument({
      entityType: 'tv',
      entityId: '1',
      locale: 'pt-BR',
      primaryText: 'Round 6',
      alternativeTitles: ['Squid Game', '  ', 'squid game', 'O Jogo da Lula'],
    })
    expect(row.alternativeText).toBe('Squid Game | O Jogo da Lula')
  })

  it('normalizedText e acento-insensivel', () => {
    const row = buildSearchDocument({
      entityType: 'person',
      entityId: '5',
      locale: 'pt-BR',
      primaryText: 'Fernanda Montenegro',
    })
    expect(row.normalizedText).toBe('fernanda montenegro')
  })

  it('preenche campos ausentes com null', () => {
    const row = buildSearchDocument({
      entityType: 'movie',
      entityId: '7',
      locale: 'pt-BR',
      primaryText: 'Cidade de Deus',
    })
    expect(row.subtitle).toBeNull()
    expect(row.year).toBeNull()
    expect(row.popularity).toBeNull()
    expect(row.imagePath).toBeNull()
    expect(row.canonicalUrl).toBeNull()
    expect(row.alternativeText).toBe('')
  })
})
