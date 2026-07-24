import type { Metadata } from 'next'

import { SignupForm } from './signup-form'

/**
 * Pagina de CADASTRO (C7D). Superficie funcional minima. `noindex`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Criar conta',
  robots: { index: false, follow: false },
}

export default function CriarContaPage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Criar conta na Cinerie</h1>
        </header>
        <SignupForm />
        <p>
          Ja tem conta? <a href="/pt/entrar">Entrar</a>
        </p>
      </div>
    </main>
  )
}
