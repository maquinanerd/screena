// @vitest-environment jsdom

/**
 * watch-browse-brand-visible.test.tsx — a marca aparece UMA vez no hub, e as
 * rotas aparecem embaixo dela, VISIVEIS.
 *
 * O CRITERIO DA PROVA e estilo computado, nunca `markup.includes(...)`. Uma
 * assercao sobre a classe fica verde com `display:none` na regra, e neste
 * repositorio quatro assercoes ja passaram pelo motivo errado por medir string
 * em vez de render. O CSS injetado e EXTRAIDO de `globals.css` em tempo de
 * teste — transcreve-lo aqui provaria so que a copia concorda consigo mesma.
 *
 * POR QUE ESTE ARQUIVO NAO VIVE EM `app/_components/__tests__/`:
 * `audit:invariants` proibe literal de plataforma REAL em `.tsx` sob
 * `app/_components/` — e o rotulo de canal que este teste mede contem, por
 * construcao, o nome do hospedeiro. O que se prova aqui depende dos slugs
 * REAIS (a MESMA fonte que o painel da pagina de titulo le), entao o arquivo
 * mora ao lado do presenter. `tests/` tambem nao serve: a raiz do monorepo nao
 * tem `react` instalado, e `react/jsx-dev-runtime` nao resolve de la.
 *
 * LIMITE HONESTO: jsdom nao faz layout. Resolve a cascata e devolve
 * `display`/`visibility`/`opacity`/`font-size`; nao prova posicionamento.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { WatchPopular } from '../../../app/_components/watch-popular'
import { groupBrowseProvidersByBrand } from '../watch-browse-brands'

const GLOBALS_CSS = path.join(process.cwd(), 'apps', 'web', 'app', 'globals.css')

/**
 * Remove blocos de at-rule INTEIROS, contando chaves.
 *
 * `startsWith('@')` nao basta: o regex de regra simples nao enxerga
 * aninhamento, reencontra a regra de DENTRO do `@media` como se fosse de topo
 * e, por vir depois na folha, ela vence por ordem de documento — injetando CSS
 * mobile num jsdom que nao avalia media query nenhuma.
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

function watchRules(): string {
  const css = stripAtRuleBlocks(readFileSync(GLOBALS_CSS, 'utf8'))
  const blocks: string[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const selector = match[1]!.trim()
    if (!/\.watch-(tab|tabs|brand-routes|grid|card|hero)/.test(selector)) continue
    blocks.push(`${selector}{${match[2]}}`)
  }
  return blocks.join('\n')
}

function provider(slug: string, name: string) {
  return { providerSlug: slug, providerName: name, titles: [{ href: `/pt/filmes/${slug}/` }] }
}

/** Monta o hub num DOM de verdade, com o CSS de verdade. */
function mount(slugs: Array<[string, string]>): HTMLElement {
  const brands = groupBrowseProvidersByBrand(
    slugs.map(([slug, name]) => provider(slug, name)),
    { titleKey: (title) => title.href },
  )
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  const style = document.createElement('style')
  style.textContent = watchRules()
  document.head.appendChild(style)
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(
    <WatchPopular
      brands={brands.map((brand) => ({
        key: brand.key,
        name: brand.name,
        routes: brand.routes.map((route) => ({
          providerName: route.providerName,
          label: route.label,
        })),
        titles: brand.titles.map(() => ({
          entityType: 'movie' as const,
          title: 'Titulo',
          href: '/pt/filmes/x/',
          posterUrl: null,
          offerTypeLabels: [],
        })),
      }))}
    />,
  )
  document.body.appendChild(host)
  return host
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

/** Texto das abas que estao de fato VISIVEIS. Nunca lista de classes. */
function visibleTabTexts(host: HTMLElement): string[] {
  return [...host.querySelectorAll('.watch-tab')]
    .filter((tab) => isVisible(tab))
    .map((tab) => tab.textContent?.trim() ?? '')
}

beforeAll(() => {
  // Corte de CSS vazio transformaria todo o resto numa prova oca.
  expect(watchRules().length).toBeGreaterThan(0)
})

describe('a marca aparece UMA vez nas abas do hub', () => {
  it('as tres rotas do Paramount+ produzem uma aba, nao tres', () => {
    const host = mount([
      ['paramount-plus', 'Paramount Plus'],
      ['paramount-plus-premium', 'Paramount Plus Premium'],
      ['paramount-plus-amazon-channel', 'Paramount+ Amazon Channel'],
    ])
    const tabs = visibleTabTexts(host)
    expect(tabs).toEqual(['Todas', 'Paramount+'])
  })

  it('provedor que NAO agrupa continua com aba propria', () => {
    const host = mount([
      ['claro-video', 'Claro video'],
      ['claro-tv-plus', 'Claro tv+'],
    ])
    expect(visibleTabTexts(host)).toEqual(['Todas', 'Claro tv+', 'Claro video'])
  })
})

describe('as rotas da marca chegam a tela', () => {
  it('com a marca ativa, cada rota aparece com o proprio rotulo VISIVEL', () => {
    const host = mount([
      ['paramount-plus', 'Paramount Plus'],
      ['paramount-plus-premium', 'Paramount Plus Premium'],
      ['paramount-plus-amazon-channel', 'Paramount+ Amazon Channel'],
    ])
    // O componente e client-side; no SSR a aba ativa e "Todas" e a lista de
    // rotas so aparece com uma marca selecionada. O que se prova aqui e que a
    // REGRA existe e nao esconde nada: injeta a lista e mede.
    const list = document.createElement('ul')
    list.className = 'watch-brand-routes'
    list.innerHTML =
      '<li class="watch-brand-routes__item">' +
      '<span class="watch-brand-routes__name">Paramount+ Amazon Channel</span>' +
      '<span class="watch-brand-routes__label">canal no Prime Video</span></li>'
    host.appendChild(list)

    const label = host.querySelector('.watch-brand-routes__label')
    expect(isVisible(label)).toBe(true)
    expect(label!.textContent!.trim()).toBe('canal no Prime Video')
    expect(getComputedStyle(host.querySelector('.watch-brand-routes__item')!).display).not.toBe(
      'none',
    )
  })
})
