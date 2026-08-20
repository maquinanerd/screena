'use client'

/**
 * "Continuar assistindo" — tela 11 do canônico, como FRONTEIRA AUTENTICADA:
 * dados pessoais só via /api/me/** no cliente, depois do mount (nada entra em
 * cache compartilhado de render). Fluxo real: sessão → biblioteca `watching`
 * → progresso por série (percent + próximo episódio, Backend C8) → cartões
 * públicos do catálogo em UM lote (/api/catalog/summary).
 *
 * DESLOGADO: A SEÇÃO INTEIRA NÃO APARECE. Não vira caixa vazia nem esqueleto
 * mudo — e é por isso que o componente carrega o próprio `<section>` (título
 * incluído) em vez de receber só o corpo. A maioria dos visitantes é anônima;
 * um bloco pessoal com cabeçalho e uma linha cinza é a promessa que a página
 * não pode cumprir para eles.
 *
 * LOGADO E SEM HISTÓRICO é outra coisa: ali a seção PODE ter sucesso, então ela
 * existe com estado vazio honesto.
 *
 * A AUSÊNCIA NÃO É MUDA — mas o log dela é do CLIENTE, não do servidor. A
 * condição ("não há sessão") só é conhecida depois do mount, atrás da fronteira
 * autenticada: `SectionBoundary` é Server Component e não alcança este ponto.
 * A linha sai no MESMO formato (`section_absent`, JSON filtrável) e UMA vez por
 * carregamento, porque repetir não acrescenta informação nenhuma.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import {
  buildRouteSectionAbsence,
  formatSectionAbsence,
} from '../../src/lib/section-absence'

interface CardData {
  entityType: 'movie' | 'tv'
  entityId: string
  title: string
  href: string
  backdropUrl: string | null
  posterUrl: string | null
  percent: number | null
  nextUp: string | null
}

type State =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'empty' }
  | { kind: 'error' }
  | { kind: 'ready'; cards: CardData[] }

const LIMIT = 4

async function load(): Promise<State> {
  try {
    const s = await fetch('/api/auth/session', { credentials: 'same-origin' })
    const session = (await s.json()) as { authenticated: boolean }
    if (!session.authenticated) return { kind: 'anonymous' }

    const lib = await fetch('/api/me/library?status=watching&limit=12', {
      credentials: 'same-origin',
    })
    if (!lib.ok) return { kind: 'error' }
    const data = (await lib.json()) as {
      items?: { entityType: 'movie' | 'tv'; entityId: string; status: string }[]
    }
    const items = (data.items ?? []).slice(0, LIMIT)
    if (items.length === 0) return { kind: 'empty' }

    const ids = items.map((item) => `${item.entityType}:${item.entityId}`).join(',')
    const [summaryRes, ...progressRes] = await Promise.all([
      fetch(`/api/catalog/summary?ids=${encodeURIComponent(ids)}`, {
        credentials: 'same-origin',
      }),
      ...items
        .filter((item) => item.entityType === 'tv')
        .map((item) =>
          fetch(`/api/me/series-progress/${encodeURIComponent(item.entityId)}`, {
            credentials: 'same-origin',
          }),
        ),
    ])
    if (!summaryRes.ok) return { kind: 'error' }
    const summary = (await summaryRes.json()) as {
      items: {
        entityType: 'movie' | 'tv'
        entityId: string
        title: string
        href: string
        backdropUrl: string | null
        posterUrl: string | null
      }[]
    }
    const byKey = new Map(summary.items.map((item) => [`${item.entityType}:${item.entityId}`, item]))

    const progressByTv = new Map<string, { percent: number; nextUp: string | null }>()
    const tvItems = items.filter((item) => item.entityType === 'tv')
    for (let index = 0; index < progressRes.length; index += 1) {
      const res = progressRes[index]
      const tvItem = tvItems[index]
      if (res === undefined || tvItem === undefined || !res.ok) continue
      const body = (await res.json()) as {
        progress?: {
          percent?: number
          nextEpisode?: { seasonNumber: number; episodeNumber: number } | null
        }
      }
      const percent = typeof body.progress?.percent === 'number' ? body.progress.percent : 0
      const next = body.progress?.nextEpisode ?? null
      progressByTv.set(tvItem.entityId, {
        percent,
        nextUp: next === null ? null : `T${next.seasonNumber} · E${next.episodeNumber}`,
      })
    }

    const cards: CardData[] = []
    for (const item of items) {
      const meta = byKey.get(`${item.entityType}:${item.entityId}`)
      if (meta === undefined) continue
      const progress = item.entityType === 'tv' ? progressByTv.get(item.entityId) : undefined
      cards.push({
        entityType: item.entityType,
        entityId: item.entityId,
        title: meta.title,
        href: meta.href,
        backdropUrl: meta.backdropUrl,
        posterUrl: meta.posterUrl,
        percent: progress?.percent ?? null,
        nextUp: progress?.nextUp ?? null,
      })
    }
    return cards.length === 0 ? { kind: 'empty' } : { kind: 'ready', cards }
  } catch {
    return { kind: 'error' }
  }
}

/** O cabeçalho canônico da seção. Só existe quando o corpo pode existir. */
function Head(): ReactNode {
  return (
    <div className="disc-section-head">
      <div className="eyebrow-bar">
        <span aria-hidden="true" className="eyebrow-bar__mark" />
        <h2 className="section-title section-title--sm" id="disc-cw-title">
          <strong>Continuar</strong> <span>assistindo</span>
        </h2>
      </div>
      <span className="disc-note">De onde você parou</span>
    </div>
  )
}

