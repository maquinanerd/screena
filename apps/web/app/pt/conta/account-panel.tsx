'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'

/**
 * Painel de conta (C7D): perfil, troca de senha, logout e logout global.
 *
 * Carrega a sessao na montagem via `/api/auth/session`. Sem sessao, redireciona
 * para o login — a area e privada. Toda MUTACAO usa `authFetch`, que anexa o
 * cabecalho CSRF do double submit.
 */

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

export function AccountPanel(): React.ReactElement {
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

  async function salvarPerfil(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (profile === null) return
    setAviso(null)
    const response = await authFetch('/api/account/profile', {
      method: 'POST',
      body: JSON.stringify({
        displayName: profile.displayName,
        handle: profile.handle,
        bio: profile.bio,
        locale: profile.locale,
        countryCode: profile.countryCode,
        timezone: profile.timezone,
        visibility: profile.visibility,
      }),
    })
    setAviso(response.ok ? 'Perfil salvo.' : 'Nao foi possivel salvar o perfil.')
  }

  async function logout(todos: boolean): Promise<void> {
    await authFetch(todos ? '/api/auth/logout-all' : '/api/auth/logout', { method: 'POST' })
    window.location.assign('/pt/entrar')
  }

  if (carregando) return <p role="status">Carregando...</p>
  if (user === null) return <p role="status">Redirecionando...</p>

  return (
    <div>
      <section aria-labelledby="perfil-titulo">
        <h2 id="perfil-titulo">Perfil</h2>
        {user.emailVerified ? null : (
          <p role="status">Seu e-mail ainda nao foi verificado. Confira sua caixa de entrada.</p>
        )}
        {profile === null ? (
          <p>Perfil ainda nao configurado.</p>
        ) : (
          <form onSubmit={salvarPerfil}>
            <label htmlFor="displayName">Nome publico</label>
            <input
              id="displayName"
              type="text"
              value={profile.displayName ?? ''}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            />

            <label htmlFor="handle">Nome de usuario</label>
            <input
              id="handle"
              type="text"
              value={profile.handle ?? ''}
              onChange={(e) => setProfile({ ...profile, handle: e.target.value })}
            />

            <label htmlFor="bio">Bio</label>
            <textarea
              id="bio"
              value={profile.bio ?? ''}
              onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
            />

            <label htmlFor="visibility">Visibilidade do perfil</label>
            <select
              id="visibility"
              value={profile.visibility}
              onChange={(e) =>
                setProfile({ ...profile, visibility: e.target.value as 'private' | 'public' })
              }
            >
              <option value="private">Privado</option>
              <option value="public">Publico</option>
            </select>

            <button type="submit">Salvar perfil</button>
          </form>
        )}
        {aviso !== null ? <p role="status">{aviso}</p> : null}
      </section>

      <section aria-labelledby="seguranca-titulo">
        <h2 id="seguranca-titulo">Seguranca</h2>
        <PasswordChange minLength={SENHA_MIN} />
        <p>
          <button type="button" onClick={() => void logout(false)}>
            Sair deste dispositivo
          </button>
        </p>
        <p>
          <button type="button" onClick={() => void logout(true)}>
            Sair de todos os dispositivos
          </button>
        </p>
      </section>
    </div>
  )
}

function PasswordChange({ minLength }: { minLength: number }): React.ReactElement {
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
      // A troca revoga todas as sessoes: o cliente reautentica.
      window.location.assign('/pt/entrar')
      return
    }
    setAviso('Nao foi possivel trocar a senha. Confira a senha atual.')
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="senhaAtual">Senha atual</label>
      <input
        id="senhaAtual"
        type="password"
        autoComplete="current-password"
        required
        value={atual}
        onChange={(e) => setAtual(e.target.value)}
      />
      <label htmlFor="senhaNova">Nova senha</label>
      <input
        id="senhaNova"
        type="password"
        autoComplete="new-password"
        minLength={minLength}
        required
        value={nova}
        onChange={(e) => setNova(e.target.value)}
      />
      <button type="submit">Trocar senha</button>
      {aviso !== null ? <p role="alert">{aviso}</p> : null}
    </form>
  )
}
