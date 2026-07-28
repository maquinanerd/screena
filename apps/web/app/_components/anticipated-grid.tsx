'use client'

/**
 * AnticipatedGrid — tela 12 do canônico (Mais Aguardados), estrutura EXATA:
 * head (h1 + total + tabs de período) → barra filtro/ordenar com bordas →
 * grade auto-fill de Media Anticipation Cards (pôster 116px + painel de info,
 * badge de tipo, pílula de data, CTA de watchlist REAL).
 *
 * Estados honestos:
 *  - filtros/ordenar/período operam sobre dados REAIS serializados do servidor;
 *  - sem contagem "aguardando" nem ordenação "Mais salvos": não há agregado de
 *    comunidade ativo (delta honesto — composição preservada, métrica omitida);
 *  - "Data não confirmada" = estado real âmbar canônico (nunca data inventada);
 *  - watchlist = UserWatchState.planned via API com CSRF (nunca estado fake).
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import type { AnticipatedCard, AnticipatedKind } from '../../src/lib/anticipated-presenter'
import { useWatchlistEntry } from './card-bookmark'
import {
  CANON_TYPE,
  IcAlert,
  IcBookmark,
  IcBookmarkFilled,
  IcCal2,
  IcCheck2,
} from './canon-icons'

type Period = '30d' | 'year' | 'nodate'
type Filter = 'all' | AnticipatedKind
type Sort = 'date' | 'added'

const PERIODS: { key: Period; label: string }[] = [
  { key: '30d', label: 'Próximos 30 dias' },
  { key: 'year', label: 'Este ano' },
  { key: 'nodate', label: 'Sem data' },
]

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tudo' },
  { key: 'movie', label: 'Filmes' },
  { key: 'tv', label: 'Séries' },
  { key: 'season', label: 'Temporadas' },
  { key: 'episode', label: 'Episódios' },
]

const SORTS: { key: Sort; label: string }[] = [
  { key: 'date', label: 'Estreia' },
  { key: 'added', label: 'Adicionados recentemente' },
]

const DAY_MS = 24 * 60 * 60 * 1000

function inPeriod(card: AnticipatedCard, period: Period, nowMs: number): boolean {
  if (period === 'nodate') return card.dateIso === null
  if (card.dateIso === null) return false
  const dateMs = Date.parse(card.dateIso)
  if (!Number.isFinite(dateMs)) return false
  if (period === '30d') return dateMs - nowMs <= 30 * DAY_MS
  return new Date(dateMs).getUTCFullYear() === new Date(nowMs).getUTCFullYear()
}

function AnticipatedCardView({ card }: { card: AnticipatedCard }): ReactNode {
  const type = CANON_TYPE[card.kind]
  const TypeIcon = type.Icon
  const { ready, authenticated, planned, toggle } = useWatchlistEntry(
    card.bookmarkType,
    card.bookmarkId,
  )

  const saved = ready && authenticated && planned
  const bookmarkLabel = saved
    ? `Remover ${card.title} da watchlist`
    : `Adicionar ${card.title} à watchlist`

  const action = (content: ReactNode, className: string) =>
    !ready || !authenticated ? (
      <a aria-label={`Entrar para salvar ${card.title} na watchlist`} className={className} href="/pt/entrar/">
        {content}
      </a>
    ) : (
      <button
        aria-label={bookmarkLabel}
        aria-pressed={planned}
        className={className}
        onClick={() => void toggle()}
        type="button"
      >
        {content}
      </button>
    )

  return (
    <article
      className={saved ? 'ant-card ant-card--saved' : 'ant-card'}
      data-entity-type={card.kind}
      style={{ ['--ant-accent' as string]: type.accentVar }}
    >
      <div className="ant-card__poster">
        {card.posterUrl !== null ? <img alt="" loading="lazy" src={card.posterUrl} /> : null}
        <span className="ant-card__type">
          <TypeIcon size={10} /> {type.label}
        </span>
        {saved ? <span className="ant-card__ribbon">Na watchlist</span> : null}
      </div>
      <div className="ant-card__info">
        <div className="ant-card__head">
          <div className="ant-card__names">
            <h3 className="ant-card__title">
              <a href={card.href}>{card.title}</a>
            </h3>
            {card.original !== null ? <p className="ant-card__original">{card.original}</p> : null}
          </div>
          <div className="ant-card__icons">
            {action(saved ? <IcBookmarkFilled size={16} /> : <IcBookmark size={16} />, 'ant-card__bm')}
          </div>
        </div>
        <div className="ant-card__meta-row">
          <span className="ant-card__meta">{card.metaLine}</span>
        </div>
        <div className="ant-card__spacer" />
        <div className="ant-card__foot">
          <span
            className={
              card.unconfirmed ? 'ant-card__date ant-card__date--unconfirmed' : 'ant-card__date'
            }
          >
            {card.unconfirmed ? <IcAlert size={11} /> : <IcCal2 size={11} />}
            {card.dateLabel}
          </span>
        </div>
        {action(
          <>
            {saved ? <IcCheck2 size={14} /> : <IcBookmark size={14} />}
            {saved ? 'Na watchlist' : 'Adicionar à watchlist'}
          </>,
          saved ? 'ant-card__cta ant-card__cta--saved' : 'ant-card__cta',
        )}
      </div>
    </article>
  )
}

export function AnticipatedGrid({
  cards,
  total,
}: {
  cards: AnticipatedCard[]
  total: number
}): ReactNode {
  const [period, setPeriod] = useState<Period>('30d')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('date')
  const nowMs = useMemo(() => Date.now(), [])

  const visible = useMemo(() => {
    const filtered = cards.filter(
      (card) => (filter === 'all' || card.kind === filter) && inPeriod(card, period, nowMs),
    )
    return [...filtered].sort((a, b) => {
      if (sort === 'added') return b.addedAtIso.localeCompare(a.addedAtIso)
      if (a.dateIso === null && b.dateIso === null) return a.title.localeCompare(b.title, 'pt-BR')
      if (a.dateIso === null) return 1
      if (b.dateIso === null) return -1
      return a.dateIso.localeCompare(b.dateIso)
    })
  }, [cards, filter, period, sort, nowMs])

  return (
    <>
      <div className="ant-head">
        <div>
          <h1 className="ant-title">Mais Aguardados</h1>
          <p className="ant-sub">
            Filmes, séries e episódios com estreia confirmada ou anunciada —{' '}
            <strong>
              {total} título{total === 1 ? '' : 's'}
            </strong>
            .
          </p>
        </div>
        <div aria-label="Filtrar por período" className="ant-tabs" role="tablist">
          {PERIODS.map((p) => (
            <button
              aria-selected={period === p.key}
              className="ant-tab"
              key={p.key}
              onClick={() => setPeriod(p.key)}
              role="tab"
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ant-bar">
        <div aria-label="Filtrar por tipo" className="ant-tabs ant-tabs--filter" role="tablist">
          {FILTERS.map((f) => (
            <button
              aria-selected={filter === f.key}
              className="ant-tab ant-tab--filter"
              key={f.key}
              onClick={() => setFilter(f.key)}
              role="tab"
              type="button"
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ant-sort">
          <span className="ant-sort__label">Ordenar</span>
          <div aria-label="Ordenar" className="ant-tabs" role="tablist">
            {SORTS.map((s) => (
              <button
                aria-selected={sort === s.key}
                className="ant-tab ant-tab--sort"
                key={s.key}
                onClick={() => setSort(s.key)}
                role="tab"
                type="button"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="ant-grid">
          {visible.map((card) => (
            <AnticipatedCardView card={card} key={`${card.kind}:${card.href}`} />
          ))}
        </div>
      ) : (
        <p className="muted ant-empty">Nenhum título nesse recorte por enquanto.</p>
      )}
    </>
  )
}
