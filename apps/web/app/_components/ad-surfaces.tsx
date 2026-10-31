'use client'

/**
 * Superfícies de anúncio do canônico: pop-up (tela 17) e interstitial de
 * tela cheia (tela 18):
 *
 *  - 17: scrim rgba(10,10,10,0.9), card branco min(92vw,360px) r10 com o slot
 *    OpaPreço `popup` (product_card_v1 vertical), botão ✕ circular preto
 *    flutuante (-13px) e link "Continuar para o site →";
 *  - 18: tela #0B0B0C, "Pular anúncio ›" no topo direito, slot `interstitial`
 *    (product_hero_v1) central min(90vw,760px) e CTA vermelho "Continuar para
 *    Cinerie".
 *
 * Componentes CONTROLADOS — nunca disparam sozinhos: só abrem quando o
 * chamador manda (`open`) e nada no app os invoca automaticamente. O criativo é
 * o slot OpaPreço; `enabled` vem do servidor (`isOpaPrecoEnabled()`), porque o
 * ambiente é lido no servidor e este componente roda no navegador. Desligado,
 * o slot não monta, e nenhuma oferta é pedida.
 *
 * Acessibilidade obrigatória (EX-17/18-ad):
 *  - <dialog> nativo: foco preso, Escape fecha, foco retorna ao invocador;
 *  - fechar com aria-label e alvo >= 44px; sem loop, sem trap, sem dark pattern.
 */

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { AdSlotClient } from './opapreco/ad-slot-client'

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

interface SurfaceProps {
  readonly open: boolean
  readonly onClose: () => void
  /** O sistema OpaPreço está ligado nesta instalação (decidido no servidor). */
  readonly enabled: boolean
}

/** Tela 17 — anúncio pop-up (card vertical de oferta no cartão branco). */
export function AdPopup({ enabled, onClose, open }: SurfaceProps): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Oferta afiliada" className="ad-pop" ref={ref}>
      <div className="ad-pop__card">
        <button aria-label="Fechar oferta" className="ad-pop__close" onClick={onClose} type="button">
          <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
          </svg>
        </button>
        {enabled && open ? <AdSlotClient id="popup" /> : null}
        <button className="ad-pop__continue" onClick={onClose} type="button">
          Continuar para o site&nbsp;→
        </button>
      </div>
    </dialog>
  )
}

/** Tela 18 — interstitial de tela cheia (hero de oferta central + CTA vermelho). */
export function AdInterstitial({ enabled, onClose, open }: SurfaceProps): ReactNode {
  const ref = useDialogOpen(open, onClose)
  return (
    <dialog aria-label="Oferta afiliada em tela cheia" className="ad-tela" ref={ref}>
      <div className="ad-tela__top">
        <button aria-label="Pular oferta" className="ad-tela__skip" onClick={onClose} type="button">
          Pular anúncio&nbsp;›
        </button>
      </div>
      <div className="ad-tela__media">{enabled && open ? <AdSlotClient id="interstitial" /> : null}</div>
      <button className="ad-tela__cta" onClick={onClose} type="button">
        Continuar para Cinerie
      </button>
    </dialog>
  )
}
