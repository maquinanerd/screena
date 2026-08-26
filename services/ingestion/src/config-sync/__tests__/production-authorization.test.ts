/**
 * production-authorization.test.ts — O escape hatch de taxonomia em producao.
 *
 * CONTEXTO (25/08/2026, producao): `genres` estava com ZERO linhas e a FK de
 * `movie_genres`/`tv_show_genres` derrubava a transacao inteira do upsert de
 * titulo. 8.366 jobs em `retry_wait`, e `/pt/series/` listando so titulo
 * obscuro — os unicos SEM genero, os unicos que passavam na FK.
 *
 * O dicionario nao tinha portador nenhum que chegasse em producao: o unico
 * comando que o popula abortava em ambiente production-like SEM escape hatch.
 *
 * Trava as DUAS pontas do gate, porque afrouxar demais e tao defeito quanto
 * travar demais:
 *  - fail-closed: producao sem a env var (ou com valor nao afirmativo) RECUSA;
 *  - escopo ESTREITO: a autorizacao cobre so dicionario/taxonomia. `lists`,
 *    `discover` e `trending` (catalogo em massa) continuam recusados MESMO com
 *    a env var ligada — senao o conserto de 35 linhas de taxonomia teria aberto
 *    uma porta larga de escrita em producao.
 */

import { describe, expect, it } from 'vitest'

import {
  DICTIONARY_SUBCOMMANDS,
  TAXONOMY_PRODUCTION_CONFIRMED_ENV,
  authorizeTaxonomyWrite,
} from '../production-authorization.js'

const PROD = { NODE_ENV: 'production' } as const
const BULK_SUBCOMMANDS = ['media', 'lists', 'discover', 'trending'] as const

describe('authorizeTaxonomyWrite — fora de producao nao ha o que autorizar', () => {
  it('sem NODE_ENV/VERCEL_ENV de producao, qualquer subcomando passa', () => {
    for (const sub of [...DICTIONARY_SUBCOMMANDS, ...BULK_SUBCOMMANDS]) {
      expect(authorizeTaxonomyWrite(sub, {})).toEqual({ allowed: true, reason: 'not-production' })
    }
  })

  it('`VERCEL_ENV=production` conta como producao tanto quanto `NODE_ENV`', () => {
    const result = authorizeTaxonomyWrite('genres', { VERCEL_ENV: 'production' })
    expect(result.allowed).toBe(false)
  })
})

describe('authorizeTaxonomyWrite — fail-closed em producao', () => {
  it('dicionario SEM a env var e recusado, e a mensagem nomeia a variavel', () => {
    const result = authorizeTaxonomyWrite('genres', PROD)

    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('inalcancavel')
    expect(result.reason).toBe('unauthorized')
    // Sem o nome da variavel na mensagem, o operador sabe que foi barrado e nao
    // sabe o que fazer — que e o estado em que este comando ja estava.
    expect(result.message).toContain(TAXONOMY_PRODUCTION_CONFIRMED_ENV)
  })

  it.each([undefined, '', ' ', 'false', '0', 'no', 'sim', 'talvez'])(
    'valor nao afirmativo (%o) NAO autoriza',
    (value) => {
      const env = { ...PROD, [TAXONOMY_PRODUCTION_CONFIRMED_ENV]: value }
      expect(authorizeTaxonomyWrite('genres', env).allowed).toBe(false)
    },
  )

  it.each(['true', 'TRUE', ' true ', '1', 'yes', 'on'])(
    'valor afirmativo (%o) autoriza dicionario',
    (value) => {
      const env = { ...PROD, [TAXONOMY_PRODUCTION_CONFIRMED_ENV]: value }
      expect(authorizeTaxonomyWrite('genres', env)).toEqual({ allowed: true, reason: 'authorized' })
    },
  )

  it('os TRES subcomandos de dicionario sao liberaveis', () => {
    for (const sub of DICTIONARY_SUBCOMMANDS) {
      const env = { ...PROD, [TAXONOMY_PRODUCTION_CONFIRMED_ENV]: 'true' }
      expect(authorizeTaxonomyWrite(sub, env)).toEqual({ allowed: true, reason: 'authorized' })
    }
  })
})

describe('authorizeTaxonomyWrite — o escape hatch NAO cobre catalogo em massa', () => {
  it.each(BULK_SUBCOMMANDS)(
    '`%s` continua recusado em producao MESMO com a env var ligada',
    (sub) => {
      const env = { ...PROD, [TAXONOMY_PRODUCTION_CONFIRMED_ENV]: 'true' }
      const result = authorizeTaxonomyWrite(sub, env)

      expect(result.allowed).toBe(false)
      if (result.allowed) throw new Error('inalcancavel')
      // Desfecho DISTINTO do de falta de autorizacao: aqui nao ha env var que
      // resolva, e a mensagem precisa dizer isso em vez de sugerir uma.
      expect(result.reason).toBe('not-a-dictionary-subcommand')
      expect(result.message).toContain(sub)
    },
  )
})
