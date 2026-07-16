/**
 * Testes do construtor PURO da consulta de busca (parametrizada, sem concat).
 */

import { describe, expect, it } from 'vitest'
import {
  buildSearchQuery,
  matchReasonFromTier,
  scoreFromTier,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from '../query.js'

describe('buildSearchQuery', () => {
  it('dobra o termo e o passa como parametro $1 (nunca concatenado)', () => {
    const q = buildSearchQuery('Amélie', { locale: 'pt-BR' })
    expect(q.term).toBe('amelie')
    expect(q.params[0]).toBe('amelie')
    // o SQL NAO contem o termo cru interpolado
    expect(q.sql).not.toContain('Amélie')
    expect(q.sql).not.toContain('amelie')
    // usa placeholders posicionais
    expect(q.sql).toContain('$1')
    expect(q.sql).toContain('LIMIT $4 OFFSET $5')
  })

  it('o parametro de prefixo e termo || "%"', () => {
    const q = buildSearchQuery('matr', { locale: 'pt-BR' })
    expect(q.params[1]).toBe('matr%')
  })

  it('inclui os 4 tiers de ranking e o desempate', () => {
    const q = buildSearchQuery('x', { locale: 'pt-BR' })
    expect(q.sql).toContain('immutable_unaccent(lower(primary_text)) = $1') // titulo exato
    expect(q.sql).toContain('$1 = ANY(string_to_array(normalized_aliases') // alias exato
    expect(q.sql).toContain('normalized_text % $1') // fuzzy trgm
    expect(q.sql).toContain('ORDER BY match_tier ASC, sim DESC')
  })

  it('aplica limite e offset como parametros, com clamp de seguranca', () => {
    const q = buildSearchQuery('x', { locale: 'pt-BR', limit: 999, offset: -5 })
    expect(q.params[3]).toBe(SEARCH_MAX_LIMIT) // 999 -> 50
    expect(q.params[4]).toBe(0) // -5 -> 0
    const def = buildSearchQuery('x', { locale: 'pt-BR' })
    expect(def.params[3]).toBe(SEARCH_DEFAULT_LIMIT)
  })

  it('locale entra como parametro $3', () => {
    const q = buildSearchQuery('x', { locale: 'pt-BR' })
    expect(q.params[2]).toBe('pt-BR')
  })

  it('termo so de espacos/acentos dobra para vazio', () => {
    expect(buildSearchQuery('   ', { locale: 'pt-BR' }).term).toBe('')
  })
})

describe('matchReasonFromTier', () => {
  it('mapeia tier -> rotulo', () => {
    expect(matchReasonFromTier(0)).toBe('exact')
    expect(matchReasonFromTier(1)).toBe('alias')
    expect(matchReasonFromTier(2)).toBe('prefix')
    expect(matchReasonFromTier(3)).toBe('prefix')
    expect(matchReasonFromTier(4)).toBe('fuzzy')
  })
})

describe('scoreFromTier', () => {
  it('e monotonico: titulo exato > alias > prefixo > fuzzy', () => {
    expect(scoreFromTier(0, 0)).toBeGreaterThan(scoreFromTier(1, 1))
    expect(scoreFromTier(1, 0)).toBeGreaterThan(scoreFromTier(2, 1))
    expect(scoreFromTier(2, 0)).toBeGreaterThan(scoreFromTier(3, 1))
    expect(scoreFromTier(3, 0)).toBeGreaterThan(scoreFromTier(4, 1))
  })

  it('o score fuzzy cresce com a similaridade mas nunca alcanca o prefixo', () => {
    expect(scoreFromTier(4, 0.9)).toBeGreaterThan(scoreFromTier(4, 0.1))
    expect(scoreFromTier(4, 1)).toBeLessThan(scoreFromTier(3, 0))
  })
})
