// @vitest-environment jsdom

/**
 * trailer-modal.test.tsx — O modal de trailer, num DOM de verdade.
 *
 * POR QUE ESTE ARQUIVO EXIGIU UM AMBIENTE NOVO. O repositório rodava vitest
 * inteiro em `environment: 'node'`, sem DOM. Isso é suficiente para presenter
 * puro e para marcação estática, e foi o bastante até aqui — mas não alcança
 * NADA do que um modal promete: foco preso, ESC, devolução de foco, iframe que
 * só nasce depois do clique. Não é coincidência que o defeito do embed de
 * matéria (comentário prometendo clique-para-carregar, código carregando
 * sozinho) tenha vivido tanto tempo: não havia teste que pudesse vê-lo.
 * `jsdom` entrou como devDependency para fechar essa lacuna.
 *
 * A PROVA MAIS IMPORTANTE É A NEGATIVA: com o modal fechado, a string
 * "youtube" não aparece em lugar nenhum do documento. Isso cobre `<iframe>`,
 * `<script>`, `<link rel=preconnect>` e `<img>` de uma vez — mais do que
 * procurar por `<iframe>` cobriria.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TrailerModal } from '../trailer-modal'
import type { TrailerView } from '../../../src/lib/trailer-presenter'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const TRAILER: TrailerView = {
  embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  name: 'Trailer oficial',
}

const TITLE = 'Duna: Parte Três'

let container: HTMLDivElement
let root: Root

function mount(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<TrailerModal title={TITLE} trailer={TRAILER} />)
  })
}

/** O botão que abre — o mesmo que deve receber o foco de volta ao fechar. */
function trigger(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('.glimpse-card__play')
  if (button === null) throw new Error('botão de trailer ausente')
  return button
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

function open(): void {
  act(() => {
    trigger().focus()
    trigger().click()
  })
}

function pressKey(key: string, shiftKey = false): void {
  act(() => {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
  })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mount()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
  vi.useRealTimers()
})

describe('fechado: nada de terceiro no documento', () => {
  it('NEGATIVO — a palavra "youtube" não aparece em lugar nenhum antes do clique', () => {
    // Cobre iframe, script, preconnect e imagem de uma vez.
    expect(document.documentElement.outerHTML.toLowerCase()).not.toContain('youtube')
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(dialog()).toBeNull()
  })

  it('CONTROLE POSITIVO: o botão existe e nomeia a obra', () => {
    // Sem isto, um render que não produzisse botão nenhum passaria acima.
    expect(trigger().getAttribute('aria-label')).toBe(`Assistir ao trailer de ${TITLE}`)
  })
})

describe('abrir', () => {
  it('o clique monta o diálogo E o player, e só então', () => {
    open()
    const dlg = dialog()
    expect(dlg).not.toBeNull()
    expect(dlg?.getAttribute('aria-modal')).toBe('true')
    const iframe = document.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(TRAILER.embedUrl)
  })

  it('o nome acessível do diálogo carrega o título da obra', () => {
    open()
    expect(dialog()?.getAttribute('aria-label')).toBe(`Trailer de ${TITLE}`)
  })

  it('o foco entra no diálogo (botão de fechar), não fica no gatilho', () => {
    open()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Fechar o trailer')
    expect(document.activeElement).not.toBe(trigger())
  })

  it('trava o scroll da página enquanto aberto e devolve ao fechar', () => {
    open()
    expect(document.body.style.overflow).toBe('hidden')
    pressKey('Escape')
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})

describe('fechar — os três caminhos, e o foco volta em TODOS', () => {
  it('ESC fecha e devolve o foco ao botão de origem', () => {
    open()
    pressKey('Escape')
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('clique no FUNDO fecha e devolve o foco ao botão de origem', () => {
    open()
    const backdrop = document.querySelector<HTMLElement>('.trailer-backdrop')
    expect(backdrop).not.toBeNull()
    act(() => {
      backdrop?.click()
    })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('o botão de FECHAR fecha e devolve o foco ao botão de origem', () => {
    open()
    const close = document.querySelector<HTMLButtonElement>('.trailer-dialog__close')
    act(() => {
      close?.click()
    })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('CONTROLE NEGATIVO: clique DENTRO do diálogo NÃO fecha', () => {
    // Sem este caso, um backdrop que fechasse com qualquer clique passaria nos
    // três testes acima — e o modal seria impossível de usar.
    open()
    act(() => {
      document.querySelector<HTMLElement>('.trailer-dialog')?.click()
    })
    expect(dialog()).not.toBeNull()
  })

  it('o player sai do documento junto com o diálogo', () => {
    open()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    pressKey('Escape')
    expect(document.querySelectorAll('iframe')).toHaveLength(0)
    expect(document.documentElement.outerHTML.toLowerCase()).not.toContain('youtube')
  })
})

describe('foco preso: Tab circula DENTRO do diálogo', () => {
  it('Tab a partir do último volta ao primeiro; Shift+Tab faz o inverso', () => {
    open()
    const dlg = dialog()
    const focusables = [
      ...(dlg?.querySelectorAll<HTMLElement>('button, iframe, a[href]') ?? []),
    ]
    // CONTROLE POSITIVO: há mais de um focável, senão "circular" não diz nada.
    expect(focusables.length).toBeGreaterThan(1)

    const primeiro = focusables[0]
    const ultimo = focusables[focusables.length - 1]

    act(() => {
      ultimo?.focus()
    })
    pressKey('Tab')
    expect(document.activeElement).toBe(primeiro)

    pressKey('Tab', true)
    expect(document.activeElement).toBe(ultimo)
  })

  it('o foco nunca escapa para o gatilho enquanto o diálogo está aberto', () => {
    open()
    for (let i = 0; i < 6; i += 1) pressKey('Tab')
    expect(document.activeElement).not.toBe(trigger())
    expect(dialog()?.contains(document.activeElement)).toBe(true)
  })
})

describe('player que não carrega: mensagem honesta, nunca vazio', () => {
  it('sem sinal de carga, o frame vira aviso + link para o YouTube', () => {
    vi.useFakeTimers()
    open()
    expect(document.querySelector('iframe')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(9000)
    })

    // O diálogo continua de pé, com texto VISÍVEL e saída real.
    const dlg = dialog()
    expect(dlg).not.toBeNull()
    expect(dlg?.textContent).toContain('Não foi possível carregar o player aqui.')
    const escape = dlg?.querySelector<HTMLAnchorElement>('.yt-frame__escape')
    expect(escape?.getAttribute('href')).toBe(TRAILER.watchUrl)
    expect(escape?.textContent).toBe('Abrir no YouTube')
  })

  it('CONTROLE POSITIVO: com sinal de carga, o aviso NÃO aparece', () => {
    vi.useFakeTimers()
    open()
    act(() => {
      document.querySelector('iframe')?.dispatchEvent(new window.Event('load'))
    })
    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(dialog()?.textContent).not.toContain('Não foi possível carregar')
    expect(document.querySelector('iframe')).not.toBeNull()
  })
})
