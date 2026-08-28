'use client'

/**
 * PopularThisWeek — "Popular essa semana": faixa escura com o ranking da semana.
 *
 * ============ AS ABAS SAO CONTROLE, NAO ENFEITE ============
 *
 * Antes eram `<a href>` que NAVEGAVAM para outra rota, com o conjunto da home
 * (`Filmes`/`Séries`) repetido nas tres paginas. Clicar em "Séries" dentro de
 * `/pt/filmes` levava o leitor para fora da vertical — a pagina de filmes
 * convidava a ver series.
 *
 * Agora sao `<button role="tab">` dentro de um `role="tablist"`, cada uma com o
 * seu proprio recorte ja consultado no servidor (`server/popular-rankings.ts`).
 * Trocar de aba troca a LISTA, nao a rota.
 *
 * ============ O ESTADO VIVE NA URL ============
 *
 * A aba ativa vai para `?ranking=<slug>` via `history.replaceState`: o link fica
 * compartilhavel e sobrevive ao refresh (o servidor le o param e ja renderiza a
 * aba certa). `replaceState` e nao `pushState` de proposito — o botao "voltar"
 * do navegador pertence a navegacao entre paginas, nao a troca de recorte
 * dentro de uma secao.
 *
 * ============ O CARD E POSTER + NUMERO ============
 *
 * Sem titulo visivel, sem nota, sem badge. Por isso o numero — que E informacao
 * — entra no nome acessivel do link ("1. Duna: Parte Dois") e a imagem vai com
 * `alt=""`, para o leitor de tela nao ouvir o titulo duas vezes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { SectionTitle } from './ds'
import { Rail } from './rail'
import {
  RANKING_EMPTY_MESSAGE,
  RANKING_QUERY_PARAM,
  rankedTitleAccessibleName,
  resolveActiveRankingSlug,
  type RankedTitle,
  type RankingTab,
  type RankingTabSlug,
  type RankingVertical,
} from '../../src/lib/popular-rankings'

/** Uma aba ja com a sua lista resolvida no servidor. */
export interface PopularRankingPanel {
  readonly tab: RankingTab
  readonly items: readonly RankedTitle[]
}

export interface PopularThisWeekProps {
  readonly headingId: string
  readonly panels: readonly PopularRankingPanel[]
  /**
   * Vertical da rota — decide QUAL conjunto de abas o `?ranking=` pode
   * selecionar. Um `?ranking=` de outra vertical continua caindo na primeira
   * aba desta, como antes; a diferenca e que quem aplica a regra agora e o
   * cliente, e nao o servidor.
   */
  readonly vertical: RankingVertical
}

function RankedPosterCard({ item }: { item: RankedTitle }): ReactNode {
  return (
    <a className="pop-rail__item" href={item.href}>
      <span className="pop-rail__poster">
        {item.posterUrl !== null ? <img alt="" loading="lazy" src={item.posterUrl} /> : null}
      </span>
      <span aria-hidden="true" className="pop-rail__rank">
        <span>{item.rank}</span>
      </span>
      <span className="visually-hidden">{rankedTitleAccessibleName(item)}</span>
    </a>
  )
}

