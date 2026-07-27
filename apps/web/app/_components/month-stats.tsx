'use client'

/**
 * MonthStats — faixa "Seu mês em números" da home canonica (fundo #101010,
 * eyebrow amarela, valores 18/800 amarelos).
 *
 * DADO PESSOAL por boundary seguro: nada disto entra no render/​cache publico
 * compartilhado — o server component da home renderiza so a casca; os numeros
 * chegam por fetch autenticado no CLIENTE (`/api/me/history`, force-dynamic e
 * por sessao). Anonimo recebe o estado honesto (convite a entrar), nunca
 * numero fake.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

interface HistoryItem {
  eventType?: string
  entityType?: string
  occurredAt?: string
}

interface MonthStat {
  value: number
  label: string
}

type State =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'ready'; stats: MonthStat[] }

function computeMonthStats(items: readonly HistoryItem[]): MonthStat[] {
  const now = new Date()
  const month = now.getUTCMonth()
  const year = now.getUTCFullYear()
  const inMonth = items.filter((item) => {
    if (typeof item.occurredAt !== 'string') return false
    const at = new Date(item.occurredAt)
    return !Number.isNaN(at.getTime()) && at.getUTCMonth() === month && at.getUTCFullYear() === year
  })
  const movies = inMonth.filter((item) => item.entityType === 'movie').length
  const episodes = inMonth.filter((item) => item.entityType === 'episode').length
  const series = inMonth.filter((item) => item.entityType === 'tv').length
  return [
    { value: movies, label: movies === 1 ? 'filme' : 'filmes' },
    { value: episodes, label: episodes === 1 ? 'episódio' : 'episódios' },
    { value: series, label: series === 1 ? 'série' : 'séries' },
    { value: inMonth.length, label: inMonth.length === 1 ? 'registro' : 'registros' },
  ]
}

export function MonthStats(): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
        const session = (await s.json()) as { authenticated: boolean }
        if (!session.authenticated) {
          if (alive) setState({ kind: 'anonymous' })
          return
        }
        const r = await fetch('/api/me/history?limit=200', { credentials: 'same-origin' })
        if (!r.ok) {
          if (alive) setState({ kind: 'anonymous' })
          return
        }
        const data = (await r.json()) as { items?: HistoryItem[] }
        if (alive) setState({ kind: 'ready', stats: computeMonthStats(data.items ?? []) })
      } catch {
        if (alive) setState({ kind: 'anonymous' })
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="stats-strip">
      <div className="stats-strip__inner">
        <div className="stats-strip__left">
          <span className="stats-strip__eyebrow">
            <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15">
              <path
                d="M3 17l6-6 4 4 8-8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path d="M15 7h6v6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
            Seu mês em números
          </span>
          {state.kind === 'ready'
            ? state.stats.map((stat) => (
                <span className="stats-strip__stat" key={stat.label}>
                  <strong>{stat.value}</strong> {stat.label}
                </span>
              ))
            : null}
          {state.kind === 'anonymous' ? (
            <span className="stats-strip__stat">
              <a href="/pt/entrar/">Entre</a> para ver suas estatísticas do mês.
            </span>
          ) : null}
        </div>
        <a className="stats-strip__link" href="/pt/historico/">
          Ver histórico&nbsp;→
        </a>
      </div>
    </div>
  )
}
