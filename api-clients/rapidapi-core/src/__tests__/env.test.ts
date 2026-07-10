/**
 * env.test.ts — Leitores puros de env + normalizacao de base URL.
 *
 * A regra critica: `requireSecret` falha citando SO o nome da variavel. Um
 * segredo jamais pode vazar por mensagem de erro.
 */

import { describe, expect, it } from 'vitest'

import { RapidApiConfigError } from '../errors.js'
import {
  normalizeBaseUrl,
  readNonEmpty,
  readNonNegativeInt,
  readPositiveInt,
  requireSecret,
} from '../env.js'

const FAKE_SECRET = 'test-key-0000000000'

describe('requireSecret', () => {
  it('devolve o valor quando presente (trimado)', () => {
    expect(requireSecret({ K: `  ${FAKE_SECRET}  ` }, 'K')).toBe(FAKE_SECRET)
  })

  it('lanca RapidApiConfigError quando ausente, vazia ou so espacos', () => {
    for (const env of [{}, { K: '' }, { K: '   ' }]) {
      expect(() => requireSecret(env, 'K')).toThrow(RapidApiConfigError)
    }
  })

  it('a mensagem cita o NOME da variavel e nunca o valor do segredo', () => {
    // Um segredo presente em OUTRA variavel nao pode vazar pela mensagem.
    const env = { OUTRA: FAKE_SECRET }
    try {
      requireSecret(env, 'RAPIDAPI_X_KEY')
      expect.unreachable('deveria ter lancado')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain('RAPIDAPI_X_KEY')
      expect(message).not.toContain(FAKE_SECRET)
    }
  })
})

describe('normalizeBaseUrl', () => {
  it('remove a barra final (evita "//popular/" e request_key suja)', () => {
    expect(normalizeBaseUrl('https://a.p.rapidapi.com/')).toBe('https://a.p.rapidapi.com')
    expect(normalizeBaseUrl('https://a.p.rapidapi.com///')).toBe('https://a.p.rapidapi.com')
  })

  it('preserva uma base URL ja normalizada e um path de base', () => {
    expect(normalizeBaseUrl('https://a.p.rapidapi.com')).toBe('https://a.p.rapidapi.com')
    expect(normalizeBaseUrl('https://api.exemplo.com/v4')).toBe('https://api.exemplo.com/v4')
  })
})

describe('leitores numericos', () => {
  it('readPositiveInt: default para ausente/invalido/<=0', () => {
    expect(readPositiveInt(undefined, 7)).toBe(7)
    expect(readPositiveInt('', 7)).toBe(7)
    expect(readPositiveInt('abc', 7)).toBe(7)
    expect(readPositiveInt('0', 7)).toBe(7)
    expect(readPositiveInt('-3', 7)).toBe(7)
    expect(readPositiveInt('12', 7)).toBe(12)
  })

  it('readNonNegativeInt: aceita 0, recusa negativo', () => {
    expect(readNonNegativeInt('0', 4)).toBe(0)
    expect(readNonNegativeInt('-1', 4)).toBe(4)
    expect(readNonNegativeInt(undefined, 4)).toBe(4)
  })

  it('readNonEmpty: trim e undefined para vazio', () => {
    expect(readNonEmpty('  x  ')).toBe('x')
    expect(readNonEmpty('   ')).toBeUndefined()
    expect(readNonEmpty(undefined)).toBeUndefined()
  })
})
