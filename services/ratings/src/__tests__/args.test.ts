/**
 * args.test.ts — Parser fail-loud dos argumentos do CLI de ratings.
 *
 * Foco: nenhum fallback silencioso. Sob `--apply` o parser exige `--type`
 * porque, sem ele, uma nota poderia ser atribuida ao tipo de entidade errado
 * (movie vs tv) — pior que nao gravar (invariante 2 no espirito).
 */

import { describe, it, expect } from 'vitest'

import { parseFilmShowRatingsArgs } from '../film-show-ratings/args.js'

describe('parseFilmShowRatingsArgs', () => {
  it('aceita --type=film (forma com =) e --type film (forma com espaco)', () => {
    const withEq = parseFilmShowRatingsArgs(['--type=film'])
    expect(withEq.ok).toBe(true)
    if (!withEq.ok) throw new Error(withEq.error)
    expect(withEq.args.type).toBe('film')

    const withSpace = parseFilmShowRatingsArgs(['--type', 'show'])
    expect(withSpace.ok).toBe(true)
    if (!withSpace.ok) throw new Error(withSpace.error)
    expect(withSpace.args.type).toBe('show')
  })

  it('--type invalido falha com mensagem clara', () => {
    const result = parseFilmShowRatingsArgs(['--type=bogus'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.error).toMatch(/--type/)
  })

  it('--limit aceita inteiro positivo', () => {
    const result = parseFilmShowRatingsArgs(['--limit=3'])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.args.limit).toBe(3)
  })

  it.each(['0', '-1', 'abc', '1.5'])('--limit=%s (nao inteiro positivo) falha', (value) => {
    const result = parseFilmShowRatingsArgs([`--limit=${value}`])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    // A mensagem cita a flag e a exigencia de inteiro > 0.
    expect(result.error).toMatch(/limit/)
    expect(result.error).toMatch(/inteiro/)
  })

  it('flag desconhecida falha', () => {
    const result = parseFilmShowRatingsArgs(['--bogus'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.error).toMatch(/desconhecida/)
  })

  it('flag booleana com valor falha (--apply=1)', () => {
    const result = parseFilmShowRatingsArgs(['--apply=1'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.error).toMatch(/booleana/)
  })

  it('flag de valor sem valor falha (--type sozinho no fim)', () => {
    const result = parseFilmShowRatingsArgs(['--type'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.error).toMatch(/valor/)
  })

  it('--apply SEM --type falha e a mensagem cita --type', () => {
    const result = parseFilmShowRatingsArgs(['--apply'])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperava falha')
    expect(result.error).toMatch(/--type/)
  })

  it('--apply --type=film tem sucesso', () => {
    const result = parseFilmShowRatingsArgs(['--apply', '--type=film'])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.args.apply).toBe(true)
    expect(result.args.type).toBe('film')
  })

  it('default (so --type) tem apply=false e sample=false', () => {
    const result = parseFilmShowRatingsArgs(['--type=film'])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.args.apply).toBe(false)
    expect(result.args.sample).toBe(false)
    expect(result.args.limit).toBeNull()
    expect(result.args.report).toBeNull()
  })

  it('--dry-run e aceito e e no-op (nao liga apply nem sample)', () => {
    const result = parseFilmShowRatingsArgs(['--type=film', '--dry-run'])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.args.apply).toBe(false)
    expect(result.args.sample).toBe(false)

    // Sozinho tambem e aceito (apply=false -> nao dispara o guard de --type).
    const alone = parseFilmShowRatingsArgs(['--dry-run'])
    expect(alone.ok).toBe(true)
    if (!alone.ok) throw new Error(alone.error)
    expect(alone.args.apply).toBe(false)
  })

  it('--sample liga sample sem exigir --type', () => {
    const result = parseFilmShowRatingsArgs(['--sample'])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.args.sample).toBe(true)
    expect(result.args.apply).toBe(false)
  })
})
