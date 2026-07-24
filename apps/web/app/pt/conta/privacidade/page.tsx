import type { Metadata } from 'next'

import { PrivacyPanel } from './privacy-panel'

/**
 * PRIVACIDADE E MEUS DADOS (C7D) — consentimentos, exportacao e encerramento.
 *
 * Superficie funcional minima. `noindex`: area privada.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Privacidade e meus dados',
  robots: { index: false, follow: false },
}

export default function PrivacidadePage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Privacidade e meus dados</h1>
        </header>
        <PrivacyPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
