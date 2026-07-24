import type { Metadata } from 'next'

import { LoginForm } from './login-form'

/**
 * Pagina de LOGIN (C7D).
 *
 * Superficie funcional MINIMA — nao e o frontend visual final (esse e o
 * superprompt do frontend). Reusa o shell existente. `noindex`: pagina
 * transacional de conta, nao entra no indice.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Entrar',
  robots: { index: false, follow: false },
}

export default function EntrarPage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Entrar na Cinerie</h1>
        </header>
        <LoginForm />
        <p>
          Ainda nao tem conta? <a href="/pt/criar-conta">Criar conta</a>
        </p>
        <p>
          <a href="/pt/recuperar-senha">Esqueci minha senha</a>
        </p>
      </div>
    </main>
  )
}
