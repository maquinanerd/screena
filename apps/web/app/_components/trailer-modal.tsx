'use client'

/**
 * trailer-modal.tsx — O botão "Assistir ao trailer" e o diálogo que ele abre.
 *
 * UM COMPONENTE PARA AS TRÊS ROTAS. `/pt/`, `/pt/filmes/` e `/pt/series/` usam
 * o mesmo trilho (`HomeLike`), então usam este mesmo modal. Não há cópia por
 * rota — dois modais divergiriam no primeiro conserto.
 *
 * O CLIQUE NO BOTÃO É O CONSENTIMENTO. Enquanto o modal está fechado não existe
 * `<iframe>`, nem `<script>`, nem requisição a domínio do YouTube: o diálogo
 * inteiro (e portanto o player) só é montado depois do clique. Visitar a home
 * não contata terceiro nenhum. Isso não é otimização — é o que sustenta o §6 da
 * política de privacidade publicada.
 *
 * PORTAL, E POR QUÊ. `.glimpse-card` tem `overflow: hidden`; um diálogo
 * renderizado ali dentro seria recortado pelo próprio card. O portal leva o
 * diálogo para o `<body>`, fora de qualquer contexto de empilhamento do trilho.
 *
 * FOCO. Ao abrir, vai para o botão de fechar. Enquanto aberto, Tab circula
 * DENTRO do diálogo. Ao fechar — por ESC, por clique no fundo ou pelo botão —
 * volta para o botão que abriu. Sem essa volta, quem usa teclado é despejado no
 * começo do documento e perde o lugar na página; é a parte que mais quebra em
 * refactor, e por isso é a que tem teste próprio.
 *
 * A decisão de teclado e a circulação de foco NÃO moram aqui: são puras e vivem
 * em `src/lib/dialog-behavior.ts`, testadas sozinhas.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

import { YouTubeFrame } from './youtube-frame'
import {
  DIALOG_FOCUSABLE_SELECTOR,
  dialogKeyAction,
  nextFocusIndex,
  scrollbarCompensation,
} from '../../src/lib/dialog-behavior'
import type { TrailerView } from '../../src/lib/trailer-presenter'

export interface TrailerModalProps {
  /** Título da obra — entra no rótulo do botão E no nome acessível do diálogo. */
  title: string
  /** Trailer JÁ aprovado pelo gate de licença. */
  trailer: TrailerView
  /**
   * Classe do BOTÃO que abre o diálogo. Default: o play do card da home.
   *
   * O bloco de mídia do detalhe (telas 06/07) tem geometria própria — o play
   * fica sobre uma imagem de 472px, não sobre um card de trilho. O DIÁLOGO em
   * si não muda: é o mesmo componente, com o mesmo laço de foco, a mesma trava
   * de scroll e o mesmo gate de clique. Só o gatilho se veste diferente.
   */
  triggerClassName?: string
}

export function TrailerModal({
  title,
  trailer,
  triggerClassName = 'glimpse-card__play',
}: TrailerModalProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const accessibleName = `Trailer de ${title}`

  useEffect(() => {
    setMounted(true)
  }, [])

  /**
   * Fechar é UM caminho só. ESC, clique no fundo e botão de fechar chamam esta
   * função — se cada um fizesse o seu, um deles esqueceria de devolver o foco.
   */
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Trava do scroll com compensação da barra: sem o padding, esconder a barra
  // alarga o documento e a página inteira salta para o lado ao abrir o modal.
  useEffect(() => {
    if (!open) return
    const { body, documentElement } = document
    const overflowAnterior = body.style.overflow
    const paddingAnterior = body.style.paddingRight
    const compensacao = scrollbarCompensation(window.innerWidth, documentElement.clientWidth)
    body.style.overflow = 'hidden'
    if (compensacao > 0) body.style.paddingRight = `${compensacao}px`
    return () => {
      body.style.overflow = overflowAnterior
      body.style.paddingRight = paddingAnterior
    }
  }, [open])

  // Foco inicial no botão de fechar: é a saída, e é o alvo seguro.
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  // Teclado: ESC fecha; Tab circula dentro do diálogo (laço de foco).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = dialogKeyAction(event.key, event.shiftKey)
      if (action === null) return

      if (action === 'close') {
        event.preventDefault()
        close()
        return
      }

      const dialog = dialogRef.current
      if (dialog === null) return
      const focusables = [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)]
      if (focusables.length === 0) return
      const atual = focusables.indexOf(document.activeElement as HTMLElement)
      const proximo = nextFocusIndex(atual, focusables.length, action === 'focus-previous')
      event.preventDefault()
      focusables[proximo]?.focus()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  const dialog =
    open && mounted
      ? createPortal(
          <div
            className="trailer-backdrop"
            onClick={(event) => {
              // Só o FUNDO fecha. Clique dentro do diálogo borbulha até aqui, e
              // sem esta comparação fechar o modal seria impossível de evitar.
              if (event.target === event.currentTarget) close()
            }}
          >
            <div
              aria-label={accessibleName}
              aria-modal="true"
              className="trailer-dialog"
              ref={dialogRef}
              role="dialog"
            >
              <div className="trailer-dialog__head">
                <p className="trailer-dialog__title">{accessibleName}</p>
                <button
                  aria-label="Fechar o trailer"
                  className="trailer-dialog__close"
                  onClick={close}
                  ref={closeRef}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              </div>
              <YouTubeFrame
                embedUrl={trailer.embedUrl}
                title={accessibleName}
                watchUrl={trailer.watchUrl}
              />
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        aria-label={`Assistir ao trailer de ${title}`}
        className={triggerClassName}
        onClick={() => {
          setOpen(true)
        }}
        ref={triggerRef}
        type="button"
      >
        <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 0 24 24" width="20">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      {dialog}
    </>
  )
}
