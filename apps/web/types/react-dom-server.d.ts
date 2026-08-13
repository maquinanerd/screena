/**
 * react-dom-server.d.ts — Tipagem mínima de `react-dom/server` para os testes
 * de componente.
 *
 * O projeto não tem `@types/react-dom` instalado, e os testes de marcação
 * (`ratings-panel.test.tsx`, `section-boundary.test.tsx`) precisam de
 * `renderToStaticMarkup` para provar contenção do crédito no DOM. Declarar as
 * duas funções que usamos é mais barato e mais previsível do que acrescentar
 * uma dependência de tipos ao workspace inteiro.
 *
 * Deliberadamente ESTREITO: só o que os testes chamam. Se um teste futuro
 * precisar de streaming (`renderToPipeableStream`), acrescente aqui — e não com
 * um `declare module 'react-dom/server'` vazio, que devolveria `any` e apagaria
 * a checagem de tipos justamente onde ela ainda funciona.
 */
declare module 'react-dom/server' {
  import type { ReactNode } from 'react'

  export function renderToStaticMarkup(element: ReactNode): string
  export function renderToString(element: ReactNode): string
}
