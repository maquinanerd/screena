import type { Metadata } from 'next'

import { AuthShell } from '../entrar/auth-shell'
import { PasswordResetTokenForm } from './token-form'

/**
 * Pagina que recebe o link de RECUPERACAO DE SENHA (C7C).
 *
 * Shell tecnico minimo: sem dado de catalogo, sem PostgreSQL, sem API externa.
 * Captura o token da URL, remove-o da barra de enderecos e envia a nova senha
 * por POST.
 *
 * SEO: `noindex, nofollow` e sem canonical — pagina transacional, so faz sentido
 * com um token de uso unico. `referrer: no-referrer` impede que o token, que
 * chega na query, escape pelo cabecalho `Referer`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Redefinicao de senha',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function RedefinirSenhaPage() {
  return (
    <main data-vertical="account">
      <h1 className="visually-hidden">Redefinicao de senha</h1>
      <AuthShell active="entrar" lede="Defina uma nova senha para sua conta" showTabs={false}>
        <PasswordResetTokenForm />
      </AuthShell>
    </main>
  )
}
