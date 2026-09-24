/**
 * relevance-gate.test.ts — a CHAVE de emergencia do portao de relevancia.
 *
 * Decisao do dono (24/09/2026): o portao NASCE LIGADO e so `off` desliga.
 * Nenhum valor malformado pode reabrir o indice por acidente.
 */

import { describe, expect, it } from 'vitest'

import {
  isRelevanceGateEnabled,
  RELEVANCE_GATE_ANCHOR_COUNTRIES,
  RELEVANCE_GATE_ENV_VAR,
  RELEVANCE_GATE_MIN_TMDB_VOTES,
  RELEVANCE_GATE_OFFER_COUNTRY,
} from '../relevance-gate.js'

describe('isRelevanceGateEnabled', () => {
  it('AUSENTE = ligado (nasce ligado)', () => {
    expect(isRelevanceGateEnabled({})).toBe(true)
  })

  it('`off` desliga — com caixa e espacos tolerados', () => {
    expect(isRelevanceGateEnabled({ [RELEVANCE_GATE_ENV_VAR]: 'off' })).toBe(false)
    expect(isRelevanceGateEnabled({ [RELEVANCE_GATE_ENV_VAR]: ' OFF ' })).toBe(false)
  })

  it('qualquer outro valor = ligado', () => {
    for (const value of ['', 'on', 'false', '0', 'no', 'desligado', 'of', 'offf']) {
      expect(isRelevanceGateEnabled({ [RELEVANCE_GATE_ENV_VAR]: value }), value).toBe(true)
    }
  })

  it('le o ambiente NA CHAMADA, nao no import', () => {
    const before = process.env[RELEVANCE_GATE_ENV_VAR]
    try {
      process.env[RELEVANCE_GATE_ENV_VAR] = 'off'
      expect(isRelevanceGateEnabled()).toBe(false)
      delete process.env[RELEVANCE_GATE_ENV_VAR]
      expect(isRelevanceGateEnabled()).toBe(true)
    } finally {
      if (before === undefined) delete process.env[RELEVANCE_GATE_ENV_VAR]
      else process.env[RELEVANCE_GATE_ENV_VAR] = before
    }
  })
})

describe('numeros do portao (decisao de 24/09/2026)', () => {
  it('limiar, paises ancora e territorio da oferta', () => {
    expect(RELEVANCE_GATE_MIN_TMDB_VOTES).toBe(500)
    expect([...RELEVANCE_GATE_ANCHOR_COUNTRIES]).toEqual(['US', 'BR'])
    expect(RELEVANCE_GATE_OFFER_COUNTRY).toBe('BR')
    expect(Object.isFrozen(RELEVANCE_GATE_ANCHOR_COUNTRIES)).toBe(true)
  })
})
