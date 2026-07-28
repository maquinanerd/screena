'use client'

/**
 * SettingsPanel — tela 13 do canônico (Configurações), estrutura EXATA:
 * sub-nav sticky (CONFIGURAÇÕES · Geral/Dados/Privacidade) → header do usuário
 * → "Detalhes da conta" (linhas com ícone + valor + edição) → "Privacidade e
 * assinatura" (switch REAL de conta privada + ponte LGPD) → "Segurança" →
 * "Aparência" (idioma real).
 *
 * Contratos REAIS (C7C/C7D): /api/auth/session, /api/account/profile (GET/POST),
 * /api/auth/password-change, /api/auth/logout(-all). Toda mutação usa authFetch
 * (CSRF double-submit). Sem preferência fake: seções do protótipo sem backend
 * (assinatura, notificações, comportamento, gêneros, bloqueados, tema/densidade)
 * são omitidas — nunca toggle sem efeito (DIVERGENCIAS registra).
 * O switch verdadeiro é `role="switch"` + aria-checked (WCAG 2.2).
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'
import {
  IcChat,
  IcEye,
  IcGlobe,
  IcId,
  IcLock,
  IcMail,
  IcUser,
} from '../../_components/canon-icons'

interface CurrentUser {
  handle: string | null
  displayName: string | null
  emailVerified: boolean
  role: string
  locale: string
  profileVisibility: string
}

interface Profile {
  displayName: string | null
  handle: string | null
  bio: string | null
  locale: string
  countryCode: string | null
  timezone: string | null
  visibility: 'private' | 'public'
}

const SENHA_MIN = 10

const LOCALE_LABELS: Record<string, string> = {
  'pt-BR': 'Português (Brasil)',
  pt: 'Português',
  en: 'English',
  es: 'Español',
}

function Chevron(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      className="set-row__chev"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="15"
    >
      <polyline points="9 5 16 12 9 19" />
    </svg>
  )
}

function SectionHead({
  strong,
  light,
  accent = 'movie',
  right,
}: {
  strong: string
  light?: string
  accent?: 'movie' | 'series'
  right?: ReactNode
}): ReactNode {
  return (
    <div className="set-section-head">
      <div className="set-section-head__title">
        <span
          aria-hidden="true"
          className={
            accent === 'series' ? 'set-section-head__bar set-section-head__bar--series' : 'set-section-head__bar'
          }
        />
        <h2>
          <strong>{strong}</strong>
          {light !== undefined ? <> <span>{light}</span></> : null}
        </h2>
      </div>
      {right}
    </div>
  )
}

/** Linha editável do card "Detalhes da conta": valor real + edição inline. */
function EditableRow({
  icon,
  label,
  value,
  muted,
  inputId,
  editValue,
  onChange,
  onSave,
  multiline,
}: {
  icon: ReactNode
  label: string
  value: string
  muted: boolean
  inputId: string
  editValue: string
  onChange: (next: string) => void
  onSave: () => void
  multiline?: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <div className="set-row-group">
      <button
        aria-expanded={open}
        className="set-row set-row--action"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="set-row__icon">{icon}</span>
        <span className="set-row__label">{label}</span>
        <span className={muted ? 'set-row__value set-row__value--muted' : 'set-row__value'}>
          {value}
        </span>
        <Chevron />
      </button>
      {open ? (
        <form
          className="set-row__editor"
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
            setOpen(false)
          }}
        >
          <label className="visually-hidden" htmlFor={inputId}>
            {label}
          </label>
          {multiline === true ? (
            <textarea
              className="input"
              id={inputId}
              onChange={(event) => onChange(event.target.value)}
              rows={3}
              value={editValue}
            />
          ) : (
            <input
              className="input"
              id={inputId}
              onChange={(event) => onChange(event.target.value)}
              type="text"
              value={editValue}
            />
          )}
          <button className="set-save" type="submit">
            Salvar
          </button>
        </form>
      ) : null}
    </div>
  )
}

