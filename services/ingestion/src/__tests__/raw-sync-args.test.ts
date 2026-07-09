/**
 * Testes do parser de argumentos do CLI (P0-00d): aceita `--flag=valor` E
 * `--flag valor`; FAIL-LOUD em valor ausente / flag desconhecida / valor
 * invalido — NUNCA fallback silencioso (footgun achada no smoke). Sem IO.
 */

import { describe, expect, it } from 'vitest'
import { parseRawSyncArgs, type RawSyncArgs } from '../raw-sync/args.js'

/** Helper: espera sucesso e devolve os args. */
function ok(argv: string[]): RawSyncArgs {
  const result = parseRawSyncArgs(argv)
  if (!result.ok) throw new Error(`esperava ok, veio erro: ${result.error}`)
  return result.args
}

/** Helper: espera falha e devolve a mensagem. */
function err(argv: string[]): string {
  const result = parseRawSyncArgs(argv)
  if (result.ok) throw new Error('esperava erro, veio ok')
  return result.error
}

describe('parseRawSyncArgs — aceita os dois formatos', () => {
  it('--queue=arquivo funciona', () => {
    expect(ok(['--queue=f.ndjson']).queue).toBe('f.ndjson')
  })

  it('--queue arquivo funciona', () => {
    expect(ok(['--queue', 'f.ndjson']).queue).toBe('f.ndjson')
  })

  it('--limit-movies=1 funciona', () => {
    expect(ok(['--limit-movies=1']).limitMovies).toBe(1)
  })

  it('--limit-movies 1 funciona', () => {
    expect(ok(['--limit-movies', '1']).limitMovies).toBe(1)
  })

  it('--report e --concurrency nos dois formatos', () => {
    expect(ok(['--report=r.md']).report).toBe('r.md')
    expect(ok(['--report', 'r.md']).report).toBe('r.md')
    expect(ok(['--concurrency=3']).concurrency).toBe(3)
    expect(ok(['--concurrency', '3']).concurrency).toBe(3)
  })

  it('--apply e boolean; combinacao completa (mistura os formatos)', () => {
    const args = ok([
      '--apply',
      '--queue',
      'fila.ndjson',
      '--limit-movies=100',
      '--limit-tv',
      '100',
      '--limit-people=100',
      '--report',
      'rel.md',
      '--concurrency=2',
    ])
    expect(args).toEqual({
      apply: true,
      queue: 'fila.ndjson',
      report: 'rel.md',
      limitMovies: 100,
      limitTv: 100,
      limitPeople: 100,
      concurrency: 2,
    } satisfies RawSyncArgs)
  })

  it('sem flags: tudo null e apply=false (defaults ficam a cargo do CLI)', () => {
    expect(ok([])).toEqual({
      apply: false,
      queue: null,
      report: null,
      limitMovies: null,
      limitTv: null,
      limitPeople: null,
      concurrency: null,
    } satisfies RawSyncArgs)
  })
})

describe('parseRawSyncArgs — FAIL-LOUD (nunca fallback silencioso)', () => {
  it('valor ausente no fim => erro (nao ignora)', () => {
    expect(err(['--queue'])).toMatch(/--queue exige um valor/)
    expect(err(['--limit-movies'])).toMatch(/--limit-movies exige um valor/)
  })

  it('valor ausente seguido de outra flag => erro (nao consome a flag)', () => {
    expect(err(['--queue', '--apply'])).toMatch(/--queue exige um valor/)
    expect(err(['--report', '--limit-tv=5'])).toMatch(/--report exige um valor/)
  })

  it('valor vazio (--flag=) => erro', () => {
    expect(err(['--queue='])).toMatch(/valor vazio/)
  })

  it('flag desconhecida => erro (nao mascara queue/limits)', () => {
    expect(err(['--bogus'])).toMatch(/flag desconhecida: --bogus/)
    expect(err(['--bogus=1'])).toMatch(/flag desconhecida: --bogus/)
    // typo comum: hifen faltando NAO pode virar no-op silencioso
    expect(err(['--limitmovies=1'])).toMatch(/flag desconhecida: --limitmovies/)
  })

  it('inteiro invalido em limite/concorrencia => erro', () => {
    expect(err(['--limit-movies=abc'])).toMatch(/inteiro positivo/)
    expect(err(['--limit-tv', '1.5'])).toMatch(/inteiro positivo/)
    expect(err(['--limit-people=-2'])).toMatch(/inteiro positivo/)
    expect(err(['--concurrency=0'])).toMatch(/inteiro positivo/)
  })

  it('argumento posicional solto => erro', () => {
    expect(err(['fila.ndjson'])).toMatch(/argumento inesperado/)
  })
})
