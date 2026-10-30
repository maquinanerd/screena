// @vitest-environment jsdom

/**
 * consent-banner.test.tsx — O aviso de cookies e o Google Analytics, num DOM de
 * verdade.
 *
 * A PROVA MAIS IMPORTANTE E A NEGATIVA: antes do "Aceitar", a string
 * "googletagmanager" nao aparece em lugar nenhum do documento, `dataLayer` nao
 * existe e nenhum cookie `_ga` foi gravado. E o que sustenta o item 6 da
 * Politica de Privacidade ("nada que dependa da sua autorizacao carrega
 * sozinho"). O resto — aceitar, recusar, reabrir, retirar — vem depois dela.
 */

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ConsentBanner, CookiePreferencesButton } from '../consent-banner'
import {
  CONSENT_STORAGE_KEY,
  serializeConsent,
} from '../../../src/lib/analytics-consent'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

interface GtagWindow extends Window {
  dataLayer?: unknown[]
  gtag?: unknown
  [flag: `ga-disable-${string}`]: boolean | undefined
}

const GA_ID = 'G-AB12CD34EF'

let container: HTMLDivElement
let root: Root

function render(node: ReactNode): void {
  act(() => root.render(node))
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`botao "${label}" nao encontrado`)
  return found
}

function gaScripts(): HTMLScriptElement[] {
  return [...document.querySelectorAll('script')].filter((s) => s.src.includes('googletagmanager'))
}

function banner(): Element | null {
  return document.querySelector('.consent-banner')
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.head.querySelectorAll('script').forEach((s) => s.remove())
  const w = window as unknown as GtagWindow
  delete w.dataLayer
  delete w.gtag
  delete w[`ga-disable-${GA_ID}`]
  // `expires` no passado, e nao a outra grafia: `check-invariants` le o nome de
  // uma plataforma de streaming nela.
  for (const name of ['_ga', `_ga_${GA_ID.slice(2)}`]) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/`
  }
})

describe('ConsentBanner — o GA4 so carrega depois do "Aceitar"', () => {
  it('(1) NEGATIVA: primeira visita mostra o aviso e NAO carrega nada do Google', () => {
    render(<ConsentBanner measurementId={GA_ID} />)

    expect(banner()).not.toBeNull()
    expect(document.documentElement.outerHTML).not.toContain('googletagmanager')
    expect((window as unknown as GtagWindow).dataLayer).toBeUndefined()
    expect(document.cookie).not.toContain('_ga')
  })

  it('(2) recusar custa o mesmo que aceitar: mesma classe, nenhum pre-selecionado', () => {
    render(<ConsentBanner measurementId={GA_ID} />)

    expect(button('Recusar').className).toBe(button('Aceitar').className)
    expect(document.activeElement).not.toBe(button('Aceitar'))
    expect(document.activeElement).not.toBe(button('Recusar'))
  })

  it('(3) "Aceitar" grava a escolha, fecha o aviso e carrega o gtag.js com o ID', () => {
    render(<ConsentBanner measurementId={GA_ID} />)
    act(() => button('Aceitar').click())

    expect(banner()).toBeNull()
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toContain('"granted"')
    expect(gaScripts().map((s) => s.src)).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`])

    const comandos = ((window as unknown as GtagWindow).dataLayer ?? []).map((args) => [...(args as IArguments)])
    const config = comandos.find((args) => args[0] === 'config')
    expect(config?.[1]).toBe(GA_ID)
    // A Politica declara Google Signals e personalizacao de anuncio DESLIGADOS.
    expect(config?.[2]).toMatchObject({ allow_google_signals: false, allow_ad_personalization_signals: false })
    const padrao = comandos.find((args) => args[0] === 'consent' && args[1] === 'default')
    expect(padrao?.[2]).toMatchObject({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
  })

  it('(4) "Recusar" grava a recusa e NAO carrega nada', () => {
    render(<ConsentBanner measurementId={GA_ID} />)
    act(() => button('Recusar').click())

    expect(banner()).toBeNull()
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toContain('"denied"')
    expect(document.documentElement.outerHTML).not.toContain('googletagmanager')
  })

  it('(5) escolha guardada vale na proxima pagina: sem aviso, e o "sim" carrega o GA4', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('granted', new Date()))
    render(<ConsentBanner measurementId={GA_ID} />)

    expect(banner()).toBeNull()
    expect(gaScripts()).toHaveLength(1)
  })

  it('(6) recusa guardada: sem aviso e sem script — o aviso nao insiste', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('denied', new Date()))
    render(<ConsentBanner measurementId={GA_ID} />)

    expect(banner()).toBeNull()
    expect(gaScripts()).toHaveLength(0)
  })

  it('(7) o botao do rodape reabre o aviso, mostra a escolha atual e leva o foco', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('denied', new Date()))
    render(
      <>
        <ConsentBanner measurementId={GA_ID} />
        <CookiePreferencesButton />
      </>,
    )
    act(() => button('Preferências de cookies').click())

    expect(banner()?.textContent).toContain('Sua escolha atual: recusado.')
    expect(document.activeElement).toBe(button('Recusar'))
  })

  it('(8) retirar a autorizacao desliga a coleta e apaga os cookies _ga', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('granted', new Date()))
    document.cookie = '_ga=GA1.1.123.456; Path=/'
    document.cookie = `_ga_${GA_ID.slice(2)}=GS1.1; Path=/`
    render(
      <>
        <ConsentBanner measurementId={GA_ID} />
        <CookiePreferencesButton />
      </>,
    )
    act(() => button('Preferências de cookies').click())
    act(() => button('Recusar').click())

    const w = window as unknown as GtagWindow
    expect(w[`ga-disable-${GA_ID}`]).toBe(true)
    expect(document.cookie).not.toContain('_ga')
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toContain('"denied"')
    const comandos = (w.dataLayer ?? []).map((args) => [...(args as IArguments)])
    expect(comandos.at(-1)).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
  })

  it('(9) escolha vencida conta como nenhuma: o aviso volta', () => {
    const vencida = new Date(Date.now() - 200 * 86_400_000)
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent('granted', vencida))
    render(<ConsentBanner measurementId={GA_ID} />)

    expect(banner()).not.toBeNull()
    expect(gaScripts()).toHaveLength(0)
  })
})
