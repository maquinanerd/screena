import type { Metadata } from 'next'

import { AuthShell } from '../entrar/auth-shell'
import { RecoverRequestForm } from './recover-form'

/**
 * PEDIDO de recuperação de senha (C7C/C7D) no card da tela 16 (sem tabs).
 * Envia o e-mail para o endpoint que responde SEMPRE 202 genérico
 * (anti-enumeração). A confirmação (nova senha) acontece em
 * `/pt/redefinir-senha`, aberta pelo link do e-mail.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Recuperar senha',
  robots: { index: false, follow: false },
}

export default function RecuperarSenhaPage() {
  return (
    <main data-vertical="account">
      <h1 className="visually-hidden">Recuperar senha</h1>
      <AuthShell active="entrar" lede="Recupere o acesso à sua conta" showTabs={false}>
        <RecoverRequestForm />
        <p className="auth-links">
          <a href="/pt/entrar/">Voltar para entrar</a>
        </p>
      </AuthShell>
    </main>
  )
}
