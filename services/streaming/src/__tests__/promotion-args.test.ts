/**
 * promotion-args.test.ts — Parsers fail-loud dos CLIs de revisao e promocao.
 *
 * Trava: `--kind` restrito a movie|tv; `--country` default BR + uppercased; a
 * PROMOCAO exige `--ids` explicito (selecao explicita), deduplica e valida cada
 * id; `--confirm`/`--revoke` sao booleanas; flag desconhecida falha.
 */

import { describe, expect, it } from 'vitest'

import { parsePromoteArgs, parseReviewArgs, REVIEW_DEFAULT_LIMIT } from '../promotion/args.js'

function reviewOk(argv: readonly string[]) {
  const result = parseReviewArgs(argv)
  if (!result.ok) throw new Error(`esperava sucesso, veio erro: ${result.error}`)
  return result.args
}
function reviewErr(argv: readonly string[]): string {
  const result = parseReviewArgs(argv)
  if (result.ok) throw new Error('esperava erro, veio sucesso')
  return result.error
}
function promoteOk(argv: readonly string[]) {
  const result = parsePromoteArgs(argv)
  if (!result.ok) throw new Error(`esperava sucesso, veio erro: ${result.error}`)
  return result.args
}
function promoteErr(argv: readonly string[]): string {
  const result = parsePromoteArgs(argv)
  if (result.ok) throw new Error('esperava erro, veio sucesso')
  return result.error
}

describe('parseReviewArgs', () => {
  it('sem flags: kind=null, country=BR, limit default, report=false, json=false', () => {
    const args = reviewOk([])
    expect(args.kind).toBeNull()
    expect(args.country).toBe('BR')
    expect(args.limit).toBe(REVIEW_DEFAULT_LIMIT)
    expect(args.entityId).toBeNull()
    expect(args.report).toBe(false)
    expect(args.json).toBe(false)
  })

  it('--kind so aceita movie|tv (nunca person/season)', () => {
    expect(reviewOk(['--kind=movie']).kind).toBe('movie')
    expect(reviewOk(['--kind=tv']).kind).toBe('tv')
    expect(reviewErr(['--kind=person'])).toMatch(/--kind/)
  })

  it('--country e uppercased e validado como alpha-2', () => {
    expect(reviewOk(['--country=br']).country).toBe('BR')
    expect(reviewErr(['--country=bra'])).toMatch(/--country/)
  })

  it('--entity-id e --limit exigem inteiro > 0', () => {
    expect(reviewOk(['--entity-id=5']).entityId).toBe(5)
    expect(reviewOk(['--limit=20']).limit).toBe(20)
    expect(reviewErr(['--entity-id=0'])).toMatch(/--entity-id/)
    expect(reviewErr(['--limit=-3'])).toMatch(/--limit/)
    expect(reviewErr(['--limit=1.5'])).toMatch(/--limit/)
  })

  it('--report e booleana; valor explicito falha', () => {
    expect(reviewOk(['--report']).report).toBe(true)
    expect(reviewErr(['--report=1'])).toMatch(/booleana/)
  })

  it('--json e booleana e independente de --report', () => {
    expect(reviewOk(['--json']).json).toBe(true)
    expect(reviewOk(['--json']).report).toBe(false)
    const both = reviewOk(['--json', '--report'])
    expect(both.json).toBe(true)
    expect(both.report).toBe(true)
    expect(reviewErr(['--json=1'])).toMatch(/booleana/)
  })

  it('flag desconhecida e posicional solto falham', () => {
    expect(reviewErr(['--bogus'])).toMatch(/desconhecida/)
    expect(reviewErr(['movie'])).toMatch(/inesperado/)
  })
})

describe('parsePromoteArgs — --ids obrigatorio (selecao explicita)', () => {
  it('sem --ids falha explicitamente', () => {
    expect(promoteErr([])).toMatch(/--ids/)
    expect(promoteErr(['--confirm'])).toMatch(/--ids/)
    expect(promoteErr(['--country=BR', '--confirm'])).toMatch(/--ids/)
  })

  it('--ids aceita lista de inteiros > 0 e deduplica preservando ordem', () => {
    expect(promoteOk(['--ids=1,2,3']).ids).toEqual([1, 2, 3])
    expect(promoteOk(['--ids=3,3,1,1,2']).ids).toEqual([3, 1, 2])
    expect(promoteOk(['--ids= 4 , 5 ']).ids).toEqual([4, 5])
  })

  it('--ids com valor invalido / vazio falha', () => {
    expect(promoteErr(['--ids=1,x,3'])).toMatch(/--ids/)
    expect(promoteErr(['--ids=0,1'])).toMatch(/--ids/)
    expect(promoteErr(['--ids=-2'])).toMatch(/--ids/)
    expect(promoteErr(['--ids=,,'])).toMatch(/--ids/)
  })
})

describe('parsePromoteArgs — flags de acao', () => {
  it('defaults: confirm=false (dry-run), revoke=false, report=false', () => {
    const args = promoteOk(['--ids=1'])
    expect(args.confirm).toBe(false)
    expect(args.revoke).toBe(false)
    expect(args.report).toBe(false)
    expect(args.country).toBe('BR')
  })

  it('--confirm, --revoke e --report sao booleanas', () => {
    const args = promoteOk(['--ids=1', '--confirm', '--revoke', '--report'])
    expect(args.confirm).toBe(true)
    expect(args.revoke).toBe(true)
    expect(args.report).toBe(true)
    expect(promoteErr(['--ids=1', '--confirm=1'])).toMatch(/booleana/)
  })

  it('--country e uppercased/validado; flag desconhecida falha', () => {
    expect(promoteOk(['--ids=1', '--country=br']).country).toBe('BR')
    expect(promoteErr(['--ids=1', '--country=bra'])).toMatch(/--country/)
    expect(promoteErr(['--ids=1', '--bogus'])).toMatch(/desconhecida/)
  })
})

describe('parsePromoteArgs — --reviewer obrigatorio para promover', () => {
  it('promover com --confirm SEM --reviewer falha explicitamente', () => {
    expect(promoteErr(['--ids=1', '--confirm'])).toMatch(/--reviewer/)
  })

  it('promover com --confirm e --reviewer captura a identidade humana', () => {
    expect(promoteOk(['--ids=1', '--confirm', '--reviewer=ana@screen']).reviewer).toBe('ana@screen')
  })

  it('revoke com --confirm NAO exige --reviewer', () => {
    const args = promoteOk(['--ids=1', '--confirm', '--revoke'])
    expect(args.confirm).toBe(true)
    expect(args.revoke).toBe(true)
    expect(args.reviewer).toBeNull()
  })

  it('dry-run nao exige --reviewer', () => {
    expect(promoteOk(['--ids=1']).reviewer).toBeNull()
  })
})
