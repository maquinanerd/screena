/**
 * css-order.test.ts — quando a ordem entre duas regras decide o estilo.
 *
 * A checagem estatica da divisao do CSS reprova a mudanca de folha que inverte um
 * EMPATE: mesma classe, mesma especificidade, mesma importancia, propriedade em
 * comum, em contextos que podem valer juntos. Os controles negativos provam que
 * ela nao acusa o que a ordem nao decide.
 */

import { describe, expect, it } from 'vitest'

import {
  compareSpecificity,
  contextsMayOverlap,
  orderConflicts,
  propertiesOverlap,
  specificityOf,
} from '../../apps/web/scripts/lab/css-order'
import { type CssRule, parseCssRules } from '../../apps/web/scripts/lab/css-rules'

const regra = (css: string): CssRule => parseCssRules(css)[0] as CssRule

describe('especificidade', () => {
  it.each([
    ['.a', [0, 1, 0]],
    ['.a .b', [0, 2, 0]],
    ['#x .a', [1, 1, 0]],
    ['h4.a', [0, 1, 1]],
    ['.a::after', [0, 1, 1]],
    ['.a:before', [0, 1, 1]],
    ['[data-vertical="series"] .a', [0, 2, 0]],
    ['.a:not(.b, #c)', [1, 1, 0]],
    ['.a:where(.b, #c)', [0, 1, 0]],
    ['body:has(.art-hero) .site-header', [0, 2, 1]],
    ['.a:hover', [0, 2, 0]],
    ['.a:nth-child(2n+1)', [0, 2, 0]],
    ['.a > li', [0, 1, 1]],
  ] as const)('%s', (selector, expected) => {
    expect(specificityOf(selector)).toEqual(expected)
  })

  it('compara na ordem id, classe, tipo', () => {
    expect(compareSpecificity([0, 2, 0], [0, 1, 5])).toBeGreaterThan(0)
    expect(compareSpecificity([0, 1, 1], [0, 1, 1])).toBe(0)
  })
})

describe('propriedades que disputam o mesmo valor', () => {
  it('iguais, ou uma e atalho da outra', () => {
    expect(propertiesOverlap('margin', 'margin-top')).toBe(true)
    expect(propertiesOverlap('border-top-color', 'border')).toBe(true)
    expect(propertiesOverlap('inset', 'left')).toBe(true)
    expect(propertiesOverlap('font', 'line-height')).toBe(true)
    expect(propertiesOverlap('gap', 'column-gap')).toBe(true)
  })

  it('CONTROLE NEGATIVO: propriedades diferentes nao disputam', () => {
    expect(propertiesOverlap('color', 'background-color')).toBe(false)
    expect(propertiesOverlap('top', 'left')).toBe(false)
    expect(propertiesOverlap('margin-top', 'padding-top')).toBe(false)
  })
})

describe('contexto', () => {
  it('faixas de largura que nao se tocam nao valem juntas; o resto, sim', () => {
    expect(contextsMayOverlap(['@media (max-width: 767px)'], ['@media (min-width: 1024px)'])).toBe(false)
    expect(contextsMayOverlap(['@media (max-width: 1023px)'], ['@media (min-width: 768px)'])).toBe(true)
    expect(contextsMayOverlap([], ['@media (max-width: 767px)'])).toBe(true)
    expect(contextsMayOverlap(['@media (prefers-reduced-motion: reduce)'], [])).toBe(true)
  })
})

describe('orderConflicts', () => {
  it('EMPATE: mesma classe, especificidade e propriedade — a ordem decide', () => {
    expect(
      orderConflicts(regra('.card__title { font-size: 14px }'), regra('.card__title { font-size: 12px; color: red }')),
    ).toEqual(['.card__title × .card__title: font-size/font-size'])
  })

  it('CONTROLE NEGATIVO: especificidade, importancia, propriedade ou largura diferentes nao empatam', () => {
    expect(orderConflicts(regra('.card__title { font-size: 14px }'), regra('.hero .card__title { font-size: 12px }'))).toEqual([])
    expect(orderConflicts(regra('.card__title { font-size: 14px !important }'), regra('.card__title { font-size: 12px }'))).toEqual([])
    expect(orderConflicts(regra('.card__title { font-size: 14px }'), regra('.card__title { color: red }'))).toEqual([])
    expect(
      orderConflicts(
        regra('@media (max-width: 767px) { .card__title { font-size: 14px } }'),
        regra('@media (min-width: 1024px) { .card__title { font-size: 12px } }'),
      ),
    ).toEqual([])
  })

  it('LIMITE DECLARADO: seletores sem classe em comum nao sao comparados (a paridade cobre)', () => {
    expect(orderConflicts(regra('.card__title { color: red }'), regra('.hero h4 { color: blue }'))).toEqual([])
  })
})
