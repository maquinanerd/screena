// @vitest-environment jsdom

/**
 * youtube-facade.test.tsx — O embed do corpo de matéria, e o defeito que ele
 * carregava.
 *
 * O DEFEITO. O bloco `embed` de `article-body.tsx` tinha, acima do código, um
 * comentário afirmando: "o `<iframe>` do YouTube só entra no DOM depois que a
 * pessoa aperta — enquanto isso há um cartão estático nosso. O `srcDoc` faz a
 * troca sem JavaScript nosso". Nada disso existia. O código renderizava
 * `<iframe src={playerUrl} loading="lazy">` direto: bastava rolar até o bloco
 * para o YouTube ser contatado, sem clique nenhum, em página indexável. Não há
 * `srcDoc` em lugar nenhum do `apps/web`.
 *
 * POR QUE ISSO IMPORTAVA ALÉM DO COMENTÁRIO. O §6 da política de privacidade
 * publicada afirma que nada carrega sem autorização. Enquanto o embed da
 * matéria carregasse sozinho, essa frase era falsa para toda matéria com vídeo.
 *
 * Este arquivo é a promessa virando teste. Sem ambiente de DOM — que o
 * repositório não tinha até esta PR — nenhum teste poderia tê-la verificado.
 */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { YouTubeFacade } from '../youtube-frame'

const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<YouTubeFacade embedUrl={EMBED} title="Trailer" watchUrl={WATCH} />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function activate(): void {
  act(() => {
    container.querySelector<HTMLButtonElement>('.yt-facade__button')?.click()
  })
}

describe('antes do clique: nada de terceiro', () => {
  it('NEGATIVO — nenhum ENDEREÇO do YouTube no documento montado', () => {
    // A medida é o ENDEREÇO, não a palavra: o cartão de ativação diz "YouTube"
    // em texto visível de propósito, para o leitor saber o que vai carregar.
    // Texto não faz requisição; URL faz. Isto cobre iframe, script, preconnect
    // e imagem de uma vez.
    const html = document.documentElement.outerHTML.toLowerCase()
    expect(html).not.toContain('youtube-nocookie.com')
    expect(html).not.toContain('//www.youtube.com')
    expect(container.querySelectorAll('iframe')).toHaveLength(0)
    expect(container.querySelectorAll('script')).toHaveLength(0)
  })

  it('CONTROLE POSITIVO: o cartão de ativação está lá, e diz o que vai acontecer', () => {
    // Sem isto, um componente que não renderizasse nada passaria acima.
    const button = container.querySelector<HTMLButtonElement>('.yt-facade__button')
    expect(button).not.toBeNull()
    expect(button?.textContent).toContain('Carregar vídeo')
    expect(button?.textContent).toContain('O player do YouTube só carrega ao clicar aqui')
  })
})

describe('depois do clique: o player entra, e só então', () => {
  it('o iframe nasce no clique, com a URL nocookie', () => {
    activate()
    const iframe = container.querySelector('iframe')
    expect(iframe?.getAttribute('src')).toBe(EMBED)
  })

  it('o player recebe a PROPRIA origem: sandbox COM allow-same-origin', () => {
    // Este teste afirmava o contrario, e a afirmacao custava o player inteiro:
    // sem `allow-same-origin` o iframe recebe origem OPACA e o YouTube fica
    // isolado DELE MESMO — retangulo preto, e o relogio de 8s caindo no aviso
    // de falha. Medido em 28/08/2026 na materia do trailer em LEGO.
    //
    // Nada nosso e afrouxado: o player esta em `youtube-nocookie.com`, outra
    // origem, e a politica de mesma origem ja o mantem longe do nosso cookie e
    // do nosso storage — com sandbox ou sem.
    activate()
    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).toContain('allow-same-origin')
  })

  it('o player continua sem poder navegar a pagina que o hospeda', () => {
    // O que o sandbox precisa continuar segurando: `allow-top-navigation` fora
    // da lista impede que o conteudo de terceiro troque a pagina do leitor.
    activate()
    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox') ?? ''
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(sandbox).not.toContain('allow-forms')
  })

  it('o cartão de ativação sai quando o player entra', () => {
    activate()
    expect(container.querySelector('.yt-facade__button')).toBeNull()
  })
})
