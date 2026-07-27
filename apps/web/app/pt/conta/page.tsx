import type { Metadata } from 'next'

import { AccountPanel } from './account-panel'

/**
 * AREA DE CONTA (C7D) — perfil, seguranca (troca de senha, sessoes) e ponte para
 * privacidade.
 *
 * Superficie funcional MINIMA, nao o frontend final. A pagina em si e um shell
 * server-only; toda a interacao (que exige o cookie de sessao e o token CSRF)
 * vive no client component. `noindex`: area privada, nunca no indice.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Minha conta',
  robots: { index: false, follow: false },
}

export default function ContaPage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Minha conta</h1>
        </header>
        <AccountPanel />
        {/* C8 — atalhos para a biblioteca pessoal. */}
        <nav aria-label="Minha biblioteca">
          <ul>
            <li>
              <a href="/pt/minha-lista">Minha biblioteca</a>
            </li>
            <li>
              <a href="/pt/listas">Minhas listas</a>
            </li>
            <li>
              <a href="/pt/tracker">Tracker de series</a>
            </li>
            <li>
              <a href="/pt/historico">Meu historico</a>
            </li>
            <li>
              <a href="/pt/importar">Importar dados</a>
            </li>
          </ul>
        </nav>
        <p>
          <a href="/pt/conta/privacidade">Privacidade e meus dados</a>
        </p>
      </div>
    </main>
  )
}
