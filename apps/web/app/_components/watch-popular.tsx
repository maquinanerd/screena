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

/**
 * Uma MARCA do hub: um nome que o leitor reconhece e as rotas que levam a ela.
 *
 * O hub listava PROVEDOR, e com os 24 provedores BR isso virou "Paramount
 * Plus", "Paramount Plus Premium" e "Paramount+ Amazon Channel" como se fossem
 * tres servicos. A marca aparece uma vez; as rotas ficam embaixo dela, como ja
 * acontece no painel da pagina de titulo. A decomposicao e DECLARADA em
 * `@screena/public-contracts`, nunca derivada da string do nome.
 */
export interface WatchPopularBrand {
  key: string
  name: string
  /** Rotas da marca. `label` null = marca de rota unica (nome ja diz tudo). */
  routes: { providerName: string; label: string | null }[]
  titles: WatchPopularTitle[]
}

const GRID_LIMIT = 12

export function WatchPopular({ brands }: { brands: WatchPopularBrand[] }): ReactNode {
  const [active, setActive] = useState<string>('all')

  const titles =
    active === 'all'
      ? dedupe(brands.flatMap((brand) => brand.titles))
      : (brands.find((brand) => brand.key === active)?.titles ?? [])

  const activeBrand = brands.find((brand) => brand.key === active) ?? null

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
        {brands.map((brand) => (
          <button
            aria-selected={active === brand.key}
            className="watch-tab"
            key={brand.key}
            onClick={() => setActive(brand.key)}
            role="tab"
            type="button"
          >
            {brand.name}
          </button>
        ))}
      </div>
      {/*
        AS ROTAS DA MARCA, quando ha mais de uma. Some-las seria esconder um
        custo atras do nome: "canal no Prime Video" quer dizer que o leitor
        precisa do hospedeiro MAIS o canal. Texto visivel, nunca atributo.
      */}
      {activeBrand !== null && activeBrand.routes.length > 1 ? (
        <ul className="watch-brand-routes">
          {activeBrand.routes.map((route) => (
            <li className="watch-brand-routes__item" key={route.providerName}>
              <span className="watch-brand-routes__name">{route.providerName}</span>
              {route.label !== null ? (
                <span className="watch-brand-routes__label">{route.label}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
