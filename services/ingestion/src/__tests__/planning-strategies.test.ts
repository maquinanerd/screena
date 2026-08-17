/**
 * planning-strategies.test.ts — Estrategia nao suportada e RECUSADA em TODO
 * caminho, inclusive nos que escrevem.
 *
 * O defeito original: `plan-bootstrap` aceitava texto cru, caia no `else` da
 * cadeia de listas e virava `popular` — reportando o nome pedido. Este teste
 * cobre os DOIS caminhos:
 *
 *   plan-bootstrap (le)     -> assertPlannableStrategy
 *   catalog bootstrap (ESCREVE) -> validateBootstrapInput / validateDiscoverIdsInput
 *
 * O caminho que escreve e o que mais importa aqui: um `--apply` com estrategia
 * silenciosamente trocada enfileira o catalogo errado.
 */

import { describe, expect, it } from 'vitest'

import {
  assertPlannableStrategy,
  INGESTION_STRATEGIES,
  isPlannableStrategy,
  PLANNABLE_STRATEGIES,
  UnsupportedStrategyError,
} from '../planning/strategies.js'
import {
  DISCOVER_STRATEGIES,
  validateBootstrapInput,
  validateDiscoverIdsInput,
} from '../catalog-jobs/handlers/schemas.js'

/** Valores que nao existem em caminho nenhum. */
const LIXO = ['', '   ', 'daily_exports', 'POPULAR', 'popularr', 'random', 'undefined']

describe('as duas listas nao podem divergir', () => {
  it('INGESTION_STRATEGIES espelha DISCOVER_STRATEGIES do schema', () => {
    // A copia e deliberada (o planejador e puro e nao importa o schema), mas
    // divergencia silenciosa entre as duas seria o mesmo defeito de novo.
    expect([...INGESTION_STRATEGIES].sort()).toEqual([...DISCOVER_STRATEGIES].sort())
  })

  it('o planejavel e SUBCONJUNTO PROPRIO do que a ingestao aceita', () => {
    for (const s of PLANNABLE_STRATEGIES) {
      expect(INGESTION_STRATEGIES, `${s} deveria ser aceita pela ingestao`).toContain(s)
    }
    expect(PLANNABLE_STRATEGIES.length).toBeLessThan(INGESTION_STRATEGIES.length)
  })
})

describe('caminho que LE — plan-bootstrap', () => {
  it('aceita toda estrategia planejavel', () => {
    for (const s of PLANNABLE_STRATEGIES) {
      expect(assertPlannableStrategy(s)).toBe(s)
    }
  })

  it('RECUSA daily-exports — o caso que virava `popular` em silencio', () => {
    let caught: unknown = null
    try {
      assertPlannableStrategy('daily-exports')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UnsupportedStrategyError)
    // A mensagem tem de dizer o que fazer, nao so que deu errado.
    expect((caught as Error).message).toMatch(/popular/)
  })

  it('recusa lixo, e distingue do caso "valida na ingestao"', () => {
    for (const s of LIXO) {
      expect(() => assertPlannableStrategy(s), `"${s}" deveria ser recusada`).toThrow(
        UnsupportedStrategyError,
      )
    }
    // `trending` existe na ingestao mas nao e planejavel: mensagem diferente.
    let known: unknown = null
    try {
      assertPlannableStrategy('trending')
    } catch (e) {
      known = e
    }
    expect((known as Error).message).toMatch(/valida na INGESTAO/)
  })

  it('nenhuma estrategia da ingestao passa por acidente', () => {
    for (const s of INGESTION_STRATEGIES) {
      const planejavel = isPlannableStrategy(s)
      if (planejavel) expect(() => assertPlannableStrategy(s)).not.toThrow()
      else expect(() => assertPlannableStrategy(s)).toThrow(UnsupportedStrategyError)
    }
  })
})

describe('caminho que ESCREVE — catalog bootstrap', () => {
  it('aceita daily-exports (e por isso o comando de recuperacao e valido)', () => {
    const input = validateBootstrapInput({ strategy: 'daily-exports', entityTypes: ['movie'] })
    expect(input.strategy).toBe('daily-exports')
  })

  it('LANCA em estrategia desconhecida — nunca cai num default silencioso', () => {
    for (const s of LIXO.filter((v) => v.trim() !== '')) {
      expect(
        () => validateBootstrapInput({ strategy: s, entityTypes: ['movie'] }),
        `bootstrap deveria recusar "${s}"`,
      ).toThrow()
    }
  })

  it('discover_ids tambem lanca em estrategia desconhecida', () => {
    for (const s of LIXO.filter((v) => v.trim() !== '')) {
      expect(
        () => validateDiscoverIdsInput({ strategy: s, entityType: 'movie' }),
        `discover_ids deveria recusar "${s}"`,
      ).toThrow()
    }
  })

  it('estrategia AUSENTE cai no default declarado, nao em lixo', () => {
    // Omitir e diferente de passar valor errado: o default e uma decisao.
    expect(validateBootstrapInput({ entityTypes: ['movie'] }).strategy).toBe('daily-exports')
    expect(validateDiscoverIdsInput({ entityType: 'movie' }).strategy).toBe('daily-exports')
  })
})
