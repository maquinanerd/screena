'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'
import { IcPlusIcon } from './plus-icon'

/**
 * Painel de LISTAS (C8) — tela 15 do canônico, estrutura EXATA:
 * cabeçalho com barra vermelha + "Criar lista" → grade 3 colunas de cards
 * 16:9 (badge de privacidade, nome sobreposto ao gradiente, contagem real)
 * → célula tracejada "Criar nova lista".
 *
 * Dados 100% reais do titular (/api/me/lists). Sem curtidas nem "Listas em
 * destaque" editoriais: não há produto de curtidas/listas editoriais — nunca
 * métrica inventada (DIVERGENCIAS registra). Lista nasce PRIVADA; publicar é
 * decisão separada e exige e-mail verificado.
 */

interface UserList {
  id: string
  kind: 'system' | 'custom'
  systemKey: string | null
  title: string
  slug: string
  visibility: string
  itemCount: number
}

type Estado = 'carregando' | 'pronto' | 'erro' | 'nao-autenticado'

/** Gradientes neutros do sistema visual para capa de lista sem mídia própria. */
const CAPAS = [
  'linear-gradient(135deg, #23201b 0%, #4a443a 100%)',
  'linear-gradient(135deg, #2b1e1d 0%, #5a3734 100%)',
  'linear-gradient(135deg, #1d2620 0%, #3b544332 100%), #2c3a31',
  'linear-gradient(135deg, #201f2b 0%, #3d3b55 100%)',
  'linear-gradient(135deg, #262019 0%, #55432b 100%)',
  'linear-gradient(135deg, #1b2430 0%, #32475c 100%)',
] as const

export function ListsPanel(): React.ReactElement {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [listas, setListas] = useState<UserList[]>([])
  const [criando, setCriando] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  async function carregar(): Promise<void> {
    try {
      const r = await fetch('/api/me/lists?limit=100', { credentials: 'same-origin' })
      if (r.status === 401) {
        setEstado('nao-autenticado')
        return
      }
      if (!r.ok) {
        setEstado('erro')
        return
      }
      const dados = (await r.json()) as { items: UserList[] }
      setListas(dados.items)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  useEffect(() => {
    void carregar()
  }, [])

  async function criar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAviso(null)
    const r = await authFetch('/api/me/lists', {
      method: 'POST',
      // Nasce PRIVADA: publicar é uma decisão separada e exige e-mail verificado.
      body: JSON.stringify({ title: titulo, visibility: 'private', ordered: true }),
    })
    if (r.ok) {
      setTitulo('')
      setCriando(false)
      await carregar()
    } else {
      const corpo = (await r.json().catch(() => null)) as { message?: string } | null
      setAviso(corpo?.message ?? 'Não foi possível criar a lista.')
    }
  }

  if (estado === 'nao-autenticado') {
    return (
      <p className="lists-anon" role="status">
        <a href="/pt/entrar/">Entre na sua conta</a> para ver suas listas.
      </p>
    )
  }

  return (
    <div>
      <div className="lists-head">
        <div>
          <div className="lists-head__title">
            <span aria-hidden="true" className="lists-head__bar" />
            <h1>Suas listas</h1>
          </div>
          <p className="lists-head__sub">Coleções que você criou e salvou na Cinerie</p>
        </div>
        <button
          aria-expanded={criando}
          className="lists-create"
          onClick={() => setCriando(!criando)}
          type="button"
        >
          <IcPlusIcon /> Criar lista
        </button>
      </div>

      {criando ? (
        <form className="lists-form" onSubmit={criar}>
          <label htmlFor="titulo-lista">Nome da nova lista</label>
          <input
            className="input"
            id="titulo-lista"
            maxLength={120}
            onChange={(e) => setTitulo(e.target.value)}
            required
            type="text"
            value={titulo}
          />
          <button className="imp-primary" type="submit">
            Criar lista
          </button>
        </form>
      ) : null}

      <div aria-live="polite">
        {estado === 'carregando' ? <p role="status">Carregando…</p> : null}
        {estado === 'erro' ? (
          <p className="alert alert--error" role="alert">
            Não foi possível carregar suas listas.
          </p>
        ) : null}
        {aviso !== null ? (
          <p className="alert alert--error" role="alert">
            {aviso}
          </p>
        ) : null}

        {estado === 'pronto' ? (
          <div className="lists-grid">
            {listas.map((l, index) => (
              <a
                className="list-card"
                href={`/pt/listas/${l.id}/`}
                key={l.id}
                style={{ ['--list-cover' as string]: CAPAS[index % CAPAS.length] }}
              >
                <span className="list-card__media">
                  <span aria-hidden="true" className="list-card__scrim" />
                  <span className="list-card__privacy">
                    {l.visibility === 'public' ? 'Pública' : 'Privada'}
                  </span>
                  <span className="list-card__name">{l.title}</span>
                </span>
                <span className="list-card__foot">
                  <span className="list-card__count">
                    {l.itemCount} título{l.itemCount === 1 ? '' : 's'}
                  </span>
                  {l.kind === 'system' ? (
                    <span className="list-card__system">do sistema</span>
                  ) : null}
                </span>
              </a>
            ))}
            <button
              className="list-card list-card--new"
              onClick={() => {
                setCriando(true)
                document.getElementById('titulo-lista')?.focus()
              }}
              type="button"
            >
              <span aria-hidden="true" className="list-card__plus">
                <IcPlusIcon size={20} />
              </span>
              <span className="list-card__new-label">Criar nova lista</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
