import type { Metadata } from 'next'

import { EmailVerificationTokenForm } from './token-form'

/**
 * Pagina que recebe o link de VERIFICACAO DE E-MAIL (C7C).
 *
 * Shell tecnico minimo, como a busca: sem trabalho de design, sem dado de
 * catalogo, sem PostgreSQL e sem API externa. Ela existe para capturar o token
 * da URL e disparar o POST de confirmacao.
 *
 * SEO: `noindex, nofollow` — e uma pagina transacional que so faz sentido com um
 * token de uso unico na URL; indexa-la nao serviria a ninguem e colocaria a rota
 * (com query) no radar de crawlers. Nao ha canonical: nao existe versao
 * canonica publica desta pagina.
 *
 * `referrer: no-referrer` fecha o vazamento classico: o token viaja na query, e
 * sem esta politica qualquer recurso carregado pela pagina o entregaria no
 * cabecalho `Referer`.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirmacao de e-mail',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function VerificarEmailPage() {
  return (
    <main data-vertical="account">
      <div className="container">
        <header>
          <h1>Confirmacao de e-mail</h1>
        </header>
        <EmailVerificationTokenForm />
      </div>
    </main>
  )
}
