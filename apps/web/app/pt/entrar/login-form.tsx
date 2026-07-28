'use client'

import { useState } from 'react'

/**
 * Formulário de login (C7D) na composição da tela 16. Envia por POST para
 * `/api/auth/login`; em sucesso o servidor emite os cookies de sessão e CSRF
 * (o cliente não os manipula) e a página redireciona para a área de conta.
 *
 * Mensagem de erro ÚNICA (anti-enumeração): o formulário nunca distingue
 * "conta não existe" de "senha errada" — o servidor também não.
 */

type Estado = 'pronto' | 'enviando' | 'erro' | 'bloqueado'

export function LoginForm(): React.ReactElement {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [estado, setEstado] = useState<Estado>('pronto')

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (estado === 'enviando') return
    setEstado('enviando')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password: senha }),
      })
      if (response.ok) {
        window.location.assign('/pt/conta')
        return
      }
      setEstado(response.status === 429 ? 'bloqueado' : 'erro')
    } catch {
      setEstado('erro')
    }
  }

  return (
    <form onSubmit={enviar}>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="email">
          E-mail
        </label>
        <input
          autoComplete="username"
          className="auth-field__input"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@email.com"
          required
          type="email"
          value={email}
        />
      </div>

      <div className="auth-field auth-field--last">
        <label className="auth-field__label" htmlFor="senha">
          Senha
        </label>
        <input
          autoComplete="current-password"
          className="auth-field__input"
          id="senha"
          name="senha"
          onChange={(event) => setSenha(event.target.value)}
          required
          type="password"
          value={senha}
        />
      </div>

      <button className="auth-cta" disabled={estado === 'enviando'} type="submit">
        {estado === 'enviando' ? 'Entrando…' : 'Entrar'}
      </button>

      {estado === 'erro' ? (
        <p className="alert alert--error" role="alert">
          E-mail ou senha inválidos.
        </p>
      ) : null}
      {estado === 'bloqueado' ? (
        <p className="alert alert--error" role="alert">
          Muitas tentativas. Aguarde alguns minutos e tente de novo.
        </p>
      ) : null}
    </form>
  )
}
