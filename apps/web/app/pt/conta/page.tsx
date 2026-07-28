import type { Metadata } from 'next'

import { SettingsPanel } from './settings-panel'

/**
 * Configurações — tela 13 do canônico. Shell server-only; toda a interação
 * (sessão + CSRF) vive no client panel, que consome os contratos REAIS do
 * C7C/C7D (session, profile, password, logout). `noindex`: área privada.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Configurações',
  robots: { index: false, follow: false },
}

export default function ContaPage() {
  return (
    <main data-vertical="account">
      <SettingsPanel />
    </main>
  )
}
