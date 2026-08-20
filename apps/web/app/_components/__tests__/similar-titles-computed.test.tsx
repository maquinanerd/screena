// @vitest-environment jsdom

/**
 * similar-titles-computed.test.tsx — "Mais como este" chega a tela, e a faixa
 * final para de reservar metade da largura para nada.
 *
 * O DEFEITO QUE ISTO GUARDA. As telas 06/07 fecham com uma grade de duas
 * colunas (`320px minmax(0,1fr)`): ficha tecnica a esquerda, "Mais como este" a
 * direita. No repositorio a direita era um `<div />` vazio. Nao era bloco
 * ausente — era meia faixa reservada para nada, em todo titulo.
 *
 * O CRITERIO DA PROVA e ESTILO COMPUTADO, nunca `markup.includes('classe')`.
 * Uma assercao sobre a classe fica verde com `display:none` na regra, e este
 * repositorio ja teve quatro assercoes passando pelo motivo errado por medir
 * string em vez de render. O CSS injetado e EXTRAIDO de `globals.css` em tempo
 * de teste: transcreve-lo aqui provaria so que a copia concorda consigo mesma.
 *
 * LIMITE HONESTO: jsdom nao faz layout. Ele resolve a cascata e devolve valores
 * computados — o suficiente para provar que o no nao foi escondido e que a
 * grade troca de trilhas. Nao prova posicionamento nem contraste.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { SimilarTitles } from '../similar-titles'
import {
  buildSimilarTitles,
  type SimilarTitleRow,
} from '../../../src/lib/similar-titles-presenter'

const GLOBALS_CSS = path.join(process.cwd(), 'apps', 'web', 'app', 'globals.css')

/**
 * Remove blocos de at-rule (`@media`, `@supports`, ...) INTEIROS, contando chaves.
 *
 * Isto NAO e detalhe de estilo. Um `if (selector.startsWith('@')) continue` nao
 * basta: o regex de regra simples nao enxerga aninhamento, entao ele reencontra
 * a regra de DENTRO do `@media` como se fosse de topo — e, como ela vem depois
 * na folha, ela VENCE por ordem de documento. A primeira versao deste arquivo
 * mediu `1fr` numa grade que, no desktop, tem duas trilhas: o CSS mobile tinha
 * vazado para dentro do jsdom, que nao avalia media query nenhuma.
 */
function stripAtRuleBlocks(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('@', index)
    if (at === -1) {
      out += css.slice(index)
      break
    }
    const open = css.indexOf('{', at)
    if (open === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, at)
    let depth = 1
    let cursor = open + 1
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    index = cursor
  }
  return out
}

/** Toda regra de TOPO de `globals.css` que alcanca a faixa final. Extraida. */
function fichaRules(): string {
  const css = stripAtRuleBlocks(readFileSync(GLOBALS_CSS, 'utf8'))
  const blocks: string[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const selector = match[1]!.trim()
    if (!/\.(ficha-grid|similar-titles|similar-card|detail-section-title)/.test(selector)) continue
    blocks.push(`${selector}{${match[2]}}`)
  }
  return blocks.join('\n')
}

