'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Captura o token da URL, REMOVE-O da barra de enderecos e confirma via POST.
 *
 * Por que remover o token da URL logo na montagem:
 *  - a barra de enderecos e copiada, colada e compartilhada;
 *  - o valor fica no historico do navegador mesmo depois do uso;
 *  - qualquer navegacao seguinte poderia leva-lo num `Referer`.
 * `replaceState` troca a entrada atual do historico, sem recarregar e sem criar
 * uma entrada nova — o botao "voltar" nao traz o token de volta.
 *
 * A confirmacao e um POST: link de e-mail abre PAGINA, e pagina faz mutacao.
 * Um `GET` que consumisse o token seria disparado por qualquer pre-fetch de
 * cliente de e-mail ou antivirus, queimando o link antes de o usuario clicar.
 */

type Estado = 'confirmando' | 'confirmado' | 'recusado' | 'sem-token'

export function EmailVerificationTokenForm(): React.ReactElement {
  const [estado, setEstado] = useState<Estado>('confirmando')
  // StrictMode monta duas vezes em desenvolvimento; sem esta trava o token
  // seria consumido na primeira e a segunda mostraria "recusado".
  const jaEnviado = useRef(false)

  const confirmar = useCallback(async (token: string) => {
    try {
      const response = await fetch('/api/auth/email-verification/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setEstado(response.ok ? 'confirmado' : 'recusado')
    } catch {
      setEstado('recusado')
    }
  }, [])

  useEffect(() => {
    if (jaEnviado.current) return
    jaEnviado.current = true

    const url = new URL(window.location.href)
    const token = url.searchParams.get('token')
    if (token === null || token.length === 0) {
      setEstado('sem-token')
      return
    }

    url.searchParams.delete('token')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)

    void confirmar(token)
  }, [confirmar])

  if (estado === 'confirmando') {
    return <p role="status">Confirmando seu e-mail...</p>
  }
  if (estado === 'confirmado') {
    return <p role="status">E-mail confirmado. Voce ja pode fechar esta pagina.</p>
  }
  if (estado === 'sem-token') {
    return <p role="alert">Link incompleto. Abra o link exatamente como recebeu no e-mail.</p>
  }
  return (
    <p role="alert">
      Link invalido ou expirado. Solicite um novo e-mail de confirmacao.
    </p>
  )
}
