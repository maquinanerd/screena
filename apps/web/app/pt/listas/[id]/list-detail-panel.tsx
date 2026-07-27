'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../../src/lib/csrf-client'

/**
 * Detalhe de UMA lista (C8): itens, adicionar, remover e reordenar.
 *
 * O id da lista vem da URL. A ordem e determinada pelo servidor (posicoes
 * contiguas 0..n-1); os botoes "subir"/"descer" enviam a operacao de mover, e o
 * servidor recalcula as posicoes. Ownership e do servidor: um id de outra
 * pessoa devolve "nao encontrada".
 */

interface ListItem {
  itemId: string
  entityType: string
  entityId: string
  position: number
  note: string | null
}

interface ListInfo {
  listId: string
  title: string
  ordered: boolean
  visibility: string
}

type Estado = 'carregando' | 'pronto' | 'erro' | 'nao-autenticado' | 'nao-encontrada'

function listIdFromPath(): string {
  const partes = window.location.pathname.split('/').filter((s) => s.length > 0)
  return partes[partes.length - 1] ?? ''
}

export function ListDetailPanel(): React.ReactElement {
  const [listId, setListId] = useState('')
  const [estado, setEstado] = useState<Estado>('carregando')
  const [info, setInfo] = useState<ListInfo | null>(null)
  const [itens, setItens] = useState<ListItem[]>([])
  const [novoTipo, setNovoTipo] = useState('movie')
  const [novoId, setNovoId] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  async function carregar(id: string): Promise<void> {
    try {
      const r = await fetch(`/api/me/lists/${id}?limit=100`, { credentials: 'same-origin' })
      if (r.status === 401) {
        setEstado('nao-autenticado')
        return
      }
      if (r.status === 404) {
        setEstado('nao-encontrada')
        return
      }
      if (!r.ok) {
        setEstado('erro')
        return
      }
      const dados = (await r.json()) as { list: ListInfo; items: ListItem[] }
      setInfo(dados.list)
      setItens(dados.items)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  useEffect(() => {
    const id = listIdFromPath()
    setListId(id)
    void carregar(id)
  }, [])

  async function adicionar(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAviso(null)
    const r = await authFetch(`/api/me/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify({ entityType: novoTipo, entityId: novoId, note: null }),
    })
    if (r.ok) {
      setNovoId('')
      await carregar(listId)
    } else {
      const corpo = (await r.json().catch(() => null)) as { message?: string } | null
      setAviso(corpo?.message ?? 'Nao foi possivel adicionar o item.')
    }
  }

  async function remover(itemId: string): Promise<void> {
    setAviso(null)
    const r = await authFetch(`/api/me/lists/${listId}/items/${itemId}/remove`, {
      method: 'POST',
    })
    if (r.ok) {
      await carregar(listId)
    } else {
      setAviso('Nao foi possivel remover o item.')
    }
  }

  async function mover(itemId: string, toPosition: number): Promise<void> {
    if (toPosition < 0 || toPosition > itens.length - 1) return
    setAviso(null)
    const r = await authFetch(`/api/me/lists/${listId}/reorder`, {
      method: 'POST',
      body: JSON.stringify({ itemId, toPosition }),
    })
    if (r.ok) {
      await carregar(listId)
    } else {
      setAviso('Nao foi possivel reordenar.')
    }
  }

  if (estado === 'nao-autenticado') {
    return (
      <p role="status">
        <a href="/pt/entrar">Entre na sua conta</a> para ver esta lista.
      </p>
    )
  }
  if (estado === 'nao-encontrada') {
    return <p role="alert">Lista nao encontrada.</p>
  }

  return (
    <div>
      <header>
        <h1>{info?.title ?? 'Lista'}</h1>
      </header>

      <form onSubmit={adicionar}>
        <label htmlFor="novo-tipo">Tipo</label>
        <select id="novo-tipo" value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)}>
          <option value="movie">Filme</option>
          <option value="tv">Serie</option>
        </select>
        <label htmlFor="novo-id">Id da obra</label>
        <input
          id="novo-id"
          type="text"
          inputMode="numeric"
          required
          value={novoId}
          onChange={(e) => setNovoId(e.target.value)}
        />
        <button type="submit">Adicionar</button>
      </form>

      <div aria-live="polite">
        {estado === 'carregando' ? <p role="status">Carregando...</p> : null}
        {estado === 'erro' ? <p role="alert">Nao foi possivel carregar a lista.</p> : null}
        {estado === 'pronto' && itens.length === 0 ? (
          <p role="status">Esta lista esta vazia.</p>
        ) : null}
        {estado === 'pronto' && itens.length > 0 ? (
          <ol>
            {itens.map((item, indice) => (
              <li key={item.itemId}>
                <a
                  href={`/pt/${item.entityType === 'movie' ? 'filmes' : 'series'}/${item.entityId}`}
                >
                  {item.entityType === 'movie' ? 'Filme' : 'Serie'} #{item.entityId}
                </a>{' '}
                {info?.ordered === true ? (
                  <>
                    <button
                      type="button"
                      aria-label="Mover para cima"
                      disabled={indice === 0}
                      onClick={() => void mover(item.itemId, indice - 1)}
                    >
                      Subir
                    </button>{' '}
                    <button
                      type="button"
                      aria-label="Mover para baixo"
                      disabled={indice === itens.length - 1}
                      onClick={() => void mover(item.itemId, indice + 1)}
                    >
                      Descer
                    </button>{' '}
                  </>
                ) : null}
                <button type="button" onClick={() => void remover(item.itemId)}>
                  Remover
                </button>
              </li>
            ))}
          </ol>
        ) : null}
        {aviso !== null ? <p role="alert">{aviso}</p> : null}
      </div>
    </div>
  )
}
