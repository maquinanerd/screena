/**
 * Prioridade de locale — determinismo INDEPENDENTE da ordem de entrada.
 *
 * Este e o teste que REALMENTE trava a regra. O check equivalente em PostgreSQL
 * nao consegue: sem `orderBy`, a ordem vem do plano, e hoje o index scan devolve
 * `'pt'` antes de `'pt-BR'` — o que faz ate o codigo bugado (`new Map`,
 * last-wins) acertar por acidente. Aqui alimentamos as DUAS ordens e exigimos o
 * mesmo resultado, entao o codigo bugado falharia numa delas.
 */

import { describe, expect, it } from 'vitest'
import { localeRank, pickByLocale, pickOneByLocale } from '../locale-priority.js'

/** Linha de slug de teste. */
function slugRow(languageCode: string, slug: string, entityId = 1n) {
  return { entityId, languageCode, slug }
}

describe('localeRank', () => {
  it('pt-BR vence pt; desconhecido perde de ambos', () => {
    expect(localeRank('pt-BR')).toBeLessThan(localeRank('pt'))
    expect(localeRank('en')).toBeGreaterThan(localeRank('pt'))
    expect(localeRank('')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('pickByLocale', () => {
  const ptBr = slugRow('pt-BR', 'matrix')
  const pt = slugRow('pt', 'matrix-pt')

  it('pt-BR vence com pt-BR PRIMEIRO na entrada', () => {
    expect(pickByLocale([ptBr, pt]).get('1')?.slug).toBe('matrix')
  })

  it('pt-BR vence com pt PRIMEIRO na entrada (ordem inversa)', () => {
    // Esta e a ordem que o `new Map(rows.map(...))` erraria: last-wins daria
    // 'matrix-pt'. A prioridade explicita da o mesmo resultado das duas formas.
    expect(pickByLocale([pt, ptBr]).get('1')?.slug).toBe('matrix')
  })

  it('o resultado e IDENTICO em qualquer permutacao da entrada', () => {
    const rows = [pt, ptBr, slugRow('en', 'matrix-en')]
    const permutations = [
      [rows[0], rows[1], rows[2]],
      [rows[2], rows[1], rows[0]],
      [rows[1], rows[2], rows[0]],
      [rows[2], rows[0], rows[1]],
    ]
    for (const permutation of permutations) {
      expect(pickByLocale(permutation as typeof rows).get('1')?.slug).toBe('matrix')
    }
  })

  it('locale desconhecido nunca vence, mesmo vindo por ultimo', () => {
    expect(pickByLocale([ptBr, slugRow('en', 'matrix-en')]).get('1')?.slug).toBe('matrix')
    expect(pickByLocale([slugRow('en', 'matrix-en'), ptBr]).get('1')?.slug).toBe('matrix')
  })

  it('so locale desconhecido: devolve o que existe (nao inventa lacuna)', () => {
    expect(pickByLocale([slugRow('en', 'matrix-en')]).get('1')?.slug).toBe('matrix-en')
  })

  it('separa por entidade (nao mistura linhas de ids diferentes)', () => {
    const best = pickByLocale([
      slugRow('pt', 'a-pt', 1n),
      slugRow('pt-BR', 'a-ptbr', 1n),
      slugRow('pt', 'b-pt', 2n),
    ])
    expect(best.get('1')?.slug).toBe('a-ptbr')
    expect(best.get('2')?.slug).toBe('b-pt')
    expect(best.size).toBe(2)
  })

  it('entrada vazia devolve mapa vazio', () => {
    expect(pickByLocale([]).size).toBe(0)
  })
})

describe('pickOneByLocale', () => {
  it('escolhe por prioridade nas duas ordens de entrada', () => {
    const ptBr = slugRow('pt-BR', 'x')
    const pt = slugRow('pt', 'x-pt')
    expect(pickOneByLocale([ptBr, pt])?.slug).toBe('x')
    expect(pickOneByLocale([pt, ptBr])?.slug).toBe('x')
  })

  it('vazio devolve null', () => {
    expect(pickOneByLocale([])).toBeNull()
  })
})
