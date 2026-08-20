'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../src/lib/csrf-client'

/**
 * Acoes de biblioteca na pagina de detalhe (C8): "Quero assistir", "Assistido"
 * e, para series, "Acompanhar".
 *
 * Componente de CLIENTE que fala com a borda `/api/me/watch-state` por `fetch` —
 * nenhuma chamada externa no render, entao a pureza de render da pagina publica
 * (server component) e preservada. O botao so age apos clique do usuario e
 * reusa o CSRF do Prompt 07 via `authFetch`.
 *
 * O `entityId` e o id INTERNO do catalogo (bigint serializado), nao o slug —
 * a biblioteca do usuario referencia a entidade canonica e sobrevive a mudanca
 * de slug/titulo/traducao.
 *
 * Estados tratados: nao autenticado (convida a entrar), carregando, e o estado
 * atual refletido nos botoes com `aria-pressed`.
 */

interface EntityActionsProps {
  readonly entityType: 'movie' | 'tv'
  readonly entityId: string
}

type Estado = 'carregando' | 'anonimo' | 'pronto'

const ROTULOS: Record<string, string> = {
  planned: 'Quero assistir',
  watching: 'Acompanhando',
  watched: 'Assistido',
}

export function EntityActions({ entityType, entityId }: EntityActionsProps): React.ReactElement | null {
  const [estado, setEstado] = useState<Estado>('carregando')
  const [status, setStatus] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        // A sessao diz se ha usuario. Sem sessao, os botoes viram convite.
        const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
        const sessao = (await s.json()) as { authenticated: boolean }
        if (!sessao.authenticated) {
          setEstado('anonimo')
          return
        }
        // Le o estado atual desta entidade a partir da biblioteca paginada.
        const lib = await fetch(
          `/api/me/library?status=planned&status=watching&status=watched&limit=100`,
          { credentials: 'same-origin' },
        )
        if (lib.ok) {
          const dados = (await lib.json()) as {
            items: { entityType: string; entityId: string; status: string }[]
          }
          const atual = dados.items.find(
            (i) => i.entityType === entityType && i.entityId === entityId,
          )
          setStatus(atual?.status ?? null)
        }
        setEstado('pronto')
      } catch {
        setEstado('pronto')
      }
    })()
  }, [entityType, entityId])

  async function definir(novo: string): Promise<void> {
    setAviso(null)
    // Clicar de novo no estado atual REMOVE (toggle) — a acao explicita nunca
    // depende de consentimento de tracking (regra do produto).
    if (status === novo) {
      const r = await authFetch('/api/me/watch-state/remove', {
        method: 'POST',
        body: JSON.stringify({ entityType, entityId }),
      })
      if (r.ok) setStatus(null)
      else setAviso('Nao foi possivel atualizar agora.')
      return
    }
    const r = await authFetch('/api/me/watch-state', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, status: novo }),
    })
    if (r.ok) setStatus(novo)
    else setAviso('Nao foi possivel atualizar agora.')
  }

  if (estado === 'carregando') {
    return null
  }
  if (estado === 'anonimo') {
    return (
      <p>
        <a href="/pt/entrar">Entre</a> para salvar na sua biblioteca.
      </p>
    )
  }

  return (
    <div role="group" aria-label="Acoes da biblioteca">
      <button type="button" aria-pressed={status === 'planned'} onClick={() => void definir('planned')}>
        {ROTULOS.planned}
      </button>{' '}
      {entityType === 'tv' ? (
        <>
          <button
            type="button"
            aria-pressed={status === 'watching'}
            onClick={() => void definir('watching')}
          >
            Acompanhar serie
          </button>{' '}
        </>
      ) : null}
      <button type="button" aria-pressed={status === 'watched'} onClick={() => void definir('watched')}>
        {ROTULOS.watched}
      </button>
      {status !== null ? <p role="status">Na sua biblioteca: {ROTULOS[status] ?? status}.</p> : null}
      {aviso !== null ? <p role="alert">{aviso}</p> : null}
    </div>
  )
}
