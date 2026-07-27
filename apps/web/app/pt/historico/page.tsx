import type { Metadata } from 'next'

import { HistoryPanel } from './history-panel'

/**
 * Meu historico (C8) — Consumo explicitamente registrado.
 *
 * Superficie funcional MINIMA: reusa o shell existente, sem redesenho e sem
 * fidelidade ao handoff visual (isso e do superprompt de frontend). noindex:
 * area privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Meu historico',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Meu historico</h1>
        </header>
        <HistoryPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
