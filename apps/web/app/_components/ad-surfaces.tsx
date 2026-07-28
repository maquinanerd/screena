'use client'

/**
 * Superfícies de publicidade do canônico: pop-up (tela 17) e interstitial de
 * tela cheia (tela 18), na composição EXATA do handoff 6936a341…:
 *
 *  - 17: scrim rgba(10,10,10,0.9), card branco min(92vw,360px) r10 com
 *    rectangle 300×250, botão ✕ circular preto flutuante (-13px) e link
 *    "Continuar para o site →";
 *  - 18: tela #0B0B0C, "Pular anúncio ›" no topo direito, billboard central
 *    min(90vw,760px) e CTA vermelho "Continuar para Cinerie".
 *
 * Componentes CONTROLADOS — nunca disparam sozinhos: não há contrato de ad
 * server nesta fase, então só abrem quando o chamador manda (`open`) e nada
 * no app os invoca automaticamente. Sem anúncio falso em produção: o creativo
 * é o AdSlot governado (placeholder apenas em dev/QA).
 *
 * Acessibilidade obrigatória (EX-17/18-ad):
 *  - <dialog> nativo: foco preso, Escape fecha, foco retorna ao invocador;
 *  - fechar com aria-label e alvo >= 44px; sem loop, sem trap, sem dark pattern.
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

/** Tela 17 — anúncio pop-up (rectangle 300×250 centrado no card branco). */
export function AdPopup({ open, onClose }: { open: boolean; onClose: () => void }): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Publicidade" className="ad-pop" ref={ref}>
      <div className="ad-pop__card">
        <button aria-label="Fechar publicidade" className="ad-pop__close" onClick={onClose} type="button">
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
          </svg>
        </button>
        <AdSlot format="rectangle" slotId="ad-pop" />
        <button className="ad-pop__continue" onClick={onClose} type="button">
          Continuar para o site&nbsp;→
        </button>
      </div>
    </dialog>
  )
}

/** Tela 18 — interstitial de tela cheia (billboard central + CTA vermelho). */
export function AdInterstitial({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Publicidade em tela cheia" className="ad-tela" ref={ref}>
      <div className="ad-tela__top">
        <button aria-label="Pular publicidade" className="ad-tela__skip" onClick={onClose} type="button">
          Pular anúncio&nbsp;›
        </button>
      </div>
      <div className="ad-tela__media">
        <AdSlot format="billboard" slotId="ad-tela" />
      </div>
      <button className="ad-tela__cta" onClick={onClose} type="button">
        Continuar para Cinerie
      </button>
    </dialog>
  )
}
