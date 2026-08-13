'use client'

/**
 * HomeTicker — faixa amarela do canônico, entre o hero e "Destaques de hoje".
 *
 * Ela é um CARROSSEL INDEPENDENTE de novidades reais (4–5 itens no cenário
 * completo), não "o episódio de hoje ou um fallback". Um item por vez; os dots
 * representam TODOS os itens; autoplay + controle manual + teclado.
 *
 * Cada item pode ser episódio (hoje/próximo), estreia de filme, estreia de
 * temporada ou chegada ao streaming — o `kind` decide o texto e o CTA. Nenhum
 * dado de sessão de cinema (formato, idioma, sala, rede, horário) é exibido:
 * o sistema não persiste esses fatos.
 *
 * PROVEDOR: o `provider` de cada item já veio aprovado pelo gate compartilhado
 * de `watch_availability` (licensedWatchWhere + presenter puro). Quando ele
 * existe, o CTA vira "Onde assistir · <provedor>" e o CRÉDITO exigido pela
 * licença é renderizado VISIVELMENTE (com linkback quando exigido) — exibir a
 * oferta sem o crédito violaria a licença que autoriza exibi-la. O crédito
 * acompanha o item ATIVO: ao trocar de slide, o crédito do item anterior some.
 *
 * A faixa é ESTRUTURA da home: sem novidade nenhuma ela permanece, em estado
 * neutro e honesto.
 *
 * Independente do hero: autoplay e índice próprios, nunca sincronizados.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { HomeTickerItem, TickerProvider } from '../../src/lib/home-ticker-presenter'
// `routes` (não `site`): módulo puro, importável em client component.
import { SERIES_INDEX_PATH } from '../../src/lib/routes'

/** Intervalo do autoplay da faixa. Independente do autoplay do hero. */
const AUTOPLAY_MS = 6000

/**
 * Crédito da licença do agregador. Renderizado SEMPRE que o provedor exigir
 * atribuição — sem ele a oferta não poderia aparecer (invariante 6).
 */
function TickerCredit({ provider }: { provider: TickerProvider }): ReactNode {
  if (provider.attributionText === null) return null
  return (
    <p className="ticker__credit">
      {provider.attributionUrl !== null ? (
        <a href={provider.attributionUrl} rel="nofollow noopener" target="_blank">
          {provider.attributionText}
        </a>
      ) : (
        provider.attributionText
      )}
    </p>
  )
}

/** Rótulo curto do item, usado no `aria-label` do dot correspondente. */
function itemLabel(item: HomeTickerItem): string {
  return `${item.title} — ${item.detail}`
}

/**
 * CTA por tipo de novidade. Com provedor licenciado, "Onde assistir ·
 * <provedor>"; sem ele, a ficha real da entidade ("Ver filme" / "Ver série").
 * Nunca plataforma que não tenha vindo do banco, nunca logo.
 */
function ctaLabel(item: HomeTickerItem): ReactNode {
  if (item.provider !== null) {
    return (
      <>
        {/*
          MODALIDADE em TEXTO VISIVEL, ao lado do nome — nao em `aria-label`,
          nao em `title`, nao em atributo sem estilo. Compra e aluguel sao a
          maioria do corpus: "Onde assistir <loja>" sozinho afirma ao leitor que
          o titulo esta incluso no que ele ja paga, quando o que existe e um
          aluguel avulso. Informacao que muda o que o leitor espera nao pode
          viver so em atributo de acessibilidade — a mesma regra que o rotulo
          "pagina de disponibilidade" ja fixou no painel de detalhe.

          Nenhum nome de plataforma aparece neste arquivo, nem em comentario: o
          guard de governanca varre o TEXTO do componente, e uma marca citada em
          comentario reprova igual (ver no-fake-streaming-in-ui).
        */}
        Onde assistir <strong>{item.provider.name}</strong>
        <span className="home-ticker__modality"> · {item.provider.modalityLabel}</span>
      </>
    )
  }
  return item.entityType === 'movie' ? 'Ver filme' : 'Ver série'
}

export function HomeTicker({ items }: { items: readonly HomeTickerItem[] }): ReactNode {
  const [active, setActive] = useState(0)
  // Hover e foco sao rastreados SEPARADAMENTE de proposito: com um unico
  // booleano, sair do foco (tab) religava o autoplay mesmo com o mouse ainda
  // parado sobre a faixa — e o texto trocava embaixo do cursor de quem estava
  // lendo.
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const paused = hovered || focused
  const dotRefs = useRef<Array<HTMLButtonElement | null>>([])
  const textId = useId()

  const count = items.length
  const index = count > 0 ? Math.min(active, count - 1) : 0
  const item = count > 0 ? (items[index] as HomeTickerItem) : null

  // Autoplay: desligado com 0/1 item, em hover/foco e sob `prefers-reduced-motion`.
  // A navegação MANUAL continua funcionando em todos esses casos.
  useEffect(() => {
    if (count < 2 || paused) return undefined
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    if (motionQuery?.matches === true) return undefined
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % count)
    }, AUTOPLAY_MS)
    return () => window.clearInterval(timer)
  }, [count, paused])

  const go = (next: number): void => {
    if (count === 0) return
    const target = (next + count) % count
    setActive(target)
    dotRefs.current[target]?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(index + 1)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(index - 1)
    }
  }

  return (
    <div
      aria-label="Novidades"
      className="ticker"
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="region"
    >
      <div className="ticker__inner">
        {/* `aria-live` polido e restrito ao TEXTO: anunciar o container inteiro
            faria o leitor de tela repetir os dots e o CTA a cada troca de
            slide. Com 1 item ou nenhum não há troca a anunciar. */}
        <div aria-live={count > 1 ? 'polite' : 'off'} className="ticker__lead">
          <span className="ticker__label">{item === null ? 'AGENDA' : item.badge}</span>
          <span className="ticker__text" id={textId}>
            {item === null ? (
              'Nenhuma novidade confirmada para hoje'
            ) : (
              <>
                <strong>{item.title}</strong> · {item.detail}
              </>
            )}
          </span>
        </div>
        <div className="ticker__controls">
          {count > 1 ? (
            <div aria-label="Selecionar novidade" className="ticker__dots" role="tablist">
              {items.map((entry, dotIndex) => (
                <button
                  aria-controls={textId}
                  aria-label={itemLabel(entry)}
                  aria-selected={dotIndex === index}
                  className="ticker__dot"
                  key={entry.id}
                  onClick={() => go(dotIndex)}
                  onKeyDown={onKeyDown}
                  ref={(node) => {
                    dotRefs.current[dotIndex] = node
                  }}
                  role="tab"
                  tabIndex={dotIndex === index ? 0 : -1}
                  type="button"
                />
              ))}
            </div>
          ) : null}
          <a className="ticker__cta" href={item === null ? SERIES_INDEX_PATH : item.href}>
            {item === null ? 'Ver lançamentos' : ctaLabel(item)}
          </a>
        </div>
        {/* O crédito pertence ao item ATIVO: trocou de slide, trocou o crédito. */}
        {item?.provider != null ? <TickerCredit provider={item.provider} /> : null}
      </div>
    </div>
  )
}
