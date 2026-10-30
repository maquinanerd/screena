import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { isOpaPrecoEnabled } from '../../../src/lib/opapreco/config'
import { isProductionRuntime } from '../../../src/lib/runtime-env'
import { AdPreviewPanel } from './preview-panel'
import './ad-preview.css'

export const metadata: Metadata = {
  title: 'Preview técnica — anúncios',
  robots: { index: false, follow: false },
}

/**
 * Rota técnica de QA visual das telas 17 (pop-up) e 18 (interstitial).
 * NÃO é pública em produção (baseline R-12): em runtime de produção responde
 * 404. O criativo é o slot OpaPreço: com OPAPRECO_MODE=fixtures mostra as
 * ofertas fictícias do canônico (recusado na origem oficial); sem configuração,
 * as superfícies abrem sem oferta.
 */
export default function AdPreviewPage() {
  if (isProductionRuntime()) {
    notFound()
  }
  return (
    <main>
      <div className="container" style={{ paddingTop: 36, paddingBottom: 60 }}>
        <h1>Preview técnica — superfícies de anúncio</h1>
        <p className="muted">
          Telas 17 (pop-up) e 18 (tela cheia) do canônico. A oferta aparece com o sistema
          OpaPreço ligado (OPAPRECO_MODE=fixtures para QA).
        </p>
        <AdPreviewPanel adsEnabled={isOpaPrecoEnabled()} />
      </div>
    </main>
  )
}
