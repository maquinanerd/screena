import type { Metadata } from 'next'

import { ImportPanel } from './import-panel'

/**
 * Importar dados (C8) — Pre-visualizacao antes de qualquer escrita.
 *
 * Superficie funcional MINIMA: reusa o shell existente, sem redesenho e sem
 * fidelidade ao handoff visual (isso e do superprompt de frontend). noindex:
 * area privada do titular.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Importar dados',
  robots: { index: false, follow: false },
}

export default function Pagina() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Importar dados</h1>
        </header>
        <ImportPanel />
        <p>
          <a href="/pt/conta">Voltar para a conta</a>
        </p>
      </div>
    </main>
  )
}
