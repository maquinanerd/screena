/**
 * cli-args.test.ts — O que a CLI `pnpm ratings` aceita e recusa.
 *
 * O tema central: escrita e dry-run por DEFAULT. Um operador que erra a flag ve
 * um relatorio, nunca uma mutacao.
 */

import { describe, expect, it } from 'vitest'

import { MAX_BULK_IDS, MAX_LIMIT, parseRatingsArgs } from '../cli/args.js'
import { EXIT_CODES } from '../cli/exit.js'
import { renderRatingsHelp } from '../cli/help.js'

const parse = (line: string) => parseRatingsArgs(line.split(' ').filter((t) => t !== ''))

describe('CLI ratings — ajuda', () => {
  it.each(['', 'help', '--help', '-h'])('"%s" => help', (line) => {
    const result = parse(line)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('esperado ok')
    expect(result.args.command).toBe('help')
  })

  it('a ajuda documenta o comando canonico da missao', () => {
    expect(renderRatingsHelp()).toContain('sample --source imdb --entity movie --limit 20 --dry-run')
  })

  it('comando desconhecido e erro de uso', () => {
    const result = parse('destruir --tudo')
    expect(result.ok).toBe(false)
  })
})

describe('CLI ratings — sample', () => {
  it('faz o parse do comando canonico da missao', () => {
    const result = parse('sample --source imdb --entity movie --limit 20 --dry-run')
    expect(result.ok).toBe(true)
    if (!result.ok || result.args.command !== 'sample') throw new Error('esperado sample')
    expect(result.args.source).toBe('imdb')
    expect(result.args.entity).toBe('movie')
    expect(result.args.limit).toBe(20)
    expect(result.args.dryRun).toBe(true)
  })

  it('sample RECUSA --apply em vez de ignorar em silencio', () => {
    // Quem digita `sample --apply` acha que vai gravar. Ignorar seria mentir por
    // omissao; recusar ensina o comando certo.
    const result = parse('sample --source imdb --apply')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperado erro')
    expect(result.error).toMatch(/sample nunca escreve/)
  })

  it('RECUSA fonte fora de RATING_SOURCES', () => {
    expect(parse('sample --source imdb236').ok).toBe(false)
  })

  it('RECUSA --id que nao e IMDb id', () => {
    expect(parse('sample --id 12345').ok).toBe(false)
    expect(parse('sample --id tt0111161').ok).toBe(true)
  })

  it('aceita --chave=valor e --chave valor', () => {
    const a = parse('sample --limit=5')
    const b = parse('sample --limit 5')
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok || a.args.command !== 'sample' || b.args.command !== 'sample') throw new Error('x')
    expect(a.args.limit).toBe(b.args.limit)
  })
})

describe('CLI ratings — sync e dry-run por default', () => {
  it('sync SEM --apply e dry-run', () => {
    const result = parse('sync --entity movie --limit 20')
    expect(result.ok).toBe(true)
    if (!result.ok || result.args.command !== 'sync') throw new Error('esperado sync')
    expect(result.args.apply).toBe(false)
  })

  it('sync COM --apply grava', () => {
    const result = parse('sync --apply')
    if (!result.ok || result.args.command !== 'sync') throw new Error('esperado sync')
    expect(result.args.apply).toBe(true)
  })
})

describe('CLI ratings — limites', () => {
  it.each(['0', '-1', 'abc', '1.5'])('--limit "%s" e invalido', (limit) => {
    expect(parse(`review --limit ${limit}`).ok).toBe(false)
  })

  it(`--limit acima do teto (${MAX_LIMIT}) e recusado`, () => {
    expect(parse(`review --limit ${MAX_LIMIT + 1}`).ok).toBe(false)
    expect(parse(`review --limit ${MAX_LIMIT}`).ok).toBe(true)
  })
})

describe('CLI ratings — promote exige revisor humano', () => {
  it('promote SEM --confirm e dry-run e NAO exige revisor', () => {
    // Um dry-run sem revisor ainda e util: mostra o que aconteceria.
    const result = parse('promote --ids=1,2')
    expect(result.ok).toBe(true)
    if (!result.ok || result.args.command !== 'promote') throw new Error('esperado promote')
    expect(result.args.confirm).toBe(false)
    expect(result.args.reviewer).toBeNull()
  })

  it('promote --confirm SEM --reviewer e recusado', () => {
    // "quem aprovou isso?" precisa ter resposta seis meses depois.
    const result = parse('promote --ids=1 --confirm')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperado erro')
    expect(result.error).toMatch(/--reviewer/)
  })

  it('promote --confirm com --reviewer vazio e recusado', () => {
    expect(parseRatingsArgs(['promote', '--ids=1', '--confirm', '--reviewer=   ']).ok).toBe(false)
  })

  it('promote --confirm --reviewer executa', () => {
    const result = parse('promote --ids=1,2 --confirm --reviewer=ana@cinerie')
    if (!result.ok || result.args.command !== 'promote') throw new Error('esperado promote')
    expect(result.args.confirm).toBe(true)
    expect(result.args.reviewer).toBe('ana@cinerie')
    expect(result.args.ids).toEqual(['1', '2'])
  })
})

describe('CLI ratings — ids', () => {
  it('--ids e obrigatorio em promote/revoke (nunca "todos")', () => {
    // Sem --ids obrigatorio, um `promote` sem argumento poderia significar
    // "promova tudo" — o oposto de revisao.
    expect(parse('promote').ok).toBe(false)
    expect(parse('revoke').ok).toBe(false)
  })

  it('RECUSA id nao numerico', () => {
    expect(parse('promote --ids=1,abc').ok).toBe(false)
  })

  it('RECUSA duplicatas', () => {
    expect(parse('promote --ids=1,1').ok).toBe(false)
  })

  it(`RECUSA lote acima de ${MAX_BULK_IDS} (promocao e revisao, nao carimbo)`, () => {
    const many = Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => i + 1).join(',')
    const result = parse(`promote --ids=${many}`)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('esperado erro')
    expect(result.error).toMatch(/teto de lote/)
  })

  it(`aceita exatamente ${MAX_BULK_IDS}`, () => {
    const many = Array.from({ length: MAX_BULK_IDS }, (_, i) => i + 1).join(',')
    expect(parse(`promote --ids=${many}`).ok).toBe(true)
  })
})

describe('CLI ratings — revoke', () => {
  it('revoke SEM --confirm e dry-run', () => {
    const result = parse('revoke --ids=1')
    if (!result.ok || result.args.command !== 'revoke') throw new Error('esperado revoke')
    expect(result.args.confirm).toBe(false)
  })
})

describe('CLI ratings — exit codes', () => {
  it('governanca tem codigo PROPRIO (nao e o erro generico)', () => {
    // Um runbook precisa distinguir "a trava barrou" de "quebrou".
    expect(EXIT_CODES.governance).not.toBe(EXIT_CODES.unexpected)
    expect(EXIT_CODES.ok).toBe(0)
  })
})
