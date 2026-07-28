'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

import { AdInterstitial, AdPopup } from '../../_components/ad-surfaces'

/** Painel de QA: abre as superfícies 17/18 sob demanda (nunca automático). */
export function AdPreviewPanel(): ReactNode {
  const [popupAberto, setPopupAberto] = useState(false)
  const [telaAberta, setTelaAberta] = useState(false)
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
      <button className="imp-primary" onClick={() => setPopupAberto(true)} type="button">
        Abrir tela 17 — pop-up
      </button>
      <button className="imp-secondary" onClick={() => setTelaAberta(true)} type="button">
        Abrir tela 18 — tela cheia
      </button>
      <AdPopup onClose={() => setPopupAberto(false)} open={popupAberto} />
      <AdInterstitial onClose={() => setTelaAberta(false)} open={telaAberta} />
    </div>
  )
}
