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

import { MOVIES_INDEX_PATH, PEOPLE_INDEX_PATH, SERIES_INDEX_PATH } from '../../src/lib/site'
import type { GalleryFacet } from '../../src/lib/gallery-presenter'

/**
 * As verticais que o casco desenha.
 *
 * `pessoas` entrou em 27/08/2026, com a galeria de fotos. NÃO é um terceiro
 * caso da distinção filme/série: a invariante 11 existe para impedir que o
 * leitor confunda um FILME com uma SÉRIE, e pessoa não participa dessa
 * confusão. Por isso ela não ganha acento — o token neutro é o correto para
 * "home/busca/misto/institucional", e uma pessoa é justamente isso: ela aparece
 * nas duas verticais e não pertence a nenhuma.
 */
export type GalleryShellVertical = 'filmes' | 'series' | 'pessoas'

/** O que o casco precisa saber para se desenhar. */
export interface GalleryShellProps {
  readonly vertical: GalleryShellVertical
  /** `Filme` | `Série` | `Pessoa`. O LABEL textual. */
  readonly verticalLabel: string
  readonly entityTitle: string
  readonly entityPath: string
  /** "Imagens e pôsteres" | "Trailers e vídeos" | "Fotos". */
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
  readonly children: React.ReactNode
}

/** "184 fotos" / "1 foto". Nunca "1 fotos". */
function contagem(total: number, unit: readonly [string, string]): string {
  return `${total} ${total === 1 ? unit[0] : unit[1]}`
}

/** Índice e rótulo da trilha, por vertical. UM lugar, nunca três ternários. */
const INDEX_BY_VERTICAL: Readonly<
  Record<GalleryShellVertical, { readonly path: string; readonly label: string }>
> = {
  filmes: { path: MOVIES_INDEX_PATH, label: 'Filmes' },
  series: { path: SERIES_INDEX_PATH, label: 'Séries' },
  pessoas: { path: PEOPLE_INDEX_PATH, label: 'Pessoas' },
}

/**
 * A classe do badge.
 *
 * Filme e série carregam o acento porque a invariante 11 exige que a distinção
 * apareça em CINCO sinais e o badge é um deles. Pessoa usa o badge NEUTRO: dar
 * a ela um acento novo criaria um terceiro vocabulário de cor para uma
 * distinção que não existe, e reaproveitar vermelho ou verde afirmaria uma
 * vertical que a pessoa não tem.
 */
function badgeClass(vertical: GalleryShellVertical): string {
  if (vertical === 'filmes') return 'badge badge--movie'
  if (vertical === 'series') return 'badge badge--series'
  return 'badge'
}

export function GalleryShell(props: GalleryShellProps) {
  const { path: indexPath, label: indexLabel } = INDEX_BY_VERTICAL[props.vertical]

  return (
    <div className="container">
      <nav aria-label="Trilha de navegação" className="detail-hero__crumbs">
        <ol>
          <li>
            <a href={indexPath}>{indexLabel}</a>
          </li>
          <li>
            <a href={props.entityPath}>{props.entityTitle}</a>
          </li>
          <li aria-current="page">{props.heading}</li>
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
          <span className={badgeClass(props.vertical)}>{props.verticalLabel}</span>
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
