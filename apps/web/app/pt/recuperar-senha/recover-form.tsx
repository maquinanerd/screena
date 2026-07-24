'use client'

import { useState } from 'react'

/**
 * Formulario de PEDIDO de recuperacao.
 *
 * A resposta e SEMPRE a mesma tela de "verifique seu e-mail", exista ou nao a
 * conta — o servidor responde 202 identico (anti-enumeracao) e a UI so reflete.
 */

type Estado = 'pronto' | 'enviando' | 'enviado'

export function RecoverRequestForm(): React.ReactElement {
  const [email, setEmail] = useState('')
  const [estado, setEstado] = useState<Estado>('pronto')

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (estado === 'enviando') return
    setEstado('enviando')
    try {
      await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } finally {
      // Sempre "enviado", mesmo em erro de rede: nao vazamos o desfecho.
      setEstado('enviado')
    }
  }

  if (estado === 'enviado') {
    return (
      <p role="status">
        Se este e-mail tiver uma conta, enviamos as instrucoes de recuperacao. Confira sua caixa de
        entrada.
      </p>
    )
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="email">E-mail da conta</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={estado === 'enviando'}>
        {estado === 'enviando' ? 'Enviando...' : 'Enviar instrucoes'}
      </button>
    </form>
  )
}
