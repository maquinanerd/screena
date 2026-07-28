import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { isProductionRuntime } from '../../../src/lib/runtime-env'
import { AdPreviewPanel } from './preview-panel'

export const metadata: Metadata = {
  title: 'Preview técnica — anúncios',
  robots: { index: false, follow: false },
}

/**
 * Rota técnica de QA visual das telas 17 (pop-up) e 18 (interstitial).
 * NÃO é pública em produção (baseline R-12): em runtime de produção responde
 * 404. As superfícies só exibem o AdSlot governado — nenhum anunciante
 * fictício, nenhum criativo inventado.
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
          Telas 17 (pop-up) e 18 (tela cheia) do canônico. Placeholder aparece apenas com
          NEXT_PUBLIC_AD_SLOTS=placeholder.
        </p>
        <AdPreviewPanel />
      </div>
    </main>
  )
}