export function SettingsPanel(): React.ReactElement {
  const [carregando, setCarregando] = useState(true)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
        const sessao = (await s.json()) as { authenticated: boolean; user: CurrentUser | null }
        if (!sessao.authenticated || sessao.user === null) {
          window.location.assign('/pt/entrar')
          return
        }
        setUser(sessao.user)
        const p = await fetch('/api/account/profile', { credentials: 'same-origin' })
        if (p.ok) {
          const dados = (await p.json()) as { profile: Profile }
          setProfile(dados.profile)
        }
      } finally {
        setCarregando(false)
      }
    })()
  }, [])

  async function salvarPerfil(next: Profile): Promise<void> {
    setAviso(null)
    const response = await authFetch('/api/account/profile', {
      method: 'POST',
      body: JSON.stringify({
        displayName: next.displayName,
        handle: next.handle,
        bio: next.bio,
        locale: next.locale,
        countryCode: next.countryCode,
        timezone: next.timezone,
        visibility: next.visibility,
      }),
    })
    if (response.ok) {
      setProfile(next)
      setAviso('Alterações salvas.')
    } else {
      setAviso('Não foi possível salvar. Confira os campos e tente de novo.')
    }
  }

  async function logout(todos: boolean): Promise<void> {
    await authFetch(todos ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST', body: '{}' })
    window.location.assign('/pt/entrar')
  }

  if (carregando) {
    return (
      <div className="set-layout">
        <p role="status">Carregando…</p>
      </div>
    )
  }
  if (user === null) {
    return (
      <div className="set-layout">
        <p role="status">Redirecionando…</p>
      </div>
    )
  }

  const nome = profile?.displayName ?? user.displayName ?? 'Sua conta'
  const handle = profile?.handle ?? user.handle
  const privada = (profile?.visibility ?? user.profileVisibility) !== 'public'
  const localeLabel = LOCALE_LABELS[profile?.locale ?? user.locale] ?? (profile?.locale ?? user.locale)

  return (
    <div className="set-layout">
      <aside className="set-nav">
        <div className="set-nav__label">Configurações</div>
        <nav aria-label="Seções de configurações">
          <a aria-current="page" className="set-nav__item set-nav__item--active" href="/pt/conta/">
            <span aria-hidden="true" className="set-nav__bar" />
            Geral
          </a>
          <a className="set-nav__item" href="/pt/importar/">
            <span aria-hidden="true" className="set-nav__bar" />
            Dados
          </a>
          <a className="set-nav__item" href="/pt/conta/privacidade/">
            <span aria-hidden="true" className="set-nav__bar" />
            Privacidade
          </a>
        </nav>
      </aside>

      <div className="set-content">
        <div className="set-user">
          <span aria-hidden="true" className="set-user__avatar">
            {nome.charAt(0).toUpperCase()}
          </span>
          <div className="set-user__body">
            <div className="set-user__names">
              <h1 className="set-user__name">{nome}</h1>
              {handle !== null ? <span className="set-user__handle">@{handle}</span> : null}
            </div>
            <div className="set-user__meta">
              {profile?.countryCode != null && profile.countryCode !== '' ? (
                <span className="set-user__meta-item">
                  <IcGlobe size={14} /> {profile.countryCode}
                </span>
              ) : (
                <span className="set-user__meta-item">
                  <IcUser size={14} /> {user.emailVerified ? 'E-mail verificado' : 'E-mail não verificado'}
                </span>
              )}
            </div>
          </div>
        </div>

        {aviso !== null ? (
          <p className="set-notice" role="status">
            {aviso}
          </p>
        ) : null}

        <SectionHead light="da conta" strong="Detalhes" />
        {profile === null ? (
          <div className="set-card">
            <p className="set-card__empty">Perfil ainda não configurado.</p>
          </div>
        ) : (
          <div className="set-card">
            <EditableRow
              editValue={profile.displayName ?? ''}
              icon={<IcId size={16} />}
              inputId="set-displayName"
              label="Nome de exibição"
              muted={profile.displayName == null || profile.displayName === ''}
              onChange={(v) => setProfile({ ...profile, displayName: v })}
              onSave={() => void salvarPerfil(profile)}
              value={profile.displayName ?? 'Adicionar'}
            />
            <EditableRow
              editValue={profile.handle ?? ''}
              icon={<IcUser size={16} />}
              inputId="set-handle"
              label="Nome de usuário"
              muted={profile.handle == null || profile.handle === ''}
              onChange={(v) => setProfile({ ...profile, handle: v })}
              onSave={() => void salvarPerfil(profile)}
              value={profile.handle != null && profile.handle !== '' ? `@${profile.handle}` : 'Adicionar'}
            />
            <div className="set-row">
              <span className="set-row__icon">
                <IcMail size={16} />
              </span>
              <span className="set-row__label">E-mail</span>
              <span className="set-row__value">
                {user.emailVerified ? 'Verificado' : 'Aguardando verificação'}
              </span>
            </div>
            <EditableRow
              editValue={profile.countryCode ?? ''}
              icon={<IcGlobe size={16} />}
              inputId="set-country"
              label="Localização"
              muted={profile.countryCode == null || profile.countryCode === ''}
              onChange={(v) => setProfile({ ...profile, countryCode: v.toUpperCase() })}
              onSave={() => void salvarPerfil(profile)}
              value={profile.countryCode ?? 'Adicionar'}
            />
            <EditableRow
              editValue={profile.bio ?? ''}
              icon={<IcChat size={16} />}
              inputId="set-bio"
              label="Sobre mim"
              multiline
              muted={profile.bio == null || profile.bio === ''}
              onChange={(v) => setProfile({ ...profile, bio: v })}
              onSave={() => void salvarPerfil(profile)}
              value={profile.bio != null && profile.bio !== '' ? profile.bio : 'Adicionar'}
            />
          </div>
        )}

        <SectionHead light="e dados" strong="Privacidade" />
        <div className="set-card">
          <div className="set-row">
            <span className="set-row__icon">
              <IcLock size={16} />
            </span>
            <div className="set-row__text">
              <div className="set-row__title">Conta privada</div>
              <div className="set-row__desc">Somente você vê sua atividade e suas listas.</div>
            </div>
            <button
              aria-checked={privada}
              aria-label="Conta privada"
              className="set-switch"
              disabled={profile === null}
              onClick={() => {
                if (profile === null) return
                const next: Profile = {
                  ...profile,
                  visibility: privada ? 'public' : 'private',
                }
                void salvarPerfil(next)
              }}
              role="switch"
              type="button"
            >
              <span aria-hidden="true" className="set-switch__knob" />
            </button>
          </div>
          <a className="set-row set-row--action" href="/pt/conta/privacidade/">
            <span className="set-row__icon">
              <IcEye size={16} />
            </span>
            <span className="set-row__label">Privacidade e meus dados</span>
            <span className="set-row__value">Consentimentos, exportação e encerramento</span>
            <Chevron />
          </a>
        </div>

        <SectionHead strong="Segurança" />
        <div className="set-card">
          <PasswordRow minLength={SENHA_MIN} />
          <button className="set-row set-row--action" onClick={() => void logout(false)} type="button">
            <span className="set-row__icon">
              <IcUser size={16} />
            </span>
            <span className="set-row__label">Sair deste dispositivo</span>
            <Chevron />
          </button>
          <button className="set-row set-row--action" onClick={() => void logout(true)} type="button">
            <span className="set-row__icon">
              <IcGlobe size={16} />
            </span>
            <span className="set-row__label">Sair de todos os dispositivos</span>
            <Chevron />
          </button>
        </div>

        <SectionHead accent="series" strong="Aparência" />
        <div className="set-card">
          <div className="set-row">
            <span className="set-row__icon">
              <IcGlobe size={16} />
            </span>
            <span className="set-row__label">Idioma</span>
            <span className="set-row__value">{localeLabel}</span>
          </div>
        </div>

        <nav aria-label="Minha biblioteca" className="set-shortcuts">
          <a href="/pt/minha-lista/">Minha biblioteca</a>
          <a href="/pt/listas/">Minhas listas</a>
          <a href="/pt/tracker/">Tracker de séries</a>
          <a href="/pt/historico/">Meu histórico</a>
          <a href="/pt/importar/">Importar dados</a>
        </nav>

        <div className="set-bottom-space" />
      </div>
    </div>
  )
}

