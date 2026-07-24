'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../../src/lib/csrf-client'

/**
 * Painel de privacidade (C7D): consentimentos versionados, exportacao LGPD e
 * encerramento de conta.
 *
 * A retirada de consentimento tem efeito REAL e imediato — a proxima gravacao
 * opcional daquela finalidade ja passa a ser barrada no servidor. Finalidades
 * nao-revogaveis (termos, privacidade) aparecem sem o controle de retirada, com
 * a base legal indicada.
 */

interface ConsentState {
  kind: string
  granted: boolean | null
  policyVersion: string | null
  currentPolicyVersion: string
  legalBasis: string
  revocable: boolean
  needsRenewal: boolean
}

interface PrivacyState {
  consents: ConsentState[]
  requests: { kind: string; status: string; requestedAt: string; processedAt: string | null }[]
  accountStatus: string
}

const LABELS: Record<string, string> = {
  terms_of_service: 'Termos de Uso',
  privacy_policy: 'Politica de Privacidade',
  marketing_email: 'Comunicacoes por e-mail',
  analytics: 'Analise de uso',
}

export function PrivacyPanel(): React.ReactElement {
  const [carregando, setCarregando] = useState(true)
  const [estado, setEstado] = useState<PrivacyState | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function recarregar(): Promise<void> {
    const r = await fetch('/api/account/privacy', { credentials: 'same-origin' })
    if (r.status === 401) {
      window.location.assign('/pt/entrar')
      return
    }
    if (r.ok) {
      const dados = (await r.json()) as { privacy: PrivacyState }
      setEstado(dados.privacy)
    }
  }

  useEffect(() => {
    void (async () => {
      await recarregar()
      setCarregando(false)
    })()
  }, [])

  async function alterarConsent(kind: string, granted: boolean): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/account/consent', {
      method: 'POST',
      body: JSON.stringify({ kind, granted }),
    })
    if (r.ok) {
      await recarregar()
    } else {
      setAviso('Nao foi possivel registrar a decisao.')
    }
  }

  async function exportar(): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/account/export', { method: 'POST' })
    if (!r.ok) {
      setAviso('Nao foi possivel gerar a exportacao agora.')
      return
    }
    // Baixa o JSON como arquivo, no proprio navegador (sem storage no servidor).
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cinerie-meus-dados.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function encerrar(): Promise<void> {
    const senha = window.prompt('Confirme sua senha para encerrar a conta:')
    if (senha === null || senha.length === 0) return
    const r = await authFetch('/api/account/close', {
      method: 'POST',
      body: JSON.stringify({ password: senha }),
    })
    if (r.ok) {
      window.location.assign('/pt/entrar')
    } else {
      setAviso('Nao foi possivel encerrar a conta.')
    }
  }

  if (carregando) return <p role="status">Carregando...</p>
  if (estado === null) return <p role="status">Redirecionando...</p>

  return (
    <div>
      <section aria-labelledby="consent-titulo">
        <h2 id="consent-titulo">Consentimentos</h2>
        <ul>
          {estado.consents.map((c) => (
            <li key={c.kind}>
              <strong>{LABELS[c.kind] ?? c.kind}</strong>{' '}
              {c.revocable ? (
                <label>
                  <input
                    type="checkbox"
                    checked={c.granted === true}
                    onChange={(e) => void alterarConsent(c.kind, e.target.checked)}
                  />
                  {c.granted === true ? 'Concedido' : 'Nao concedido'}
                </label>
              ) : (
                <span> (obrigatorio — base legal: {c.legalBasis})</span>
              )}
              {c.needsRenewal ? <em> — nova versao disponivel</em> : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dados-titulo">
        <h2 id="dados-titulo">Meus dados</h2>
        <p>
          <button type="button" onClick={() => void exportar()}>
            Exportar meus dados
          </button>
        </p>
        <p>
          A exportacao contem apenas seus proprios dados e nunca inclui senhas,
          tokens ou informacoes internas de seguranca.
        </p>
      </section>

      <section aria-labelledby="encerrar-titulo">
        <h2 id="encerrar-titulo">Encerrar conta</h2>
        {estado.accountStatus === 'pending_deletion' ? (
          <p role="status">
            Sua conta esta em processo de encerramento. Para reativa-la dentro do prazo, fale com o
            suporte.
          </p>
        ) : (
          <p>
            <button type="button" onClick={() => void encerrar()}>
              Encerrar minha conta
            </button>
          </p>
        )}
      </section>

      {aviso !== null ? <p role="alert">{aviso}</p> : null}
    </div>
  )
}
