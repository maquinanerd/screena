import type { Metadata } from 'next'

import { RecoverRequestForm } from './recover-form'

/**
 * PEDIDO de recuperacao de senha (C7C/C7D). Envia o e-mail para o endpoint que
 * responde SEMPRE 202 generico (anti-enumeracao). A confirmacao (nova senha)
 * acontece na pagina `/pt/redefinir-senha`, aberta pelo link do e-mail.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Recuperar senha',
  robots: { index: false, follow: false },
}

export default function RecuperarSenhaPage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Recuperar senha</h1>
        </header>
        <RecoverRequestForm />
        <p>
          <a href="/pt/entrar">Voltar para entrar</a>
        </p>
      </div>
    </main>
  )
}
