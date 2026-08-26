/**
 * args.test.ts — O parser e fail-loud e nao tem default perigoso.
 *
 * O teste mais importante do arquivo e o ULTIMO: nenhuma flag pula o gate de
 * licenca. Ele varre a superficie aceita procurando por uma porta dos fundos —
 * e falha se alguem acrescentar uma.
 */

import { describe, expect, it } from 'vitest'

import { parsePromoteMediaArgs } from '../args.js'

function ok(argv: string[]) {
  const parsed = parsePromoteMediaArgs(argv)
  if (!parsed.ok) throw new Error(`esperava sucesso, veio: ${parsed.error}`)
  return parsed.args
}
function err(argv: string[]): string {
  const parsed = parsePromoteMediaArgs(argv)
  if (parsed.ok) throw new Error('esperava erro, veio sucesso')
  return parsed.error
}

describe('--target e obrigatorio e nao tem "todos"', () => {
  it('sem --target: erro', () => {
    expect(err([])).toContain('--target e obrigatorio')
  })
  it('--target=all nao existe: um comando, um alvo por execucao', () => {
    expect(err(['--target=all'])).toContain('--target invalido')
  })
  it.each(['video', 'person-photo'])('--target=%s e valido', (t) => {
    expect(ok([`--target=${t}`]).target).toBe(t)
  })
})

describe('defaults seguros', () => {
  it('sem --confirm e dry-run; sem --confirm-mass-change o freio esta armado', () => {
    const args = ok(['--target=video'])
    expect(args.confirm).toBe(false)
    expect(args.confirmMassChange).toBe(false)
    expect(args.revoke).toBe(false)
  })
  it('--only-official e OPT-IN (decisao do dono: official nao filtra por padrao)', () => {
    expect(ok(['--target=video']).onlyOfficial).toBe(false)
    expect(ok(['--target=video', '--only-official']).onlyOfficial).toBe(true)
  })
  it('--reviewer e obrigatorio para mutar', () => {
    expect(err(['--target=video', '--confirm'])).toContain('--reviewer e obrigatorio')
    expect(ok(['--target=video', '--confirm', '--reviewer=Pablo']).reviewer).toBe('Pablo')
  })
  it('reversao TAMBEM exige revisor — "quem apagou" e tao operacional quanto "quem acendeu"', () => {
    expect(err(['--target=video', '--revoke', '--confirm'])).toContain('--reviewer e obrigatorio')
  })
})

describe('fail-loud', () => {
  it('flag desconhecida e erro, nunca ignorada em silencio', () => {
    expect(err(['--target=video', '--yolo'])).toContain('flag desconhecida')
  })
  it('posicional solto e erro', () => {
    expect(err(['--target=video', 'video'])).toContain('argumento inesperado')
  })
  it('booleana com valor e erro', () => {
    expect(err(['--target=video', '--confirm=true'])).toContain('booleana')
  })
  it('flag de valor sem valor e erro', () => {
    expect(err(['--target=video', '--limit'])).toContain('exige um valor')
  })
  it.each(['0', '-1', '1.5', '01', 'abc'])('--limit invalido "%s"', (v) => {
    expect(err(['--target=video', `--limit=${v}`])).toContain('--limit invalido')
  })
  it('--max-changes ACEITA zero (modo "nada passa sem assinatura")', () => {
    expect(ok(['--target=video', '--max-changes=0']).maxChanges).toBe(0)
  })
  it.each(['-1', '101', 'abc'])('--max-change-percent invalido "%s"', (v) => {
    expect(err(['--target=video', `--max-change-percent=${v}`])).toContain('--max-change-percent invalido')
  })
  it('--max-change-percent aceita decimal', () => {
    expect(ok(['--target=video', '--max-change-percent=12.5']).maxChangePercent).toBe(12.5)
  })
})

describe('escopo coerente com o alvo', () => {
  it('--entity-type=person nao existe no alvo video', () => {
    expect(err(['--target=video', '--entity-type=person'])).toContain('nao existe no alvo')
  })
  it('--entity-type=movie nao existe no alvo person-photo', () => {
    expect(err(['--target=person-photo', '--entity-type=movie'])).toContain('nao existe no alvo')
  })
  it.each(['movie', 'tv'])('--entity-type=%s vale em video', (t) => {
    expect(ok(['--target=video', `--entity-type=${t}`]).entityType).toBe(t)
  })
})

describe('a forma `--flag valor` funciona igual a `--flag=valor`', () => {
  it('separado por espaco', () => {
    expect(ok(['--target', 'video', '--tmdb-id', '550']).tmdbId).toBe(550)
  })
})

/**
 * O teste que protege o desenho, nao o codigo.
 *
 * Se alguem acrescentar `--skip-license`, `--license-ok`, `--no-license` ou
 * qualquer variante, este teste falha. Ele nao le a lista de flags do modulo de
 * proposito: le o comportamento OBSERVAVEL do parser, tentando cada nome
 * plausivel — assim ele pega tambem a flag que existir com nome diferente do
 * que a lista interna chama.
 */
describe('NENHUMA flag pula o gate de licenca', () => {
  const portas = [
    '--skip-license',
    '--no-license',
    '--license-ok',
    '--ignore-license',
    '--bypass-license',
    '--force-license',
    '--unsafe',
  ]
  it.each(portas)('"%s" e recusada como flag desconhecida', (flag) => {
    expect(err(['--target=video', flag])).toContain('flag desconhecida')
  })

  it('CONTROLE POSITIVO: uma flag que EXISTE de verdade nao cai nesse erro', () => {
    // Sem isto, o bloco acima passaria mesmo que o parser recusasse tudo.
    expect(ok(['--target=video', '--confirm-mass-change']).confirmMassChange).toBe(true)
  })
})
