import type { Metadata } from 'next'

import { LibraryPanel } from './library-panel'

/**
 * Minha biblioteca (C8) — Quero assistir e assistidos.
 *
 * Superficie funcional MINIMA: reusa o shell existente, sem redesenho e sem
 * fidelidade ao handoff visual (isso e do superprompt de frontend). noindex:
 * area privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Minha biblioteca',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Minha biblioteca</h1>
        </header>
        <LibraryPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