function Section({ children }: { children: ReactNode }): ReactNode {
  return (
    <section aria-labelledby="disc-cw-title" className="disc-section" data-vertical="series">
      <Head />
      {children}
    </section>
  )
}

export function ContinueWatching({ route }: { route: string }): ReactNode {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    void load().then((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (state.kind !== 'anonymous') return
    // Mesmo formato do log do servidor, para o mesmo filtro
    // (`event=section_absent section=continuar-assistindo`).
    console.warn(
      formatSectionAbsence(
        buildRouteSectionAbsence({
          section: 'continuar-assistindo',
          reason: 'no_authenticated_visitor',
          route,
          vertical: 'mixed',
        }),
      ),
    )
  }, [state.kind, route])

  // Sem sessão a seção INTEIRA some — cabeçalho incluído. Durante o load
  // também: um título que aparece e some seria pior que não aparecer.
  if (state.kind === 'loading' || state.kind === 'anonymous') return null

  if (state.kind === 'empty') {
    // LOGADO sem histórico: aqui a seção PODE ter sucesso, então ela existe.
    return (
      <Section>
        <p className="muted" role="status">
          Nada em andamento ainda — marque episódios assistidos para retomar daqui.
        </p>
      </Section>
    )
  }
  if (state.kind === 'error') {
    return (
      <Section>
        <p className="muted" role="alert">
          Não foi possível carregar seu progresso agora.
        </p>
      </Section>
    )
  }

  return (
    <Section>
    <div className="cw-grid">
      {state.cards.map((card) => (
        <a className="cw-card" data-entity-type={card.entityType} href={card.href} key={`${card.entityType}:${card.entityId}`}>
          <span className="cw-card__media">
            {card.backdropUrl !== null ? (
              <img alt="" loading="lazy" src={card.backdropUrl} />
            ) : card.posterUrl !== null ? (
              <img alt="" loading="lazy" src={card.posterUrl} />
            ) : null}
            <span
              className={
                card.entityType === 'movie'
                  ? 'cw-card__type'
                  : 'cw-card__type cw-card__type--series'
              }
            >
              {card.entityType === 'movie' ? 'Filme' : 'Série'}
            </span>
            {card.percent !== null ? (
              <span aria-hidden="true" className="cw-card__bar">
                <span style={{ width: `${Math.max(0, Math.min(100, card.percent))}%` }} />
              </span>
            ) : null}
          </span>
          <span className="cw-card__body">
            <span className="cw-card__title">{card.title}</span>
            {card.nextUp !== null ? <span className="cw-card__next">{card.nextUp}</span> : null}
            <span className="cw-card__cta">
              Continuar <span aria-hidden="true">›</span>
            </span>
          </span>
        </a>
      ))}
    </div>
    </Section>
  )
}
