'use client'

/**
 * Superficies de publicidade do handoff: pop-up (tela 17) e interstitial de
 * tela cheia (tela 18). Componentes CONTROLADOS — nunca disparam sozinhos:
 * nao ha logica de frequencia contratada nesta fase, entao eles so abrem
 * quando o chamador manda (`open`), e nada no app os invoca automaticamente.
 *
 * Acessibilidade obrigatoria (EX-17/18-ad):
 *  - <dialog> nativo: foco preso, Escape fecha, foco retorna ao invocador;
 *  - botao de fechar com aria-label, alvo >= 44px;
 *  - rotulo "PUBLICIDADE" sempre visivel;
 *  - sem loop, sem trap, sem dark pattern.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { AdSlot } from './ad-slot'

function useDialogOpen(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    const handler = () => onClose()
    dialog.addEventListener('close', handler)
    return () => dialog.removeEventListener('close', handler)
  }, [onClose])
  return ref
}

/** Tela 17 — anuncio pop-up (rectangle 300x250 centrado). */
export function AdPopup({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Publicidade" className="ad-modal" ref={ref}>
      <div className="ad-modal__bar">
        <span className="ad-slot__label">Publicidade</span>
        <button aria-label="Fechar publicidade" className="icon-btn" onClick={onClose} type="button">
          <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </button>
      </div>
      <AdSlot format="rectangle" slotId="ad-pop" />
    </dialog>
  )
}

/** Tela 18 — interstitial de tela cheia (billboard). */
export function AdInterstitial({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Publicidade em tela cheia" className="ad-modal" ref={ref}>
      <div className="ad-modal__bar">
        <span className="ad-slot__label">Publicidade</span>
        <button
          aria-label="Pular publicidade"
          className="btn btn--outline btn--sm"
          onClick={onClose}
          type="button"
        >
          Pular
        </button>
      </div>
      <AdSlot format="billboard" slotId="ad-tela" />
    </dialog>
  )
}
