'use client'

import { useEffect, useState } from 'react'

import { authFetch } from '../../src/lib/csrf-client'

/**
 * EntityActions — os DOIS botoes do topo canonico. Exatamente dois:
 *
 *   `Minha lista` (icone de marcador) — guarda o titulo na biblioteca do
 *   usuario (watch-state `planned`; clicar de novo remove).
 *   `Avaliar` (icone de estrela) — abre o seletor de nota pessoal (0,5..5,0)
 *   e grava via `/api/me/ratings`.
 *
 * Os quatro botoes anteriores ("Quero assistir", "Acompanhar serie",
 * "Assistido", "Acompanhar no tracker") sairam do topo por decisao do dono
 * (20/08/2026). As capacidades nao morreram: acompanhar/assistido continuam na
 * biblioteca e no tracker (/pt/minha-lista, /pt/tracker) — o TOPO e que tem
 * dois gestos, como o canonico desenha. Travado por teste que conta os botoes.
 *
 * Componente de CLIENTE: fala com a borda por `fetch` APOS clique/mount —
 * nenhuma chamada externa no render (server component puro). CSRF via
 * `authFetch`. `entityId` e o id INTERNO do catalogo (sobrevive a mudanca de
 * slug).
 *
 * Anonimo: os dois botoes existem (o canonico nao muda por sessao); o clique
 * vira convite para entrar, em `role="status"` — nunca um erro mudo.
 */

interface EntityActionsProps {
  readonly entityType: 'movie' | 'tv'
  readonly entityId: string
}

/** Notas validas: 0,5..5,0 em passos de 0,5 (grade do banco). */
const RATING_STEPS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

function formatStep(value: number): string {
  return String(value).replace('.', ',')
}

export function EntityActions({ entityType, entityId }: EntityActionsProps): React.ReactElement {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [inList, setInList] = useState(false)
  const [myRating, setMyRating] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
        const sessao = (await s.json()) as { authenticated: boolean }
        setAuthenticated(sessao.authenticated)
        if (!sessao.authenticated) return
        const lib = await fetch(`/api/me/library?status=planned&limit=100`, {
          credentials: 'same-origin',
        })
        if (lib.ok) {
          const dados = (await lib.json()) as {
            items: { entityType: string; entityId: string; status: string }[]
          }
          setInList(
            dados.items.some((i) => i.entityType === entityType && i.entityId === entityId),
          )
        }
      } catch {
        setAuthenticated(false)
      }
    })()
  }, [entityType, entityId])

  function inviteToSignIn(): void {
    setNotice('Entre na sua conta para usar a lista e avaliar.')
  }

  async function toggleList(): Promise<void> {
    setNotice(null)
    if (authenticated === false) {
      inviteToSignIn()
      return
    }
    const path = inList ? '/api/me/watch-state/remove' : '/api/me/watch-state'
    const body = inList
      ? { entityType, entityId }
      : { entityType, entityId, status: 'planned' }
    const r = await authFetch(path, { method: 'POST', body: JSON.stringify(body) })
    if (r.ok) setInList(!inList)
    else if (r.status === 401) inviteToSignIn()
    else setNotice('Nao foi possivel atualizar agora.')
  }

  async function rate(value: number): Promise<void> {
    setNotice(null)
    const r = await authFetch('/api/me/ratings', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, value }),
    })
    if (r.ok) {
      setMyRating(value)
      setPickerOpen(false)
      setNotice(`Sua nota: ${formatStep(value)}.`)
    } else if (r.status === 401) {
      inviteToSignIn()
    } else {
      setNotice('Nao foi possivel avaliar agora.')
    }
  }

  function toggleRatingPicker(): void {
    setNotice(null)
    if (authenticated === false) {
      inviteToSignIn()
      return
    }
    setPickerOpen((open) => !open)
  }

  return (
    <div aria-label="Acoes do titulo" className="hero-actions" role="group">
      <div className="hero-actions__row">
        <button
          aria-pressed={inList}
          className="hero-action"
          data-action="minha-lista"
          onClick={() => void toggleList()}
          type="button"
        >
          <svg aria-hidden="true" className="hero-action__icon" viewBox="0 0 24 24">
            <path
              d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"
              fill={inList ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          Minha lista
        </button>
        <button
          aria-expanded={pickerOpen}
          aria-pressed={myRating !== null}
          className="hero-action"
          data-action="avaliar"
          onClick={toggleRatingPicker}
          type="button"
        >
          <svg aria-hidden="true" className="hero-action__icon hero-action__icon--star" viewBox="0 0 24 24">
            <path
              d="m12 2 3 6.6 7 .8-5.2 4.8L18.3 21 12 17.4 5.7 21l1.5-6.8L2 9.4l7-.8Z"
              fill={myRating !== null ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          Avaliar
        </button>
      </div>
      {pickerOpen ? (
        <div aria-label="Escolha sua nota" className="hero-actions__picker" role="group">
          {RATING_STEPS.map((step) => (
            <button
              aria-pressed={myRating === step}
              className="hero-actions__step"
              key={step}
              onClick={() => void rate(step)}
              type="button"
            >
              {formatStep(step)}
            </button>
          ))}
        </div>
      ) : null}
      {notice !== null ? (
        <p className="hero-actions__notice" role="status">
          {notice}{' '}
          {authenticated === false ? <a href="/pt/entrar">Entrar</a> : null}
        </p>
      ) : null}
    </div>
  )
}
