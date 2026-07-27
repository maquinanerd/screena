'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../../src/lib/csrf-client'

/**
 * Painel da BIBLIOTECA (C8) — quero assistir / assistidos.
 *
 * Superficie funcional minima, nao o frontend final. Trata todos os estados que
 * a missao exige: carregando, vazio, erro, nao autenticado. Sem dado ficticio e
 * sem placeholder fingindo funcionalidade — quando nao ha item, o texto diz
 * exatamente isso.
 */

interface WatchStateItem {
  entityType: 'movie' | 'tv'
  entityId: string
  status: string
  updatedAt: string
}

type Estado = 'carregando' | 'pronto' | 'erro' | 'nao-autenticado'

const ABAS = [
  { status: 'planned', rotulo: 'Quero assistir' },
  { status: 'watched', rotulo: 'Assistidos' },
  { status: 'watching', rotulo: 'Assistindo' },
] as const

export function LibraryPanel(): React.ReactElement {
  const [aba, setAba] = useState<string>('planned')
  const [estado, setEstado] = useState<Estado>('carregando')
  const [itens, setItens] = useState<WatchStateItem[]>([])
  const [total, setTotal] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)

  async function carregar(status: string): Promise<void> {
    setEstado('carregando')
    try {
      const r = await fetch(`/api/me/library?status=${encodeURIComponent(status)}&limit=50`, {
        credentials: 'same-origin',
      })
      if (r.status === 401) {
        setEstado('nao-autenticado')
        return
      }
      if (!r.ok) {
        setEstado('erro')
        return
      }
      const dados = (await r.json()) as { items: WatchStateItem[]; total: number }
      setItens(dados.items)
      setTotal(dados.total)
      setEstado('pronto')
    } catch {
      setEstado('erro')
    }
  }

  useEffect(() => {
    void carregar(aba)
  }, [aba])

  async function remover(item: WatchStateItem): Promise<void> {
    setAviso(null)
    const r = await authFetch('/api/me/watch-state/remove', {
      method: 'POST',
      body: JSON.stringify({ entityType: item.entityType, entityId: item.entityId }),
    })
    if (r.ok) {
      await carregar(aba)
    } else {
      setAviso('Nao foi possivel remover agora.')
    }
  }

  if (estado === 'nao-autenticado') {
    return (
      <p role="status">
        <a href="/pt/entrar">Entre na sua conta</a> para ver sua biblioteca.
      </p>
    )
  }

  return (
    <div>
      {/* Botoes, nao role=tab: sao acoes de filtro, e `aria-pressed` descreve
          corretamente um botao de alternancia. */}
      <div role="group" aria-label="Filtrar por estado">
        {ABAS.map((t) => (
          <button
            key={t.status}
            type="button"
            aria-pressed={aba === t.status}
            onClick={() => setAba(t.status)}
          >
            {t.rotulo}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {estado === 'carregando' ? <p role="status">Carregando...</p> : null}
        {estado === 'erro' ? (
          <p role="alert">Nao foi possivel carregar sua biblioteca. Tente de novo.</p>
        ) : null}
        {estado === 'pronto' && itens.length === 0 ? (
          <p role="status">Nada por aqui ainda.</p>
        ) : null}
        {estado === 'pronto' && itens.length > 0 ? (
          <>
            <p>{total} titulo(s).</p>
            <ul>
              {itens.map((item) => (
                <li key={`${item.entityType}-${item.entityId}`}>
                  <a
                    href={`/pt/${item.entityType === 'movie' ? 'filmes' : 'series'}/${item.entityId}`}
                  >
                    {item.entityType === 'movie' ? 'Filme' : 'Serie'} #{item.entityId}
                  </a>{' '}
                  <button type="button" onClick={() => void remover(item)}>
                    Remover
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {aviso !== null ? <p role="alert">{aviso}</p> : null}
      </div>
    </div>
  )
}
