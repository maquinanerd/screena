// @vitest-environment jsdom

/**
 * opapreco-ad-hydration.test.tsx — o script do OpaPreço pode desenhar ANTES de
 * o React hidratar, e o `<op-slot>` tem de sobreviver a isso.
 *
 * O script é `async`: nada garante que ele rode depois da hidratação. Se ele
 * desenhar primeiro, o React encontra filhos que não renderizou. Sem defesa,
 * isso é divergência de hidratação: o React descarta o HTML do servidor e cria
 * um `<op-slot>` novo, o script o vê nascer e pede a oferta DE NOVO (pedido em
 * dobro, anúncio piscando, impressão contada sobre outro elemento).
 *
 * O teste faz o que o navegador faria: HTML do servidor no documento, o "script"
 * enche o slot, e só então o React hidrata. O CONTROLE NEGATIVO é o mesmo
 * `<op-slot>` sem o `dangerouslySetInnerHTML`: ele tem de quebrar, senão o teste
 * não prova nada.
 */

import { act } from 'react'
import type { ReactNode } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { OpaPrecoAd } from '../opapreco-ad'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const SAVED_FLAG = process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'true'
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
  document.head.replaceChildren()
  if (SAVED_FLAG === undefined) delete process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED
  else process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = SAVED_FLAG
})

/** O mesmo `<op-slot>`, SEM a defesa — o controle negativo. */
function UndefendedSlot(): ReactNode {
  return <op-slot endpoint="https://opapreco.com.br" site-key="cinerie" slot-key="article-top" suppressHydrationWarning />
}

/**
 * Servidor -> script do OpaPreço -> hidratação. Devolve o slot de antes, o de
 * depois e os erros que o React relatou.
 */
function serverThenSdkThenHydrate(tree: () => ReactNode) {
  container.innerHTML = renderToString(<main>{tree()}</main>)
  // Num documento de verdade o React do servidor emite o script e a folha de
  // estilo no <head>; aqui eles saem no lugar, e vão para o <head> à mão.
  for (const hoisted of container.querySelectorAll('script, link')) document.head.appendChild(hoisted)

  const before = container.querySelector('op-slot')
  if (before === null) throw new Error('o servidor não renderizou o <op-slot>')
  // O que o `<op-slot>` faz ao ficar pronto: desenha, marca o estado, reserva.
  const ad = document.createElement('a')
  ad.href = 'https://s.shopee.com.br/AbC123'
  ad.dataset['opOffer'] = 'oferta-1'
  ad.textContent = 'SSD 1TB · Link de afiliado'
  before.replaceChildren(ad)
  before.classList.add('op-slot')
  before.setAttribute('data-op-estado', 'pronto')
  before.setAttribute('data-ad-component', 'product_hero_v1')

  const errors: unknown[] = []
  act(() => {
    root = hydrateRoot(container, <main>{tree()}</main>, {
      onRecoverableError: (error) => errors.push(error),
    })
  })
  return { before, after: container.querySelector('op-slot'), errors }
}

describe('<OpaPrecoAd> e a hidratação', () => {
  it('o anúncio desenhado antes da hidratação continua no MESMO elemento, sem erro', () => {
    const { before, after, errors } = serverThenSdkThenHydrate(() => (
      <OpaPrecoAd contentId="4821" slotKey="article-top" />
    ))
    expect(errors).toEqual([])
    expect(after).toBe(before)
    expect(after?.querySelector('a')?.getAttribute('href')).toBe('https://s.shopee.com.br/AbC123')
    expect(after?.getAttribute('data-op-estado')).toBe('pronto')
  })

  it('CONTROLE NEGATIVO: sem o conteúdo opaco, o React refaz o slot e o anúncio some', () => {
    const { before, after, errors } = serverThenSdkThenHydrate(() => <UndefendedSlot />)
    expect(errors.length).toBeGreaterThan(0)
    expect(after).not.toBe(before)
    expect(after?.querySelector('a')).toBeNull()
  })
})