function withCss(html: string): HTMLElement {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  const style = document.createElement('style')
  style.textContent = fichaRules()
  document.head.appendChild(style)
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

function row(entityId: string, over: Partial<SimilarTitleRow> = {}): SimilarTitleRow {
  return {
    entityId,
    titleOriginal: `Obra ${entityId}`,
    translationTitle: null,
    slug: `obra-${entityId}`,
    year: 2020,
    posterPath: null,
    position: Number(entityId),
    ...over,
  }
}

function mountBlock(): HTMLElement {
  const view = buildSimilarTitles([row('2'), row('3')], {
    excludeEntityId: '1',
    relationLabel: 'Coleção Exemplo',
  })!
  return withCss(renderToStaticMarkup(<SimilarTitles headingId="t" view={view} />))
}

/** Visivel para quem enxerga? Sobe a cadeia inteira de ancestrais. */
function isVisible(node: Element | null): boolean {
  let current: Element | null = node
  while (current !== null && current !== document.documentElement) {
    const style = getComputedStyle(current)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (style.opacity === '0') return false
    if (style.fontSize === '0px') return false
    current = current.parentElement
  }
  return node !== null
}

/** Acha um no pelo TEXTO exato, nunca pela classe. */
function byText(host: HTMLElement, selector: string, text: string): Element | null {
  return [...host.querySelectorAll(selector)].find((el) => el.textContent?.trim() === text) ?? null
}

beforeAll(() => {
  // Corte de CSS vazio transformaria todo o resto numa prova oca.
  expect(fichaRules().length).toBeGreaterThan(0)
})

describe('a faixa final nao reserva metade da largura para nada', () => {
  it('com bloco: a grade tem DUAS trilhas (ficha 320px + trilho)', () => {
    const host = withCss('<div class="ficha-grid"><div></div><div></div></div>')
    const grid = host.querySelector('.ficha-grid')!
    expect(getComputedStyle(grid).gridTemplateColumns).toBe('320px minmax(0, 1fr)')
  })

  it('sem bloco: a grade colapsa para UMA trilha — a coluna morta some', () => {
    const host = withCss('<div class="ficha-grid ficha-grid--solo"><div></div></div>')
    const grid = host.querySelector('.ficha-grid')!
    // O defeito era exatamente isto continuar em duas trilhas com a direita vazia.
    expect(getComputedStyle(grid).gridTemplateColumns).toBe('minmax(0, 1fr)')
  })
})

describe('"Mais como este" chega a tela', () => {
  it('cada parente vira um card com titulo VISIVEL', () => {
    const host = mountBlock()
    const titulo = byText(host, '.similar-card__title', 'Obra 2')
    expect(titulo).not.toBeNull()
    expect(isVisible(titulo)).toBe(true)
    expect(getComputedStyle(titulo!).fontSize).toBe('13px')
  })

  it('a RELACAO aparece na tela — sem ela o titulo prometeria mais que a entrega', () => {
    const host = mountBlock()
    const kicker = byText(host, '.similar-titles__relation-kicker', 'Mesma coleção')
    const nome = byText(host, '.similar-titles__relation-name', 'Coleção Exemplo')
    expect(isVisible(kicker)).toBe(true)
    expect(isVisible(nome)).toBe(true)
  })

  it('o card carrega o rotulo de vertical, e nao so a cor (invariante 11)', () => {
    const host = mountBlock()
    const rotulo = byText(host, '.similar-card__type', 'Filme')
    expect(isVisible(rotulo)).toBe(true)
    // E a URL tambem separa a vertical, nao so o rotulo.
    const link = host.querySelector('.similar-card') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/pt/filmes/obra-2/')
  })

  it('o cabecalho do trilho e o menor (22px), como no canonico', () => {
    const host = mountBlock()
    const heading = host.querySelector('#t')!
    expect(getComputedStyle(heading).fontSize).toBe('22px')
  })

  it('NENHUM logo de terceiro entra no card (licenca: logoAllowed=false)', () => {
    const host = mountBlock()
    // O unico desenho permitido no card e o poster do proprio catalogo. As
    // setas do trilho sao controle do chrome e vivem FORA do card.
    for (const card of host.querySelectorAll('.similar-card')) {
      expect(card.querySelectorAll('svg')).toHaveLength(0)
      for (const img of card.querySelectorAll('img')) {
        expect(img.getAttribute('src')).toMatch(/^https:\/\/image\.tmdb\.org\//)
      }
    }
  })

  it('com poster no banco, a imagem vem do helper governado de URL', () => {
    const view = buildSimilarTitles([row('2', { posterPath: '/abc.jpg' })], {
      excludeEntityId: '1',
      relationLabel: 'Coleção Exemplo',
    })!
    const host = withCss(renderToStaticMarkup(<SimilarTitles headingId="t" view={view} />))
    const img = host.querySelector('.similar-card__poster img') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getAttribute('src')).toMatch(/^https:\/\/image\.tmdb\.org\/t\/p\/w300\/abc\.jpg$/)
    expect(isVisible(img)).toBe(true)
  })
})
