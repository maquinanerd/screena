import type { Metadata } from 'next'

import { AuthShell } from './auth-shell'
import { LoginForm } from './login-form'

/**
 * Entrar — tela 16 do canônico: card central com tabs Entrar/Criar conta,
 * formulário real do C7D e skyscraper de publicidade. `noindex`: página
 * transacional de conta.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Entrar',
  robots: { index: false, follow: false },
}

export default function EntrarPage() {
  return (
    <main data-vertical="account">
      <h1 className="visually-hidden">Entrar na Cinerie</h1>
      <AuthShell active="entrar" lede="Entre para acompanhar filmes, séries e listas">
        <LoginForm />
        <p className="auth-links">
          <a href="/pt/recuperar-senha/">Esqueci minha senha</a>
        </p>
      </AuthShell>
    </main>
  )
}
