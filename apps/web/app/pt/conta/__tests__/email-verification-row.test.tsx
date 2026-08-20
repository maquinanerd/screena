// @vitest-environment jsdom

/**
 * email-verification-row.test.tsx — a linha de e-mail deixa de ser beco sem saída.
 *
 * O QUE FOI MEDIDO. `/pt/conta` dizia "Aguardando verificação" e parava aí.
 * Nenhum lugar do app chamava `POST /api/auth/email-verification/request` — o
 * handler existe, é testado, responde 202, e o app inteiro só sabia consumir o
 * link (`/confirm`, em `/pt/verificar-email`). Quem perdesse o e-mail original
 * ficava preso olhando o próprio problema descrito, sem botão nenhum.
 *
 * É o defeito da newsletter ao contrário: lá havia botão sem API; aqui havia API
 * sem botão. Os dois terminam no mesmo lugar.
 *
 * NOS DOIS SENTIDOS: quem já está verificado NÃO vê a ação (seria ruído e um
 * convite a pedir e-mail à toa), e quem não está vê e consegue disparar. Um
 * teste que só provasse metade ficaria verde com a ação aparecendo para todo
 * mundo — ou com ela sumindo de novo para todo mundo.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from '../settings-panel'

interface Plano {
  emailVerified: boolean
}

const chamadas: Array<{ url: string; body: unknown }> = []

function stubFetch(plano: Plano): void {
  const json = (body: unknown, status = 200) =>
    Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response)

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      chamadas.push({ url, body: init.body === undefined ? null : JSON.parse(String(init.body)) })
    }
    if (url.includes('/api/auth/session')) {
      return json({
        authenticated: true,
        user: {
          handle: 'pessoa',
          displayName: 'Pessoa Exemplo',
          emailVerified: plano.emailVerified,
          role: 'user',
          locale: 'pt-BR',
          profileVisibility: 'public',
        },
      })
    }
    if (url.includes('/api/account/profile')) {
      return json({
        profile: {
          displayName: 'Pessoa Exemplo',
          handle: 'pessoa',
          bio: null,
          locale: 'pt-BR',
          countryCode: null,
          timezone: null,
          visibility: 'public',
        },
      })
    }
    // 202 fixo: o endpoint de verificação é anti-enumeração.
    if (url.includes('/api/auth/email-verification/request')) return json({ ok: true }, 202)
    return json({})
  })
}

let container: HTMLDivElement
let root: Root

async function render(plano: Plano): Promise<void> {
  chamadas.length = 0
  stubFetch(plano)
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<SettingsPanel />)
  })
}

/** Acha um controle pelo TEXTO visível, nunca pela classe. */
function porTexto(selector: string, texto: string): HTMLElement | null {
  return (
    ([...container.querySelectorAll(selector)] as HTMLElement[]).find((el) =>
      (el.textContent ?? '').includes(texto),
    ) ?? null
  )
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  container?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('e-mail NÃO verificado: existe uma saída', () => {
  it('a linha oferece o reenvio, com texto visível', async () => {
    await render({ emailVerified: false })
    const gatilho = porTexto('.set-row--action', 'reenvie o link')
    expect(gatilho).not.toBeNull()
  })

  it('o formulário dispara o endpoint REAL, com o e-mail no corpo', async () => {
    await render({ emailVerified: false })
    const gatilho = porTexto('.set-row--action', 'reenvie o link')!
    await act(async () => {
      gatilho.click()
    })

    const input = container.querySelector('#set-verify-email') as HTMLInputElement
    expect(input).not.toBeNull()
    // Muda o valor pelo caminho que o React escuta.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    await act(async () => {
      setter.call(input, 'pessoa@exemplo.test')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const form = input.closest('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const pedido = chamadas.find((c) => c.url.includes('/api/auth/email-verification/request'))
    expect(pedido, 'o endpoint de reenvio não foi chamado').toBeDefined()
    expect(pedido!.body).toEqual({ email: 'pessoa@exemplo.test' })
  })

  it('a confirmação é GENÉRICA — o 202 fixo existe para não revelar a conta', async () => {
    await render({ emailVerified: false })
    const gatilho = porTexto('.set-row--action', 'reenvie o link')!
    await act(async () => {
      gatilho.click()
    })
    const input = container.querySelector('#set-verify-email') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    await act(async () => {
      setter.call(input, 'pessoa@exemplo.test')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const texto = container.textContent ?? ''
    expect(texto).toContain('Se este e-mail estiver cadastrado')
    // Afirmar o envio revelaria que a conta existe e está pendente.
    expect(texto).not.toMatch(/\benviamos o link\b|\be-mail enviado\b/i)
  })
})

describe('e-mail JÁ verificado: nada de ação inútil', () => {
  it('não há gatilho de reenvio', async () => {
    await render({ emailVerified: true })
    expect(porTexto('.set-row--action', 'reenvie o link')).toBeNull()
    expect(container.querySelector('#set-verify-email')).toBeNull()
  })

  it('o estado continua visível como valor', async () => {
    await render({ emailVerified: true })
    expect(container.textContent).toContain('Verificado')
  })
})
