import type { Metadata } from 'next'

import { ListsPanel } from './lists-panel'

/**
 * Minhas listas (C8) — Listas personalizadas do titular.
 *
 * Superficie funcional MINIMA: reusa o shell existente, sem redesenho e sem
 * fidelidade ao handoff visual (isso e do superprompt de frontend). noindex:
 * area privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Minhas listas',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Minhas listas</h1>
        </header>
        <ListsPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