export function PopularThisWeek({
  headingId,
  panels,
  vertical,
}: PopularThisWeekProps): ReactNode {
  // A primeira pintura e SEMPRE a aba default da vertical — e por isso o HTML
  // do servidor nao depende de `?ranking=` e a rota pode ser guardada.
  const [active, setActive] = useState<RankingTabSlug>(() =>
    resolveActiveRankingSlug(vertical, null),
  )
  // Marca se o leitor ja escolheu uma aba nesta sessao. Sem isso, o efeito que
  // le a URL brigaria com o clique: `replaceState` escreve `?ranking=` e a
  // leitura seguinte reafirmaria o mesmo valor a cada render.
  const escolhaDoLeitor = useRef(false)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const panelRef = useRef<HTMLDivElement>(null)

  const activePanel = panels.find((panel) => panel.tab.slug === active) ?? panels[0]

  // DEEP LINK: `?ranking=` e aplicado na MONTAGEM, no cliente. Antes quem lia
  // era o servidor (`searchParams`), e essa unica leitura tornava a rota inteira
  // dinamica — a home nunca podia ser guardada. Ler aqui custa uma pintura da
  // aba default numa secao que fica abaixo da dobra, e devolve o cache.
  useEffect(() => {
    if (escolhaDoLeitor.current) return
    const pedida = new URL(window.location.href).searchParams.get(RANKING_QUERY_PARAM)
    if (pedida === null) return
    setActive(resolveActiveRankingSlug(vertical, pedida))
  }, [vertical])

  // A URL acompanha a aba SEM re-render do servidor: `router.replace` faria a
  // rota inteira ser refeita a cada clique, o que reintroduziria exatamente o
  // salto de layout que esta secao nao pode ter — e invalidaria o cache.
  useEffect(() => {
    if (activePanel === undefined) return
    const url = new URL(window.location.href)
    if (url.searchParams.get(RANKING_QUERY_PARAM) === activePanel.tab.slug) return
    url.searchParams.set(RANKING_QUERY_PARAM, activePanel.tab.slug)
    window.history.replaceState(window.history.state, '', url)
  }, [activePanel])

  const select = useCallback((slug: RankingTabSlug) => {
    escolhaDoLeitor.current = true
    setActive(slug)
    // Trocar de aba reseta o scroll do carrossel: a posicao 1 do novo recorte
    // tem de estar visivel, e nao a posicao 7 do recorte anterior.
    panelRef.current?.querySelector('.pop-rail')?.scrollTo({ left: 0 })
  }, [])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = panels.findIndex((panel) => panel.tab.slug === active)
    const last = panels.length - 1
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length
    const next = panels[nextIndex]
    if (next === undefined) return
    select(next.tab.slug)
    tabRefs.current[next.tab.slug]?.focus()
  }

  if (activePanel === undefined) return null

  return (
    <div className="band band--dark">
      <section aria-labelledby={headingId} className="band__inner">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <SectionTitle id={headingId} title="Popular essa semana" />
          {/* "Ver tudo" segue o recorte ATIVO — nunca um link fixo. */}
          <a className="see-all" href={activePanel.tab.seeAllHref}>
            Ver tudo
          </a>
        </div>

        <div aria-label="Recorte do ranking" className="pop-tabs" role="tablist">
          {panels.map((panel) => (
            <button
              aria-controls={`${headingId}-panel-${panel.tab.slug}`}
              aria-selected={panel.tab.slug === active}
              className="pop-tabs__tab"
              id={`${headingId}-tab-${panel.tab.slug}`}
              key={panel.tab.slug}
              onClick={() => select(panel.tab.slug)}
              onKeyDown={onKeyDown}
              ref={(node) => {
                tabRefs.current[panel.tab.slug] = node
              }}
              role="tab"
              tabIndex={panel.tab.slug === active ? 0 : -1}
              type="button"
            >
              {panel.tab.label}
            </button>
          ))}
        </div>

        <div
          aria-labelledby={`${headingId}-tab-${activePanel.tab.slug}`}
          id={`${headingId}-panel-${activePanel.tab.slug}`}
          ref={panelRef}
          role="tabpanel"
          tabIndex={0}
        >
          {activePanel.items.length === 0 ? (
            // A secao NAO some com a aba vazia: some-la tornaria o recorte
            // invisivel para quem olha a pagina. A altura minima preserva o
            // ritmo da faixa, entao trocar para uma aba vazia nao sacode a pagina.
            <p className="pop-empty">{RANKING_EMPTY_MESSAGE}</p>
          ) : (
            <Rail className="pop-rail" dark label={`Popular essa semana: ${activePanel.tab.label}`}>
              {activePanel.items.map((item) => (
                <RankedPosterCard item={item} key={item.id} />
              ))}
            </Rail>
          )}
        </div>
      </section>
    </div>
  )
}
