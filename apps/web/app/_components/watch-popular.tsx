'use client'

/**
 * "Populares agora" — tela 10 do canônico: tabs REAIS de plataforma (uma por
 * provedor licenciado) + grade de 6 posters. Sem célula de rating/"Avaliar":
 * ratings externos e UI de avaliação seguem inativos (estado honesto; dado
 * ausente nunca vira outra métrica). Diferenciação filme/série por badge
 * textual (invariante 11).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

export interface WatchPopularTitle {
  entityType: 'movie' | 'tv'
  title: string
  href: string
  posterUrl: string | null
  /**
   * ROTULOS pt-BR ja prontos ("Assinatura", "Aluguel"), na ordem canonica.
   *
   * Este componente tinha um mapa de rotulos PROPRIO, divergente do painel de
   * detalhe: conhecia `addon` (valor que nao existe no enum `OfferType`), nao
   * conhecia `cinema`, e caia para `?? offer` — um valor novo do upstream ia
   * para a tela como jargao de API em ingles. O vocabulario agora e um so
   * (`watch-offer-modality.ts`) e a traducao acontece no servidor.
   */
  offerTypeLabels: string[]
}

export interface WatchPopularProvider {
  providerKey: string
  providerName: string
  titles: WatchPopularTitle[]
}

const GRID_LIMIT = 12

export function WatchPopular({ providers }: { providers: WatchPopularProvider[] }): ReactNode {
  const [active, setActive] = useState<string>('all')

  const titles =
    active === 'all'
      ? dedupe(providers.flatMap((provider) => provider.titles))
      : (providers.find((provider) => provider.providerKey === active)?.titles ?? [])

  return (
    <>
      <div aria-label="Filtrar por plataforma" className="watch-tabs" role="tablist">
        <button
          aria-selected={active === 'all'}
          className="watch-tab"
          onClick={() => setActive('all')}
          role="tab"
          type="button"
        >
          Todas
        </button>
        {providers.map((provider) => (
          <button
            aria-selected={active === provider.providerKey}
            className="watch-tab"
            key={provider.providerKey}
            onClick={() => setActive(provider.providerKey)}
            role="tab"
            type="button"
          >
            {provider.providerName}
          </button>
        ))}
      </div>
      <div className="watch-grid">
        {titles.slice(0, GRID_LIMIT).map((title) => (
          <a
            className="watch-card"
            data-entity-type={title.entityType}
            href={title.href}
            key={`${title.entityType}:${title.href}`}
          >
            <span className="watch-card__poster">
              {title.posterUrl !== null ? <img alt="" loading="lazy" src={title.posterUrl} /> : null}
              <span
                className={
                  title.entityType === 'movie'
                    ? 'watch-card__type'
                    : 'watch-card__type watch-card__type--series'
                }
              >
                {title.entityType === 'movie' ? 'Filme' : 'Série'}
              </span>
            </span>
            <span className="watch-card__title">{title.title}</span>
            {/*
              MODALIDADE em texto visivel, junto do titulo — os rotulos ja vem
              traduzidos e ordenados do servidor. Nada de `?? offer`: um valor
              que a tela nao sabe nomear e descartado com log, nunca impresso
              cru.
            */}
            {title.offerTypeLabels.length > 0 ? (
              <span className="watch-card__meta">{title.offerTypeLabels.join(' · ')}</span>
            ) : null}
          </a>
        ))}
      </div>
      {titles.length === 0 ? <p className="muted">Nenhum título nesse filtro.</p> : null}
    </>
  )
}

function dedupe(titles: WatchPopularTitle[]): WatchPopularTitle[] {
  const seen = new Set<string>()
  const out: WatchPopularTitle[] = []
  for (const title of titles) {
    const key = `${title.entityType}:${title.href}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(title)
  }
  return out
}
