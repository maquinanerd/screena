'use client'

import { useState } from 'react'

/**
 * Formulario de login (C7D). Envia por POST para `/api/auth/login`; em sucesso o
 * servidor emite os cookies de sessao e CSRF (o cliente nao os manipula) e a
 * pagina redireciona para a area de conta.
 *
 * Mensagem de erro UNICA (anti-enumeracao): o formulario nunca distingue
 * "conta nao existe" de "senha errada" — o servidor tambem nao.
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
      <label htmlFor="email">E-mail</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <label htmlFor="senha">Senha</label>
      <input
        id="senha"
        name="senha"
        type="password"
        autoComplete="current-password"
        required
        value={senha}
        onChange={(event) => setSenha(event.target.value)}
      />

      <button type="submit" disabled={estado === 'enviando'}>
        {estado === 'enviando' ? 'Entrando...' : 'Entrar'}
      </button>

      {estado === 'erro' ? (
        <p role="alert">E-mail ou senha invalidos.</p>
      ) : null}
      {estado === 'bloqueado' ? (
        <p role="alert">Muitas tentativas. Aguarde alguns minutos e tente de novo.</p>
      ) : null}
    </form>
  )
}
