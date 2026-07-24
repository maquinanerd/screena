'use client'

import { useState } from 'react'

/**
 * Formulario de cadastro (C7D).
 *
 * O aceite dos termos e da politica de privacidade e OBRIGATORIO e EXPLICITO —
 * o checkbox nasce DESMARCADO (a LGPD proibe pre-marcado) e o botao so envia com
 * ele marcado. As finalidades opcionais (comunicacao, analytics) tambem nascem
 * desmarcadas.
 *
 * Resposta SEMPRE generica: cadastrar um e-mail ja existente devolve a mesma
 * tela de "verifique seu e-mail" (anti-enumeracao). O servidor garante isso; a
 * UI so reflete.
 */

const SENHA_MIN = 10

type Estado = 'pronto' | 'enviando' | 'enviado' | 'erro'

export function SignupForm(): React.ReactElement {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [aceitouTermos, setAceitouTermos] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [estado, setEstado] = useState<Estado>('pronto')

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (estado === 'enviando' || !aceitouTermos) return
    setEstado('enviando')
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email,
          password: senha,
          displayName: nome.length > 0 ? nome : undefined,
          acceptedTerms: true,
          acceptedMarketingEmail: marketing,
          acceptedAnalytics: analytics,
        }),
      })
      setEstado(response.ok ? 'enviado' : 'erro')
    } catch {
      setEstado('erro')
    }
  }

  if (estado === 'enviado') {
    return (
      <p role="status">
        Se este e-mail ainda nao tiver conta, enviamos um link de verificacao. Confira sua caixa de
        entrada.
      </p>
    )
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="nome">Nome (opcional)</label>
      <input
        id="nome"
        name="nome"
        type="text"
        autoComplete="name"
        value={nome}
        onChange={(event) => setNome(event.target.value)}
      />

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
        autoComplete="new-password"
        minLength={SENHA_MIN}
        required
        value={senha}
        onChange={(event) => setSenha(event.target.value)}
      />
      <p>Use ao menos {SENHA_MIN} caracteres.</p>

      <label>
        <input
          type="checkbox"
          checked={aceitouTermos}
          onChange={(event) => setAceitouTermos(event.target.checked)}
        />
        Li e aceito os <a href="/pt/termos">Termos de Uso</a> e a{' '}
        <a href="/pt/privacidade">Politica de Privacidade</a>.
      </label>

      <label>
        <input
          type="checkbox"
          checked={marketing}
          onChange={(event) => setMarketing(event.target.checked)}
        />
        Quero receber novidades por e-mail (opcional).
      </label>

      <label>
        <input
          type="checkbox"
          checked={analytics}
          onChange={(event) => setAnalytics(event.target.checked)}
        />
        Permitir analise de uso para melhorar recomendacoes (opcional).
      </label>

      <button type="submit" disabled={estado === 'enviando' || !aceitouTermos}>
        {estado === 'enviando' ? 'Criando...' : 'Criar conta'}
      </button>

      {estado === 'erro' ? (
        <p role="alert">Nao foi possivel concluir o cadastro. Verifique os dados e tente de novo.</p>
      ) : null}
    </form>
  )
}
