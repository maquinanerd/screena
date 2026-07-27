import type { Metadata } from 'next'

import { TrackerPanel } from './tracker-panel'

/**
 * Tracker de series (C8) — Progresso e proximo episodio.
 *
 * Superficie funcional MINIMA: reusa o shell existente, sem redesenho e sem
 * fidelidade ao handoff visual (isso e do superprompt de frontend). noindex:
 * area privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Tracker de series',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Tracker de series</h1>
        </header>
        <TrackerPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