function PasswordRow({ minLength }: { minLength: number }): ReactNode {
  const [open, setOpen] = useState(false)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  async function enviar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAviso(null)
    const response = await authFetch('/api/auth/password-change', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: atual, newPassword: nova }),
    })
    if (response.ok) {
      // A troca revoga todas as sessões: o cliente reautentica.
      window.location.assign('/pt/entrar')
      return
    }
    setAviso('Não foi possível trocar a senha. Confira a senha atual.')
  }

  return (
    <div className="set-row-group">
      <button
        aria-expanded={open}
        className="set-row set-row--action"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="set-row__icon">
          <IcLock size={16} />
        </span>
        <span className="set-row__label">Trocar senha</span>
        <Chevron />
      </button>
      {open ? (
        <form className="set-row__editor" onSubmit={enviar}>
          <label htmlFor="set-senha-atual">Senha atual</label>
          <input
            autoComplete="current-password"
            className="input"
            id="set-senha-atual"
            onChange={(event) => setAtual(event.target.value)}
            required
            type="password"
            value={atual}
          />
          <label htmlFor="set-senha-nova">Nova senha</label>
          <input
            autoComplete="new-password"
            className="input"
            id="set-senha-nova"
            minLength={minLength}
            onChange={(event) => setNova(event.target.value)}
            required
            type="password"
            value={nova}
          />
          <button className="set-save" type="submit">
            Trocar senha
          </button>
          {aviso !== null ? (
            <p className="alert alert--error" role="alert">
              {aviso}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
