/**
 * popular-section-styling.test.ts — O que a folha de estilo tem de garantir na
 * seção "Popular essa semana".
 *
 * ============ POR QUE MEDIR A CSS AQUI ============
 *
 * Duas regras desta seção não têm como ser provadas por render de markup: a cor
 * do acento (vem de uma custom property que só resolve no navegador) e o
 * comportamento das abas em viewport estreita. A CSS É o artefato nesses dois
 * casos — medir o texto dela não é aproximação, é medir a coisa.
 *
 * O que cada trava fecha:
 *
 *  1. o número do rank estava preso a `--c-accent-movie`: o ranking de
 *     `/pt/series` saía com o número em VERMELHO de filme;
 *  2. a aba ativa sublinhava em branco fixo, apagando a diferença entre as
 *     verticais;
 *  3. `.pop-tabs` era `justify-content:center; gap:36px` SEM regra de viewport
 *     estreita. Com "No ar · Streaming · Novas temporadas" a 320px a barra
 *     ultrapassava o container e empurrava a PÁGINA para a rolagem horizontal.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  path.join(process.cwd(), 'apps/web/app/globals.css'),
  'utf8',
)

/** Corpo de uma regra CSS pelo seletor exato (primeira ocorrência). */
function ruleBody(selector: string, from = 0): string {
  const at = CSS.indexOf(`${selector} {`, from)
  if (at === -1) return ''
  return CSS.slice(at, CSS.indexOf('}', at))
}

/**
 * Início do bloco responsivo DESTA seção. O arquivo tem 9k linhas e vários
 * `@media (max-width: 767px)`; ancorar num comentário evita medir a regra de
 * outra seção e concluir a coisa errada.
 */
const RESPONSIVE_ANCHOR = CSS.indexOf('"Popular essa semana" — matriz responsiva')

/** Corpo de uma regra DENTRO do `@media (max-width: N…)` desta seção. */
function ruleInMedia(maxWidth: number, selector: string): string {
  expect(RESPONSIVE_ANCHOR, 'bloco responsivo da seção ausente').toBeGreaterThan(-1)
  const media = CSS.indexOf(`@media (max-width: ${maxWidth}px)`, RESPONSIVE_ANCHOR)
  if (media === -1) return ''
  const end = CSS.indexOf('\n}', media)
  const block = CSS.slice(media, end === -1 ? undefined : end)
  const at = block.indexOf(`${selector} {`)
  return at === -1 ? '' : block.slice(at, block.indexOf('}', at))
}

describe('acento do ranking segue a vertical', () => {
  it('(1) o número do rank usa o token de contexto, nunca o vermelho de filme', () => {
    const rank = ruleBody('.pop-rail__rank span')
    expect(rank).toContain('var(--pop-accent)')
    expect(rank).not.toContain('var(--c-accent-movie)')
  })

  it('(2) o sublinhado da aba ativa usa o mesmo token', () => {
    expect(ruleBody(".pop-tabs__tab[aria-selected='true']")).toContain('var(--pop-accent)')
  })

  it('(3) o token resolve para vermelho por padrão e verde em séries', () => {
    // `:root` define o padrão (home e filmes); `[data-vertical='series']` vem
    // DEPOIS no arquivo, com a mesma especificidade — quem vence é a ordem de
    // documento, exatamente como `--ctx-accent` já fazia.
    const rootAt = CSS.indexOf('--pop-accent: var(--c-accent-movie)')
    const seriesAt = CSS.indexOf('--pop-accent: var(--c-accent-series)')
    expect(rootAt).toBeGreaterThan(-1)
    expect(seriesAt).toBeGreaterThan(rootAt)
    expect(CSS.slice(0, seriesAt)).toContain("[data-vertical='series'] {")
  })

  it("(4) NEGATIVO: o acento não é o token de fundo CLARO (ilegível sobre #0E0E10)", () => {
    for (const selector of ['.pop-rail__rank span', ".pop-tabs__tab[aria-selected='true']"]) {
      expect(ruleBody(selector)).not.toContain('--ctx-accent')
    }
  })
})

describe('a barra de abas não empurra a página em viewport estreita', () => {
  it('(5) abaixo de 768px as abas rolam na horizontal, alinhadas à esquerda', () => {
    const tabs = ruleInMedia(767, '.pop-tabs')
    expect(tabs).toContain('overflow-x: auto')
    expect(tabs).toContain('justify-content: flex-start')
    // Quebrar linha seria a outra saída — e o canônico proíbe as abas em duas
    // linhas. `nowrap` + rolagem é a saída escolhida.
    expect(tabs).toContain('flex-wrap: nowrap')
  })

  it('(6) o rótulo não encolhe nem quebra no meio da palavra', () => {
    const tab = ruleInMedia(767, '.pop-tabs__tab')
    expect(tab).toContain('flex: 0 0 auto')
    expect(tab).toContain('white-space: nowrap')
  })

  it('(7) o pôster acompanha a matriz do canônico (152 → 144 → 132 → 116)', () => {
    expect(ruleBody('.pop-rail__item')).toContain('flex: 0 0 152px')
    expect(ruleInMedia(1279, '.pop-rail__item')).toContain('144px')
    expect(ruleInMedia(1023, '.pop-rail__item')).toContain('132px')
    expect(ruleInMedia(767, '.pop-rail__item')).toContain('116px')
  })

  it('(8) o disco do número encolhe abaixo de 1024px (54 → 46)', () => {
    expect(ruleBody('.pop-rail__rank')).toContain('width: 54px')
    expect(ruleInMedia(1023, '.pop-rail__rank')).toContain('width: 46px')
  })
})

describe('geometria que o canônico exige e que parece estranha', () => {
  it('(9) o padding assimétrico da trilha continua intacto (o disco sangra)', () => {
    // `left:-12px; bottom:-8px` no disco só não é cortado por causa destes
    // quatro valores. Normalizar o padding recorta o número.
    expect(ruleBody('.pop-rail')).toContain('padding: 0 8px 8px 12px')
    const rank = ruleBody('.pop-rail__rank')
    expect(rank).toContain('left: -12px')
    expect(rank).toContain('bottom: -8px')
  })

  it('(10) o disco usa a MESMA cor da faixa (efeito de recorte), não preto puro', () => {
    expect(ruleBody('.pop-rail__rank')).toContain('var(--c-bg-dark-band)')
    expect(CSS).toContain('--c-bg-dark-band: #0e0e10')
  })

  it('(11) aba vazia mantém altura: a seção não colapsa ao trocar de recorte', () => {
    const empty = ruleBody('.pop-empty')
    expect(empty).toMatch(/min-height:\s*\d+px/)
    expect(ruleInMedia(1023, '.pop-empty')).toMatch(/min-height:\s*\d+px/)
    expect(ruleInMedia(767, '.pop-empty')).toMatch(/min-height:\s*\d+px/)
  })
})
