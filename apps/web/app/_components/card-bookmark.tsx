'use client'

/**
 * CardBookmark — o bookmark dos cards do canonico (fresh-card 36px quadrado /
 * glimpse 32px circular), ligado ao Backend C REAL:
 *
 *   watchlist = UserWatchState.planned  (decisao canonica do produto)
 *
 * Eficiencia: UMA busca compartilhada de sessao+biblioteca por pagina
 * (promise em escopo de modulo, memoizada) — N cards nao geram N chamadas.
 * Clique alterna `planned` via `/api/me/watch-state` com CSRF real; nenhum
 * estado local fake, nenhum localStorage. Anonimo -> link real para /pt/entrar
 * (a acao continua existindo e leva ao login, sem fingir estado).
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { authFetch } from '../../src/lib/csrf-client'

interface SharedState {
  authenticated: boolean
  planned: Set<string>
}

let sharedPromise: Promise<SharedState> | null = null

// Pub/sub por entidade: TODOS os controles da mesma entidade na página
// refletem um toggle imediatamente (a mesma série pode aparecer como card de
// série, de temporada e de episódio ao mesmo tempo — ex.: /pt/em-breve).
const listeners = new Map<string, Set<(planned: boolean) => void>>()

function subscribe(key: string, listener: (planned: boolean) => void): () => void {
  let set = listeners.get(key)
  if (set === undefined) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(listener)
  return () => {
    set?.delete(listener)
  }
}

async function broadcastPlanned(key: string, planned: boolean): Promise<void> {
  // Mantém o snapshot compartilhado coerente para montagens futuras…
  const shared = await loadShared()
  if (planned) shared.planned.add(key)
  else shared.planned.delete(key)
  // …e avisa todos os controles já montados desta entidade.
  for (const listener of listeners.get(key) ?? []) listener(planned)
}

function loadShared(): Promise<SharedState> {
  if (sharedPromise !== null) return sharedPromise
  sharedPromise = (async () => {
    try {
      const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
      const session = (await s.json()) as { authenticated: boolean }
      if (!session.authenticated) return { authenticated: false, planned: new Set<string>() }
      const lib = await fetch('/api/me/library?status=planned&limit=200', {
        credentials: 'same-origin',
      })
      if (!lib.ok) return { authenticated: true, planned: new Set<string>() }
      const data = (await lib.json()) as {
        items?: { entityType: string; entityId: string; status: string }[]
      }
      const planned = new Set(
        (data.items ?? []).map((item) => `${item.entityType}:${item.entityId}`),
      )
      return { authenticated: true, planned }
    } catch {
      return { authenticated: false, planned: new Set<string>() }
    }
  })()
  return sharedPromise
}

function BookmarkIcon(): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15">
      <path
        d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

/**
 * Estado real de watchlist de UMA entidade, compartilhando a busca de
 * sessão+biblioteca da página (loadShared). Toggle via API com CSRF real.
 */
export function useWatchlistEntry(
  entityType: 'movie' | 'tv',
  entityId: string,
): {
  ready: boolean
  authenticated: boolean
  planned: boolean
  toggle: () => Promise<void>
} {
  const [ready, setReady] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [planned, setPlanned] = useState(false)

  useEffect(() => {
    let alive = true
    const key = `${entityType}:${entityId}`
    void loadShared().then((shared) => {
      if (!alive) return
      setAuthenticated(shared.authenticated)
      setPlanned(shared.planned.has(key))
      setReady(true)
    })
    const unsubscribe = subscribe(key, (next) => {
      if (alive) setPlanned(next)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [entityType, entityId])

  const toggle = async () => {
    const key = `${entityType}:${entityId}`
    if (planned) {
      const r = await authFetch('/api/me/watch-state/remove', {
        method: 'POST',
        body: JSON.stringify({ entityType, entityId }),
      })
      if (r.ok) await broadcastPlanned(key, false)
    } else {
      const r = await authFetch('/api/me/watch-state', {
        method: 'POST',
        body: JSON.stringify({ entityType, entityId, status: 'planned' }),
      })
      if (r.ok) await broadcastPlanned(key, true)
    }
  }

  return { ready, authenticated, planned, toggle }
}

export function CardBookmark({
  entityType,
  entityId,
  title,
  variant = 'square',
  label,
}: {
  entityType: 'movie' | 'tv'
  entityId: string
  title: string
  variant?: 'square' | 'circle'
  /** Com label, vira o botao-pill rotulado do canonico (ex.: "Minha lista"). */
  label?: string
}): ReactNode {
  // Mesmo estado compartilhado por entidade do hook: dois controles da MESMA
  // entidade na página nunca divergem após um toggle.
  const { ready, authenticated, planned, toggle } = useWatchlistEntry(entityType, entityId)

  const className =
    label !== undefined
      ? 'card-bookmark card-bookmark--pill'
      : variant === 'circle'
        ? 'card-bookmark card-bookmark--circle'
        : 'card-bookmark'
  const content = (
    <>
      <BookmarkIcon />
      {label !== undefined ? <span>{label}</span> : null}
    </>
  )

  if (!ready || !authenticated) {
    // Anonimo (ou estado ainda carregando): a acao leva ao login REAL.
    return (
      <a
        aria-label={`Entrar para salvar ${title} na watchlist`}
        className={className}
        href="/pt/entrar/"
        onClick={(event) => {
          // Evita navegar o card inteiro quando o bookmark esta dentro de um <a>.
          event.stopPropagation()
        }}
      >
        {content}
      </a>
    )
  }

  const onToggle = async (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    await toggle()
  }

  return (
    <button
      aria-label={
        planned ? `Remover ${title} da watchlist` : `Adicionar ${title} à watchlist`
      }
      aria-pressed={planned}
      className={className}
      onClick={(event) => void onToggle(event)}
      type="button"
    >
      {content}
    </button>
  )
}
