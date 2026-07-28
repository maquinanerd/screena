'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { authFetch } from '../../../../src/lib/csrf-client'
import {
  IcAlert,
  IcChat,
  IcDownload,
  IcEye,
  IcGlobe,
  IcLock,
  IcMail,
  IcTrash,
} from '../../../_components/canon-icons'

/**
 * Painel de privacidade (C7D) na linguagem visual da tela 13 do canônico:
 * consentimentos versionados como linhas com switch REAL (`role="switch"`),
 * exportação LGPD e encerramento de conta com confirmação de senha inline
 * (sem window.prompt — campo de senha acessível e rotulado).
 *
 * A retirada de consentimento tem efeito REAL e imediato — a próxima gravação
 * opcional daquela finalidade já passa a ser barrada no servidor. Finalidades
 * não-revogáveis (termos, privacidade) aparecem sem o controle de retirada,
 * com a base legal indicada.
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
  privacy_policy: 'Política de Privacidade',
  marketing_email: 'Comunicações por e-mail',
  analytics: 'Análise de uso',
}

const CONSENT_ICONS: Record<string, ReactNode> = {
  terms_of_service: <IcLock size={16} />,
  privacy_policy: <IcEye size={16} />,
  marketing_email: <IcMail size={16} />,
  analytics: <IcGlobe size={16} />,
}

export function PrivacyPanel(): React.ReactElement {
  const [carregando, setCarregando] = useState(true)
  const [estado, setEstado] = useState<PrivacyState | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [encerrarAberto, setEncerrarAberto] = useState(false)
  const [senha, setSenha] = useState('')

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
      setAviso('Não foi possível registrar a decisão.')
    }
  }

  async function exportar(): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/account/export', { method: 'POST', body: '{}' })
    if (!r.ok) {
      setAviso('Não foi possível gerar a exportação agora.')
      return
    }
    // Baixa o JSON como arquivo, no próprio navegador (sem storage no servidor).
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cinerie-meus-dados.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function encerrar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (senha.length === 0) return
    setAviso(null)
    const r = await authFetch('/api/account/close', {
      method: 'POST',
      body: JSON.stringify({ password: senha }),
    })
    if (r.ok) {
      window.location.assign('/pt/entrar')
    } else {
      setAviso('Não foi possível encerrar a conta.')
    }
  }

  if (carregando) return <p role="status">Carregando…</p>
  if (estado === null) return <p role="status">Redirecionando…</p>

  return (
    <div className="set-content">
      <div className="set-section-head" style={{ marginTop: 0 }}>
        <div className="set-section-head__title">
          <span aria-hidden="true" className="set-section-head__bar" />
          <h2>
            <strong>Consentimentos</strong>
          </h2>
        </div>
      </div>
      <div className="set-card">
        {estado.consents.map((c) => (
          <div className="set-row" key={c.kind}>
            <span className="set-row__icon">{CONSENT_ICONS[c.kind] ?? <IcChat size={16} />}</span>
            <div className="set-row__text">
              <div className="set-row__title">{LABELS[c.kind] ?? c.kind}</div>
              <div className="set-row__desc">
                {c.revocable
                  ? c.granted === true
                    ? 'Concedido'
                    : 'Não concedido'
                  : `Obrigatório — base legal: ${c.legalBasis}`}
                {c.needsRenewal ? ' · nova versão disponível' : ''}
              </div>
            </div>
            {c.revocable ? (
              <button
                aria-checked={c.granted === true}
                aria-label={LABELS[c.kind] ?? c.kind}
                className="set-switch"
                onClick={() => void alterarConsent(c.kind, c.granted !== true)}
                role="switch"
                type="button"
              >
                <span aria-hidden="true" className="set-switch__knob" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="set-section-head">
        <div className="set-section-head__title">
          <span aria-hidden="true" className="set-section-head__bar" />
          <h2>
            <strong>Meus</strong> <span>dados</span>
          </h2>
        </div>
      </div>
      <div className="set-card">
        <button className="set-row set-row--action" onClick={() => void exportar()} type="button">
          <span className="set-row__icon">
            <IcDownload size={16} />
          </span>
          <div className="set-row__text">
            <div className="set-row__title">Exportar meus dados</div>
            <div className="set-row__desc">
              A exportação contém apenas seus próprios dados e nunca inclui senhas, tokens ou
              informações internas de segurança.
            </div>
          </div>
        </button>
      </div>

      <div className="set-section-head">
        <div className="set-section-head__title">
          <span aria-hidden="true" className="set-section-head__bar" />
          <h2>
            <strong>Encerrar</strong> <span>conta</span>
          </h2>
        </div>
      </div>
      <div className="set-card">
        {estado.accountStatus === 'pending_deletion' ? (
          <div className="set-row">
            <span className="set-row__icon">
              <IcAlert size={16} />
            </span>
            <div className="set-row__text">
              <div className="set-row__title" role="status">
                Sua conta está em processo de encerramento.
              </div>
              <div className="set-row__desc">
                Para reativá-la dentro do prazo, fale com o suporte.
              </div>
            </div>
          </div>
        ) : (
          <div className="set-row-group">
            <button
              aria-expanded={encerrarAberto}
              className="set-row set-row--action"
              onClick={() => setEncerrarAberto(!encerrarAberto)}
              type="button"
            >
              <span className="set-row__icon">
                <IcTrash size={16} />
              </span>
              <div className="set-row__text">
                <div className="set-row__title">Encerrar minha conta</div>
                <div className="set-row__desc">
                  Ação irreversível após o prazo de reativação — confirme com sua senha.
                </div>
              </div>
            </button>
            {encerrarAberto ? (
              <form className="set-row__editor" onSubmit={encerrar}>
                <label htmlFor="privacidade-senha">Confirme sua senha</label>
                <input
                  autoComplete="current-password"
                  className="input"
                  id="privacidade-senha"
                  onChange={(event) => setSenha(event.target.value)}
                  required
                  type="password"
                  value={senha}
                />
                <button className="set-save" type="submit">
                  Encerrar conta
                </button>
              </form>
            ) : null}
          </div>
        )}
      </div>

      {aviso !== null ? (
        <p className="alert alert--error" role="alert">
          {aviso}
        </p>
      ) : null}
      <div className="set-bottom-space" />
    </div>
  )
}
