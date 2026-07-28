import type { Metadata } from 'next'

import { AuthShell } from '../entrar/auth-shell'
import { SignupForm } from './signup-form'

/**
 * Criar conta — tela 16 do canônico (modo Cadastrar): mesmo card central com
 * tabs, formulário real do C7D (consentimento explícito LGPD). `noindex`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Criar conta',
  robots: { index: false, follow: false },
}

export default function CriarContaPage() {
  return (
    <main data-vertical="account">
      <h1 className="visually-hidden">Criar conta na Cinerie</h1>
      <AuthShell active="criar" lede="Crie sua conta para acompanhar filmes, séries e listas">
        <SignupForm />
      </AuthShell>
    </main>
  )
}
