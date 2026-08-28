// @vitest-environment jsdom

/**
 * popular-ranking-tabs.test.tsx — a aba de "Popular essa semana" com DOM,
 * clique e URL de verdade.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Ate 2026-08-28 a aba inicial vinha de `?ranking=` lido no SERVIDOR
 * (`searchParams` em `app/pt/page.tsx`, `app/pt/filmes/page.tsx` e
 * `app/pt/series/page.tsx`). Uma unica leitura de `searchParams` num server
 * component torna a rota INTEIRA dinamica — era um dos dois motivos pelos quais
 * a home nao podia ser guardada e respondia em 3,7 s de TTFB, medido em
 * producao.
 *
 * A leitura passou para o cliente. Com isso, duas provas que viviam em
 * `vertical-scoping.test.tsx` como markup estatico deixaram de ser mediveis la:
 * "trocar a aba troca a lista" e "'Ver tudo' segue a aba ativa" nao sao mais
 * propriedades da primeira pintura. Elas nao foram removidas — elas se mudaram
 * para ca, e ficaram MAIS fortes: agora ha clique, e ha a URL sendo reescrita.
 *
 * A prova mais importante e a (4): o HTML DO SERVIDOR nao pode depender de
 * `?ranking=`. Se ele dependesse, guardar a pagina serviria a aba de um leitor
 * para outro — e essa e a razao inteira da mudanca.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PopularThisWeek, type PopularRankingPanel } from '../popular-this-week'
import { RANKING_TABS, type RankingVertical } from '../../../src/lib/popular-rankings'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

function panelsFor(vertical: RankingVertical): PopularRankingPanel[] {
  return RANKING_TABS[vertical].map((tab, index) => ({
    tab,
    items: [
      {
        id: `${vertical}:${tab.slug}`,
        rank: 1,
        title: `Título de ${tab.label}`,
        href: `/pt/filmes/t-${index}/`,
        posterUrl: null,
      },
    ],
  }))
}

let container: HTMLDivElement
let root: Root

function mount(vertical: RankingVertical): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<PopularThisWeek headingId="pop" panels={panelsFor(vertical)} vertical={vertical} />)
  })
}

function visibleText(): string {
  return (container.textContent ?? '').replace(/\s+/g, ' ')
}

function seeAllHref(): string | null {
  return container.querySelector<HTMLAnchorElement>('a.see-all')?.getAttribute('href') ?? null
}

function tabButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button.pop-tabs__tab')].find(
    (button) => (button.textContent ?? '').trim() === label,
  )
  if (found === undefined) throw new Error(`aba ausente: ${label}`)
  return found
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.history.replaceState({}, '', '/pt/filmes/')
  // O jsdom nao implementa `Element.scrollTo` (nao ha layout para rolar). O
  // componente chama isso ao trocar de aba, para a posicao 1 do novo recorte
  // ficar visivel. Sem o stub, o teste reprovaria por uma lacuna do ambiente e
  // nao por um defeito do produto.
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo(): void {}
  }
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

describe('Popular essa semana — a aba e controle de cliente', () => {
  it('(1) trocar a aba troca a LISTA, nao so o estilo', () => {
    mount('movies')
    expect(visibleText()).toContain('Título de Em cartaz')
    expect(visibleText()).not.toContain('Título de Clássicos')

    act(() => {
      tabButton('Clássicos').click()
    })

    expect(visibleText()).toContain('Título de Clássicos')
    expect(visibleText()).not.toContain('Título de Em cartaz')
  })

  it('(2) "Ver tudo" segue a aba ATIVA — nunca e link fixo', () => {
    mount('movies')
    expect(seeAllHref()).toBe('/pt/filmes/')

    act(() => {
      tabButton('Streaming').click()
    })
    expect(seeAllHref()).toBe('/pt/onde-assistir/')
  })

  it('(3) o clique escreve `?ranking=` na URL, sem navegar', () => {
    mount('movies')
    act(() => {
      tabButton('Streaming').click()
    })
    expect(new URL(window.location.href).searchParams.get('ranking')).toBe('streaming')
    // `replaceState`, nao `pushState`: o botao "voltar" pertence a navegacao
    // entre paginas, nao a troca de recorte dentro de uma secao.
    expect(window.location.pathname).toBe('/pt/filmes/')
  })

  it('(4) O QUE IMPORTA PARA O CACHE: o HTML do servidor NAO varia com `?ranking=`', () => {
    // O mesmo componente, renderizado no servidor, tem de produzir bytes
    // identicos independentemente da URL — porque o servidor nao le a URL. Se
    // um dia alguem reintroduzir `searchParams` na pagina, esta asercao nao
    // pega sozinha; quem pega e `tests/web/route-cache-policy.test.ts`. Aqui
    // fica travado que o COMPONENTE nao e a fonte da variacao.
    const markup = renderToStaticMarkup(
      <PopularThisWeek headingId="pop" panels={panelsFor('movies')} vertical="movies" />,
    )
    window.history.replaceState({}, '', '/pt/filmes/?ranking=classicos')
    const outro = renderToStaticMarkup(
      <PopularThisWeek headingId="pop" panels={panelsFor('movies')} vertical="movies" />,
    )
    expect(outro).toBe(markup)
    // E o servidor manda a aba DEFAULT da vertical, sempre.
    expect(markup).toContain('Título de Em cartaz')
    mount('movies')
  })

  it('(5) DEEP LINK: `?ranking=` valido e aplicado na montagem, no cliente', () => {
    window.history.replaceState({}, '', '/pt/filmes/?ranking=classicos')
    mount('movies')
    expect(visibleText()).toContain('Título de Clássicos')
    expect(visibleText()).not.toContain('Título de Em cartaz')
  })

  it('(6) `?ranking=` de OUTRA vertical (ou forjado) cai na aba default desta', () => {
    window.history.replaceState({}, '', '/pt/filmes/?ranking=novas-temporadas')
    mount('movies')
    expect(visibleText()).toContain('Título de Em cartaz')
    expect(visibleText()).not.toContain('Novas temporadas')
  })

  it('(7) o deep link NAO sobrescreve a escolha do leitor', () => {
    window.history.replaceState({}, '', '/pt/filmes/?ranking=classicos')
    mount('movies')
    act(() => {
      tabButton('Streaming').click()
    })
    expect(visibleText()).toContain('Título de Streaming')
    expect(visibleText()).not.toContain('Título de Clássicos')
  })
})
