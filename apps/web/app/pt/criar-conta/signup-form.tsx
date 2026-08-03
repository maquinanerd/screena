'use client'

import { useState } from 'react'

import { PRIVACY_PATH, TERMS_PATH } from '../../../src/lib/routes'

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
      <p className="alert alert--success" role="status">
        Se este e-mail ainda não tiver conta, enviamos um link de verificação. Confira sua caixa de
        entrada.
      </p>
    )
  }

  return (
    <form onSubmit={enviar}>
      <div className="auth-field">
        <label className="auth-field__label" htmlFor="nome">
          Nome (opcional)
        </label>
        <input
          autoComplete="name"
          className="auth-field__input"
          id="nome"
          name="nome"
          onChange={(event) => setNome(event.target.value)}
          placeholder="Seu nome"
          type="text"
          value={nome}
        />
      </div>

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
          autoComplete="new-password"
          className="auth-field__input"
          id="senha"
          minLength={SENHA_MIN}
          name="senha"
          onChange={(event) => setSenha(event.target.value)}
          required
          type="password"
          value={senha}
        />
        <p className="auth-field__hint">Use ao menos {SENHA_MIN} caracteres.</p>
      </div>

      <div className="auth-consents">
        <label className="auth-check">
          <input
            checked={aceitouTermos}
            onChange={(event) => setAceitouTermos(event.target.checked)}
            type="checkbox"
          />
          <span>
            Li e aceito os <a href={TERMS_PATH}>Termos de Uso</a> e a{' '}
            <a href={PRIVACY_PATH}>Política de Privacidade</a>.
          </span>
        </label>

        <label className="auth-check">
          <input
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
            type="checkbox"
          />
          <span>Quero receber novidades por e-mail (opcional).</span>
        </label>

        <label className="auth-check">
          <input
            checked={analytics}
            onChange={(event) => setAnalytics(event.target.checked)}
            type="checkbox"
          />
          <span>Permitir análise de uso para melhorar recomendações (opcional).</span>
        </label>
      </div>

      <button className="auth-cta" disabled={estado === 'enviando' || !aceitouTermos} type="submit">
        {estado === 'enviando' ? 'Criando…' : 'Criar conta'}
      </button>

      {estado === 'erro' ? (
        <p className="alert alert--error" role="alert">
          Não foi possível concluir o cadastro. Verifique os dados e tente de novo.
        </p>
      ) : null}
    </form>
  )
}
