/**
 * dialog-behavior.ts — As decisões de um diálogo modal, PURAS.
 *
 * POR QUE ELAS SAEM DO COMPONENTE. Laço de foco e trava de scroll são as duas
 * partes de um modal que mais quebram em refactor e menos aparecem quando
 * quebram: o modal continua abrindo e fechando, e só quem navega por teclado
 * descobre que o Tab escapou para a página atrás. Aqui elas são funções com
 * entrada e saída — dá para afirmar "Shift+Tab no primeiro item vai para o
 * último" sem abrir navegador, e dá para quebrar a regra e ver o teste reprovar.
 */

/**
 * O que uma tecla significa para um diálogo ABERTO.
 *
 * `null` = a tecla não é do diálogo; o componente não deve interceptá-la (senão
 * o modal engoliria digitação alheia).
 */
export type DialogKeyAction = 'close' | 'focus-next' | 'focus-previous'

export function dialogKeyAction(key: string, shiftKey: boolean): DialogKeyAction | null {
  if (key === 'Escape' || key === 'Esc') return 'close'
  if (key === 'Tab') return shiftKey ? 'focus-previous' : 'focus-next'
  return null
}

/**
 * Índice do próximo foco dentro do laço.
 *
 * `current === -1` significa "o foco está fora da lista" (aconteceu de alguém
 * clicar no fundo, ou de um elemento sumir): Tab entra no primeiro, Shift+Tab
 * no último. Sem esse caso, o foco perdido nunca voltaria para dentro.
 */
export function nextFocusIndex(current: number, total: number, backwards: boolean): number {
  if (total <= 0) return 0
  if (current < 0) return backwards ? total - 1 : 0
  const delta = backwards ? -1 : 1
  return (current + delta + total) % total
}

/**
 * Quanto de `padding-right` o `<body>` precisa quando a barra de rolagem some.
 *
 * Travar o scroll com `overflow:hidden` remove a barra; sem compensar a largura
 * dela, o documento alarga e a página inteira SALTA para o lado no instante em
 * que o modal abre. Em sistema com barra sobreposta (macOS, celular) a diferença
 * é 0 e nada é aplicado.
 *
 * Valor negativo ou não-finito devolve 0: melhor não compensar do que empurrar
 * a página para o lado errado.
 */
export function scrollbarCompensation(innerWidth: number, clientWidth: number): number {
  const diff = innerWidth - clientWidth
  if (!Number.isFinite(diff) || diff <= 0) return 0
  return diff
}

/**
 * Seletor dos elementos que participam do laço de foco.
 *
 * `[tabindex="-1"]` fica de fora de propósito: é o marcador de "focável por
 * código, não por Tab".
 */
export const DIALOG_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'
