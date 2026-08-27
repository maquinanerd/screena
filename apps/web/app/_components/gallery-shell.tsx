/**
 * gallery-shell.tsx — O casco compartilhado das quatro páginas de galeria.
 *
 * ============================================================================
 * UM COMPONENTE PARAMETRIZADO, NUNCA QUATRO
 * ============================================================================
 * `/pt/filmes/{slug}/imagens/`, `/pt/series/{slug}/imagens/` e as duas de
 * vídeo diferem em três coisas: o segmento da URL, o rótulo da vertical e o
 * conteúdo da grade. Quatro arquivos gêmeos divergiriam no primeiro conserto
 * aplicado a um e esquecido nos outros.
 *
 * A DIFERENCIAÇÃO filme/série (invariante 11) NÃO é feita por cor: este casco
 * emite **label** ("Filme"/"Série"), **badge**, **breadcrumb** (`/pt/filmes/`
 * vs `/pt/series/`) e a **URL**; o **schema** sai na página. Cinco sinais, e o
 * acento é o quinto — nunca o único.
 *
 * PRESENTACIONAL e SERVER: sem estado, sem `use client`, sem fetch. Recebe a
 * view já decidida.
 */

import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from '../../src/lib/site'
import type { GalleryFacet } from '../../src/lib/gallery-presenter'

/** Um degrau da trilha. `href` nulo = degrau atual (nao vira link). */
export interface GalleryCrumb {
  readonly label: string
  readonly href: string | null
}

/** O que o casco precisa saber para se desenhar. */
export interface GalleryShellProps {
  readonly vertical: 'filmes' | 'series'
  readonly verticalLabel: string
  readonly entityTitle: string
  readonly entityPath: string
  /** "Imagens e pôsteres" | "Trailers e vídeos". */
  readonly heading: string
  /** A contagem REAL, já no topo. */
  readonly total: number
  /** "imagem"/"imagens" ou "vídeo"/"vídeos". */
  readonly unit: readonly [string, string]
  /** Filtros com contagem. Vazio = não desenha a faixa. */
  readonly facets: readonly GalleryFacet[]
  /** Rótulo do grupo de filtros, para leitor de tela. */
  readonly facetsLabel: string
  /** `true` quando a página está abaixo do piso e recebeu `noindex`. */
  readonly belowFloor: boolean
  /**
   * Trilha COMPLETA, quando a de três degraus não serve.
   *
   * A galeria de título tem sempre a mesma profundidade (índice → título →
   * galeria), e por isso o casco a monta sozinho. A de EPISÓDIO tem cinco
   * degraus (Séries → série → temporada → episódio → Imagens), e achatá-la em
   * três esconderia a temporada — que é a página de onde o leitor veio.
   *
   * Quando presente, substitui a trilha padrão por inteiro. O último degrau
   * recebe `aria-current="page"` independentemente do `href`.
   */
  readonly crumbs?: readonly GalleryCrumb[]
  readonly children: React.ReactNode
}

/** "184 fotos" / "1 foto". Nunca "1 fotos". */
function contagem(total: number, unit: readonly [string, string]): string {
  return `${total} ${total === 1 ? unit[0] : unit[1]}`
}

export function GalleryShell(props: GalleryShellProps) {
  const indexPath = props.vertical === 'filmes' ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH
  const indexLabel = props.vertical === 'filmes' ? 'Filmes' : 'Séries'
  // A trilha padrão de TÍTULO continua sendo montada aqui; `crumbs` só existe
  // para quem tem profundidade diferente (episódio).
  const trilha: readonly GalleryCrumb[] = props.crumbs ?? [
    { label: indexLabel, href: indexPath },
    { label: props.entityTitle, href: props.entityPath },
    { label: props.heading, href: null },
  ]

  return (
    <div className="container">
      <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
        <ol>
          {trilha.map((degrau, index) => (
            <li
              aria-current={index === trilha.length - 1 ? 'page' : undefined}
              key={`${degrau.label}-${String(index)}`}
            >
              {degrau.href !== null && index !== trilha.length - 1 ? (
                <a href={degrau.href}>{degrau.label}</a>
              ) : (
                degrau.label
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="gallery-head">
        <p className="gallery-head__eyebrow">
          {/* LABEL + BADGE: os dois primeiros dos cinco sinais. */}
          {/*
            As classes `badge--movie`/`badge--series` JA EXISTEM em
            `globals.css` e sao as que a ficha e os trilhos usam. Inventar um
            `data-vertical` aqui criaria um segundo vocabulario visual para a
            mesma distincao — e o dia em que o acento mudar, um dos dois fica
            para tras.
          */}
          <span className={props.vertical === 'filmes' ? 'badge badge--movie' : 'badge badge--series'}>
            {props.verticalLabel}
          </span>
          <a href={props.entityPath}>{props.entityTitle}</a>
        </p>
        <h1 className="gallery-head__title">{props.heading}</h1>
        <p className="gallery-head__count">{contagem(props.total, props.unit)}</p>
      </header>

      {props.facets.length > 0 ? (
        <section aria-label={props.facetsLabel} className="gallery-facets">
          <ul className="chip-row">
            {props.facets.map((facet) => (
              <li key={facet.value}>
                {/*
                  Chip SEM interação por enquanto: ele informa a composição
                  ("12 pôsteres, 40 cenas"), que é dado real. Um chip clicável
                  que não filtrasse seria pior que um chip informativo — e
                  filtrar no cliente exigiria `use client` e um segundo caminho
                  de decisão fora do presenter.
                */}
                <span className="chip chip--static">
                  {facet.label}
                  <span className="chip__count">{facet.count}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {props.children}

      {props.belowFloor ? (
        // A ausência FALA. A página responde (o conteúdo existe), mas não
        // indexa — e o leitor não precisa saber disso, então a nota é para o
        // operador, em comentário de máquina, não na tela.
        <meta data-gallery-below-floor="true" />
      ) : null}

      <p className="gallery-back">
        <a href={props.entityPath}>← Voltar para {props.entityTitle}</a>
      </p>
    </div>
  )
}
