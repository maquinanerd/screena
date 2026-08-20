// @vitest-environment jsdom

/**
 * continue-watching-anonymous.test.tsx — seção pessoal some para deslogado, e
 * aparece para logado. NOS DOIS SENTIDOS.
 *
 * A DECISÃO. Seção que não pode ter sucesso não renderiza — a mesma regra da
 * faixa de newsletter. "Continuar assistindo" é pessoal: para quem não entrou,
 * ela não tem o que mostrar e nunca terá, então não vira caixa vazia nem
 * esqueleto mudo. Para quem entrou E não tem histórico é outra coisa: ali ela
 * PODE ter sucesso, e o estado vazio honesto é a resposta certa.
 *
 * POR QUE OS DOIS SENTIDOS. Um teste que só provasse "some para deslogado"
 * ficaria verde com o componente devolvendo `null` sempre — apagando a seção
 * para todo mundo. Um que só provasse "aparece para logado" ficaria verde com o
 * defeito original. Cada metade guarda a outra.
 *
 * A ausência não é muda: a linha de log sai no MESMO formato do servidor
 * (`section_absent`, JSON filtrável) — e este arquivo também mede isso, porque
 * "sumiu calado" é o defeito que `section-absence.ts` existe para impedir.
 *
 * O componente é client e a condição só existe DEPOIS do mount; por isso aqui
 * há `createRoot` + `act`, e não `renderToStaticMarkup`.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ContinueWatching } from '../continue-watching'

const ROUTE = '/pt/explorar/'

interface FetchPlan {
  authenticated: boolean
  libraryItems?: Array<{ entityType: 'movie' | 'tv'; entityId: string; status: string }>
}

/** Responde só o que o componente pede, na ordem em que ele pede. */
function stubFetch(plan: FetchPlan): void {
  const json = (body: unknown) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response)

  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/session')) return json({ authenticated: plan.authenticated })
    if (url.includes('/api/me/library')) return json({ items: plan.libraryItems ?? [] })
    if (url.includes('/api/catalog/summary')) {
      return json({
        items: (plan.libraryItems ?? []).map((item) => ({
          entityType: item.entityType,
          entityId: item.entityId,
          title: `Título ${item.entityId}`,
          href: `/pt/filmes/titulo-${item.entityId}/`,
          backdropUrl: null,
          posterUrl: null,
        })),
      })
    }
    return json({})
  })
}

let container: HTMLDivElement
let root: Root

async function render(plan: FetchPlan): Promise<void> {
  stubFetch(plan)
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<ContinueWatching route={ROUTE} />)
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

describe('deslogado: a seção INTEIRA não aparece', () => {
  it('não há seção, nem cabeçalho, nem caixa vazia', async () => {
    await render({ authenticated: false })
    // O cabeçalho é o que denuncia "esqueleto mudo": se ele estiver lá com o
    // corpo vazio, o defeito voltou.
    expect(container.querySelector('section')).toBeNull()
    expect(container.querySelector('#disc-cw-title')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('a ausência NÃO é muda: sai uma linha de log no formato do servidor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await render({ authenticated: false })

    const linhas = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('section_absent'))
    expect(linhas).toHaveLength(1)

    const evento = JSON.parse(linhas[0]!) as Record<string, unknown>
    expect(evento.event).toBe('section_absent')
    expect(evento.section).toBe('continuar-assistindo')
    expect(evento.reason).toBe('no_authenticated_visitor')
    expect(evento.route).toBe(ROUTE)
    // Fato sobre o REQUEST, não passo pendente: a maioria dos pageviews é
    // anônima e marcar isso como acionável afogaria o log.
    expect(evento.actionable).toBe(false)
  })
})

describe('logado: a seção aparece', () => {
  it('com histórico, o cabeçalho e os cartões estão lá', async () => {
    await render({
      authenticated: true,
      libraryItems: [{ entityType: 'movie', entityId: '7', status: 'watching' }],
    })
    expect(container.querySelector('section')).not.toBeNull()
    expect(container.querySelector('#disc-cw-title')?.textContent).toContain('Continuar')
    expect(container.querySelectorAll('.cw-card')).toHaveLength(1)
  })

  it('SEM histórico, a seção existe com estado vazio honesto', async () => {
    // Aqui ela PODE ter sucesso — some-la esconderia do usuário o caminho.
    await render({ authenticated: true, libraryItems: [] })
    expect(container.querySelector('section')).not.toBeNull()
    expect(container.querySelector('#disc-cw-title')).not.toBeNull()
    expect(container.querySelectorAll('.cw-card')).toHaveLength(0)
    expect(container.textContent).toContain('Nada em andamento ainda')
  })

  it('logado NÃO emite ausência — o log só existe quando o bloco some', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await render({ authenticated: true, libraryItems: [] })
    const linhas = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('section_absent'))
    expect(linhas).toHaveLength(0)
  })
})
