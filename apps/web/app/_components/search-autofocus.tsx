'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'

/**
 * Âncora que o ícone de busca do cabeçalho usa (`/pt/explorar/#busca`). Ela é o
 * `id` do campo de busca de Explorar — sem JavaScript, o navegador ao menos rola
 * até o campo; com JavaScript, este componente põe o FOCO nele.
 */
export const SEARCH_INPUT_ID = 'busca'

/**
 * Foca o campo de busca quando a página é aberta PELA lupa.
 *
 * Medido em produção em 23/11/2026: clicar na lupa levava a Explorar com o campo
 * vazio e SEM foco — o leitor digitava "odisseia" e o texto não ia a lugar
 * nenhum; era preciso clicar uma segunda vez no campo. Quem clica na lupa já
 * disse que quer buscar (heurística 7 de Nielsen: atalho para o usuário
 * frequente). Sem `#busca` na URL — navegação comum, link de "Explorar", busca
 * já feita — nada acontece: roubar o foco de quem veio navegar atrapalharia
 * leitor de tela e o teclado no celular.
 */
export function SearchAutofocus(): ReactNode {
  useEffect(() => {
    const focusIfRequested = (): void => {
      if (window.location.hash !== `#${SEARCH_INPUT_ID}`) return
      const input = document.getElementById(SEARCH_INPUT_ID)
      if (input instanceof HTMLInputElement) input.focus({ preventScroll: true })
    }
    focusIfRequested()
    // Já em Explorar, clicar na lupa de novo só troca o hash.
    window.addEventListener('hashchange', focusIfRequested)
    return () => window.removeEventListener('hashchange', focusIfRequested)
  }, [])
  return null
}
