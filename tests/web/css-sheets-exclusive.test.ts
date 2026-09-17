/**
 * css-sheets-exclusive.test.ts — cada bloco de classe e estilizado numa folha so.
 *
 * Divisao do CSS por rota (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md`), regra R2.
 * No App Router as folhas de rota ficam no documento depois da navegacao pelo
 * cliente e nunca saem. Se o mesmo bloco fosse estilizado em duas folhas, quem
 * vence dependeria de QUAIS rotas o leitor visitou antes — um defeito que nenhum
 * teste de pagina isolada reproduz.
 *
 * Conta so o SUJEITO da regra: em `body:has(.art-hero) .site-header` o bloco
 * estilizado e `site-header`; `art-hero` e so contexto.
 */

import { describe, expect, it } from 'vitest'

import { parseCssRules, subjectBlocks } from '../../apps/web/scripts/lab/css-rules'
import { discoverAppStylesheets, GLOBAL_STYLESHEET, readAppStylesheet } from '../support/app-css'

/** `bloco: folha, folha` para cada bloco estilizado em mais de uma folha. */
function sharedBlocks(sheets: ReadonlyArray<readonly [file: string, css: string]>): string[] {
  const owners = new Map<string, Set<string>>()
  for (const [file, css] of sheets) {
    for (const rule of parseCssRules(css)) {
      for (const block of subjectBlocks(rule)) owners.set(block, new Set([...(owners.get(block) ?? []), file]))
    }
  }
  return [...owners]
    .filter(([, files]) => files.size > 1)
    .map(([block, files]) => `${block}: ${[...files].join(', ')}`)
}

describe('cada bloco de classe e estilizado numa folha so', () => {
  const sheets = discoverAppStylesheets().map((file) => [file, readAppStylesheet(file)] as const)

  it('CONTROLE: a folha global foi achada primeiro, lida, e tem regra de verdade', () => {
    expect(sheets[0]?.[0]).toBe(GLOBAL_STYLESHEET)
    const rules = parseCssRules(sheets[0]?.[1] ?? '')
    // O global ENCOLHE de proposito a cada PR da divisao; o controle e "leu a folha
    // certa e ela tem regra de verdade", nao um tamanho. O header nunca sai dele.
    expect(rules.length).toBeGreaterThan(300)
    expect(rules.some((rule) => subjectBlocks(rule).includes('site-header'))).toBe(true)
  })

  it('nenhum bloco e sujeito em duas folhas', () => {
    expect(sharedBlocks(sheets)).toEqual([])
  })

  it('CONTROLE NEGATIVO: bloco em duas folhas e acusado; bloco citado so como contexto, nao', () => {
    expect(
      sharedBlocks([
        ['a.css', '.card__title { color: red }'],
        ['b.css', '.card--x { color: blue } body:has(.art-hero) .site-header { top: 0 }'],
        ['c.css', '.art-hero { color: red }'],
      ]),
    ).toEqual(['card: a.css, b.css'])
  })
})
