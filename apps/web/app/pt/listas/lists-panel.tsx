'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'

/** Painel de LISTAS (C8): cria, lista e remove listas do proprio titular. */

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

export function ListsPanel(): React.ReactElement {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [listas, setListas] = useState<UserList[]>([])
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
      // Nasce PRIVADA: publicar e uma decisao separada e exige e-mail verificado.
      body: JSON.stringify({ title: titulo, visibility: 'private', ordered: true }),
    })
    if (r.ok) {
      setTitulo('')
      await carregar()
    } else {
      const corpo = (await r.json().catch(() => null)) as { message?: string } | null
      setAviso(corpo?.message ?? 'Nao foi possivel criar a lista.')
    }
  }

  async function remover(id: string): Promise<void> {
    setAviso(null)
    const r = await authFetch(`/api/me/lists/${id}/delete`, { method: 'POST' })
    if (r.ok) {
      await carregar()
    } else {
      setAviso('Listas do sistema nao podem ser removidas.')
    }
  }

  if (estado === 'nao-autenticado') {
    return (
      <p role="status">
        <a href="/pt/entrar">Entre na sua conta</a> para ver suas listas.
      </p>
    )
  }

  return (
    <div>
      <form onSubmit={criar}>
        <label htmlFor="titulo-lista">Nova lista</label>
        <input
          id="titulo-lista"
          type="text"
          required
          maxLength={120}
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
        />
        <button type="submit">Criar lista</button>
      </form>

      <div aria-live="polite">
        {estado === 'carregando' ? <p role="status">Carregando...</p> : null}
        {estado === 'erro' ? <p role="alert">Nao foi possivel carregar suas listas.</p> : null}
        {estado === 'pronto' && listas.length === 0 ? (
          <p role="status">Voce ainda nao tem listas.</p>
        ) : null}
        {estado === 'pronto' && listas.length > 0 ? (
          <ul>
            {listas.map((l) => (
              <li key={l.id}>
                <a href={`/pt/listas/${l.id}`}>{l.title}</a> — {l.itemCount} item(ns)
                {l.kind === 'system' ? <em> (do sistema)</em> : null}
                {l.kind === 'custom' ? (
                  <button type="button" onClick={() => void remover(l.id)}>
                    Remover
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {aviso !== null ? <p role="alert">{aviso}</p> : null}
      </div>
    </div>
  )
}
