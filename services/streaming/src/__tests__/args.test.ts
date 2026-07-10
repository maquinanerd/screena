/**
 * args.test.ts — Parser fail-loud do CLI de disponibilidade.
 *
 * Trava: `--kind` obrigatorio e restrito a movie|tv (nunca person/season);
 * `--country` default BR + uppercased + so alpha-2; `--tmdb-id`/`--imdb-id`
 * mutuamente exclusivos; formas `--flag=v` e `--flag v`; flag desconhecida falha.
 */

import { describe, expect, it } from 'vitest'
import { STREAMING_AVAILABILITY_DEFAULT_COUNTRY } from '@screena/streaming-availability-client'

import { parseStreamingArgs } from '../streaming-availability/args.js'

/** Helper: parse e exige sucesso, devolvendo os args. */
function parseOk(argv: readonly string[]) {
  const result = parseStreamingArgs(argv)
  if (!result.ok) throw new Error(`esperava sucesso, veio erro: ${result.error}`)
  return result.args
}

/** Helper: parse e exige falha, devolvendo a mensagem. */
function parseErr(argv: readonly string[]): string {
  const result = parseStreamingArgs(argv)
  if (result.ok) throw new Error('esperava erro, veio sucesso')
  return result.error
}

describe('parseStreamingArgs — --kind obrigatorio e restrito', () => {
  it('sem --kind falha explicitamente', () => {
    const error = parseErr([])
    expect(error).toMatch(/--kind/)
  })

  it('--kind=movie e --kind=tv sao aceitos', () => {
    expect(parseOk(['--kind=movie']).kind).toBe('movie')
    expect(parseOk(['--kind=tv']).kind).toBe('tv')
  })

  it('--kind=person falha (esta fase nunca consulta pessoas)', () => {
    expect(parseErr(['--kind=person'])).toMatch(/--kind/)
  })

  it('--kind=season falha (esta fase nunca consulta temporadas)', () => {
    expect(parseErr(['--kind=season'])).toMatch(/--kind/)
  })
})

describe('parseStreamingArgs — --country', () => {
  it('default e BR', () => {
    expect(parseOk(['--kind=movie']).country).toBe('BR')
    expect(parseOk(['--kind=movie']).country).toBe(STREAMING_AVAILABILITY_DEFAULT_COUNTRY)
  })

  it('minusculo e normalizado para maiusculo (br -> BR)', () => {
    expect(parseOk(['--kind=movie', '--country=br']).country).toBe('BR')
    expect(parseOk(['--kind=movie', '--country=us']).country).toBe('US')
  })

  it('pais de 3 letras falha', () => {
    expect(parseErr(['--kind=movie', '--country=bra'])).toMatch(/--country/)
  })

  it('pais de 1 letra falha', () => {
    expect(parseErr(['--kind=movie', '--country=b'])).toMatch(/--country/)
  })
})

describe('parseStreamingArgs — ids explicitos', () => {
  it('--tmdb-id aceita inteiro positivo', () => {
    expect(parseOk(['--kind=movie', '--tmdb-id=278']).tmdbId).toBe(278)
  })

  it('--tmdb-id nao inteiro / <= 0 falha', () => {
    expect(parseErr(['--kind=movie', '--tmdb-id=0'])).toMatch(/--tmdb-id/)
    expect(parseErr(['--kind=movie', '--tmdb-id=-3'])).toMatch(/--tmdb-id/)
    expect(parseErr(['--kind=movie', '--tmdb-id=abc'])).toMatch(/--tmdb-id/)
  })

  it('--imdb-id exige o formato tt\\d+', () => {
    expect(parseOk(['--kind=movie', '--imdb-id=tt0111161']).imdbId).toBe('tt0111161')
    expect(parseErr(['--kind=movie', '--imdb-id=tt'])).toMatch(/--imdb-id/)
    expect(parseErr(['--kind=movie', '--imdb-id=0111161'])).toMatch(/--imdb-id/)
  })

  it('--tmdb-id e --imdb-id sao mutuamente exclusivos', () => {
    const error = parseErr(['--kind=movie', '--tmdb-id=278', '--imdb-id=tt0111161'])
    expect(error).toMatch(/mutuamente exclusiv/)
  })

  it('so um dos dois e permitido isoladamente', () => {
    expect(parseOk(['--kind=movie', '--tmdb-id=278']).imdbId).toBeNull()
    expect(parseOk(['--kind=movie', '--imdb-id=tt0111161']).tmdbId).toBeNull()
  })
})

describe('parseStreamingArgs — formas de flag e defaults', () => {
  it('aceita tanto --flag=valor quanto --flag valor', () => {
    expect(parseOk(['--kind=movie']).kind).toBe('movie')
    expect(parseOk(['--kind', 'movie']).kind).toBe('movie')
    expect(parseOk(['--kind', 'movie', '--tmdb-id', '278']).tmdbId).toBe(278)
    expect(parseOk(['--kind', 'movie', '--country', 'br']).country).toBe('BR')
  })

  it('flag desconhecida falha', () => {
    expect(parseErr(['--kind=movie', '--bogus'])).toMatch(/desconhecida/)
    expect(parseErr(['--kind=movie', '--bogus=1'])).toMatch(/desconhecida/)
  })

  it('argumento posicional (sem --) falha', () => {
    expect(parseErr(['movie'])).toMatch(/inesperado/)
  })

  it('defaults: apply=false, sample=false', () => {
    const args = parseOk(['--kind=movie'])
    expect(args.apply).toBe(false)
    expect(args.sample).toBe(false)
  })

  it('--apply e --sample sao booleanas (setam true; valor explicito falha)', () => {
    expect(parseOk(['--kind=movie', '--apply']).apply).toBe(true)
    expect(parseOk(['--kind=movie', '--sample']).sample).toBe(true)
    expect(parseErr(['--kind=movie', '--apply=1'])).toMatch(/booleana/)
  })
})
