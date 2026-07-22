'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Formulario de nova senha para o link de RECUPERACAO.
 *
 * Diferenca em relacao a verificacao: aqui NAO se confirma na montagem. Consumir
 * o token automaticamente queimaria o link antes de o usuario digitar a senha —
 * e o token e de uso unico. Ele fica em memoria ate o envio.
 *
 * O token e retirado da barra de enderecos assim que a pagina monta, pelos
 * mesmos motivos da pagina de verificacao (historico, copia/cola, `Referer`).
 */

type Estado = 'pronto' | 'enviando' | 'concluido' | 'recusado' | 'sem-token'

/** Espelha PASSWORD_POLICY.minLength do dominio; a validacao real e no servidor. */
const SENHA_MIN = 10

export function PasswordResetTokenForm(): React.ReactElement {
  const [estado, setEstado] = useState<Estado>('pronto')
  const [senha, setSenha] = useState('')
  // Fica em `ref`, nao em estado: nao ha motivo para o token participar de
  // renderizacao, e assim ele nunca vira valor de atributo do DOM.
  const token = useRef<string | null>(null)
  // StrictMode monta duas vezes em desenvolvimento. Sem esta trava, a primeira
  // montagem capturaria o token e o removeria da URL, e a segunda leria uma URL
  // ja limpa e concluiria "sem-token" — descartando um link perfeitamente
  // valido que continua em `token.current`.
  const jaCapturado = useRef(false)

  useEffect(() => {
    if (jaCapturado.current) return
    jaCapturado.current = true

    const url = new URL(window.location.href)
    const recebido = url.searchParams.get('token')
    if (recebido === null || recebido.length === 0) {
      setEstado('sem-token')
      return
    }
    token.current = recebido
    url.searchParams.delete('token')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (token.current === null || estado === 'enviando') return
    setEstado('enviando')
    try {
      const response = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.current, newPassword: senha }),
      })
      setEstado(response.ok ? 'concluido' : 'recusado')
    } catch {
      setEstado('recusado')
    }
  }

  if (estado === 'sem-token') {
    return <p role="alert">Link incompleto. Abra o link exatamente como recebeu no e-mail.</p>
  }
  if (estado === 'concluido') {
    return (
      <p role="status">
        Senha redefinida. Todas as sessoes anteriores foram encerradas; entre novamente com a
        nova senha.
      </p>
    )
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="nova-senha">Nova senha</label>
      <input
        id="nova-senha"
        name="nova-senha"
        type="password"
        autoComplete="new-password"
        minLength={SENHA_MIN}
        required
        value={senha}
        onChange={(event) => setSenha(event.target.value)}
      />
      <p>Use ao menos {SENHA_MIN} caracteres.</p>
      <button type="submit" disabled={estado === 'enviando'}>
        {estado === 'enviando' ? 'Redefinindo...' : 'Redefinir minha senha'}
      </button>
      {estado === 'recusado' ? (
        <p role="alert">
          Nao foi possivel redefinir. O link pode ter expirado ou ja ter sido usado. Solicite um
          novo.
        </p>
      ) : null}
    </form>
  )
}
