/**
 * args.test.ts — O parser e fail-loud e nao tem default perigoso.
 *
 * O teste mais importante do arquivo e o ULTIMO: nenhuma flag pula o gate de
 * licenca. Ele varre a superficie aceita procurando por uma porta dos fundos —
 * e falha se alguem acrescentar uma.
 */

import { describe, expect, it } from 'vitest'

import { parsePromoteMediaArgs, resolveTargets } from '../args.js'
import { PROMOTION_TARGETS } from '../types.js'

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

/**
 * ATUALIZADO em 2026-08-28. Havia aqui um teste afirmando que "--target=all nao
 * existe: um comando, um alvo por execucao". O argumento original era correto
 * (dois alvos fundidos num censo so tornariam o freio sem sentido), mas a
 * conclusao virou obstaculo: promover o acervo inteiro exigia decorar a lista de
 * alvos e rodar o comando uma vez por alvo — o operador virava o laco `for`.
 *
 * `--target=all` NAO funde os censos: ele executa a promocao inteira alvo por
 * alvo, cada um com denominador e freio proprios. O teste passou a afirmar isso.
 */
describe('--target e obrigatorio; "all" existe mas tem de ser pedido', () => {
  it('sem --target: erro (nao ha default, e omitir nunca significa "tudo")', () => {
    expect(err([])).toContain('--target e obrigatorio')
  })
  it.each(['video', 'person-photo', 'all'])('--target=%s e valido', (t) => {
    expect(ok([`--target=${t}`]).target).toBe(t)
  })
  it('--target invalido continua sendo erro explicito', () => {
    expect(err(['--target=tudo'])).toContain('--target invalido')
  })
  it('resolveTargets expande "all" nos alvos declarados, e so neles', () => {
    expect(resolveTargets('all')).toEqual([...PROMOTION_TARGETS])
    expect(resolveTargets('video')).toEqual(['video'])
    expect(resolveTargets('person-photo')).toEqual(['person-photo'])
  })
  it('--entity-type nao se combina com --target=all', () => {
    // Com dois alvos, a mesma string seria valida num e invalida no outro.
    // Escolher em silencio a leitura mais permissiva e como um filtro vira nada.
    expect(err(['--target=all', '--entity-type=movie'])).toContain('nao se combina')
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
