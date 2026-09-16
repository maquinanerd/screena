/**
 * css-rules.test.ts — o leitor de regras das ferramentas da divisao do CSS.
 *
 * Aqui CSS vence por ordem de documento, entao o leitor precisa acertar tres
 * coisas que um extrator por expressao regular erra: a ORDEM das regras, o
 * CONTEXTO (`@media`) de cada uma, e seletor/declaracao separados sem se enganar
 * com comentario, string, `url(data:...;...)` ou `:is(.a, .b)`.
 */

import { describe, expect, it } from 'vitest'

import {
  blockOf,
  classTokens,
  type CssRule,
  expandSelectorList,
  parseCssRules,
  splitSafeSelector,
  subjectBlocks,
  subjectClassTokens,
} from '../../apps/web/scripts/lab/css-rules'

describe('parseCssRules', () => {
  it('le as regras na ORDEM de documento, com o contexto do @media', () => {
    const rules = parseCssRules(
      '.a { color: red; }\n@media (max-width: 767px) {\n  .b { color: blue; }\n  .c { color: green }\n}\n.d { color: black; }',
    )
    expect(rules.map((rule) => rule.prelude)).toEqual(['.a', '.b', '.c', '.d'])
    expect(rules.map((rule) => rule.index)).toEqual([0, 1, 2, 3])
    expect(rules[1]?.context).toEqual(['@media (max-width: 767px)'])
    expect(rules[3]?.context).toEqual([])
  })

  it('@font-face e @keyframes saem inteiros e opacos, na posicao deles', () => {
    const rules = parseCssRules(
      '@font-face { font-family: X; src: url(x.woff2); }\n.a { animation: fade 1s; }\n' +
        '@keyframes fade { from { opacity: 0 } to { opacity: 1 } }\n.b { color: red }',
    )
    expect(rules.map((rule) => [rule.kind, rule.prelude])).toEqual([
      ['at-block', '@font-face'],
      ['style', '.a'],
      ['at-block', '@keyframes fade'],
      ['style', '.b'],
    ])
  })

  it('comentario, string e url(data:...;...) nao quebram declaracao nem regra', () => {
    const [rule] = parseCssRules(
      '/* .falsa { color: red } */ .icone::after { content: "a{b};c"; ' +
        'background: url("data:image/svg+xml;utf8,<svg></svg>") no-repeat; color: red !important }',
    )
    expect(rule?.prelude).toBe('.icone::after')
    expect(rule?.declarations).toEqual([
      { property: 'content', value: '"a{b};c"', important: false },
      { property: 'background', value: 'url("data:image/svg+xml;utf8,<svg></svg>") no-repeat', important: false },
      { property: 'color', value: 'red', important: true },
    ])
  })

  it('seletores separados so na virgula de topo', () => {
    expect(parseCssRules('.a:is(.b, .c), .d > .e { color: red }')[0]?.selectors).toEqual([
      '.a:is(.b, .c)',
      '.d > .e',
    ])
  })

  it('a identidade ignora comentario e espaco, e muda com o contexto', () => {
    const [plain] = parseCssRules('.a {  color:red; }')
    const [commented] = parseCssRules('/* x */ .a { color:red; }')
    const [scoped] = parseCssRules('@media (min-width: 1px) { .a { color:red; } }')
    expect(plain?.identity).toBe(commented?.identity)
    expect(scoped?.identity).not.toBe(plain?.identity)
  })

  it('a linha de cada regra e a do arquivo, mesmo depois de comentario de varias linhas', () => {
    const rules = parseCssRules('.a { color: red }\n\n/* comentario\n de duas linhas */\n.b {\n  color: blue;\n}\n.c { color: green }')
    expect(rules.map((rule) => rule.line)).toEqual([1, 5, 8])
  })
})

describe('classes e blocos', () => {
  it('toda classe do seletor, sem confundir atributo com classe', () => {
    expect(classTokens('a[href$=".pdf"].link:not(.x) > .y__z')).toEqual(['link', 'x', 'y__z'])
  })

  it('o SUJEITO e o ultimo composto, fora de :has() e :not()', () => {
    expect(subjectClassTokens("body:has(.art-hero[data-hero-media='true']) .site-header")).toEqual(['site-header'])
    expect(subjectClassTokens('.detail-hero .episode-row__title:not(.x)')).toEqual(['episode-row__title'])
    expect(subjectClassTokens('.a > .b + .c ~ .d.e::after')).toEqual(['d', 'e'])
    expect(subjectClassTokens('.lista > li:nth-child(2n+1)')).toEqual([])
  })

  it('bloco e o prefixo antes de __ ou --', () => {
    expect(blockOf('episode-row__title--name')).toBe('episode-row')
    expect(blockOf('site-header')).toBe('site-header')
  })

  it('os blocos-sujeito de uma regra com varios seletores', () => {
    const rule = parseCssRules('.a__b, .x .c--d { color: red }')[0] as CssRule
    expect(subjectBlocks(rule)).toEqual(['a', 'c'])
  })
})

describe('lista de seletores', () => {
  it('expande em uma regra por seletor, com as MESMAS declaracoes e o mesmo contexto', () => {
    const [list] = parseCssRules('@media (max-width: 767px) { .a, .b__c { color: red; margin: 0 } }')
    const expanded = expandSelectorList(list as CssRule)
    expect(expanded.map((rule) => rule.prelude)).toEqual(['.a', '.b__c'])
    const [single] = parseCssRules('@media (max-width: 767px) { .b__c { color: red; margin: 0 } }')
    expect(expanded[1]?.identity).toBe((single as CssRule).identity)
    expect(expanded[1]?.context).toEqual(['@media (max-width: 767px)'])
  })

  it('regra de um seletor e at-rule voltam como estao', () => {
    const [single, keyframes] = parseCssRules('.a { color: red }\n@keyframes x { from { opacity: 0 } }')
    expect(expandSelectorList(single as CssRule)).toEqual([single])
    expect(expandSelectorList(keyframes as CssRule)).toEqual([keyframes])
  })

  it('CONTROLE NEGATIVO: divisao insegura com pseudo-classe de lista ou prefixo de fornecedor', () => {
    expect(splitSafeSelector('.eyebrow-bar span')).toBe(true)
    expect(splitSafeSelector(":root[data-poster-size='small'] .similar-card")).toBe(true)
    expect(splitSafeSelector('.set-row__label:has(.set-row__select)')).toBe(false)
    expect(splitSafeSelector(':is(.a, .b) span')).toBe(false)
    expect(splitSafeSelector('.x::-webkit-scrollbar')).toBe(false)
    expect(splitSafeSelector('.x:-moz-focusring')).toBe(false)
  })
})
