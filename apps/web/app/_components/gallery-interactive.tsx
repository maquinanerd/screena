'use client'

/**
 * gallery-interactive.tsx — Os FILTROS e o VISUALIZADOR das galerias.
 *
 * ============================================================================
 * O HTML CONTINUA SENDO DO SERVIDOR
 * ============================================================================
 * A grade inteira chega renderizada no servidor, com todas as imagens (é o que
 * indexa e o que funciona sem JavaScript). Estes dois componentes só ACRESCENTAM
 * comportamento por cima dela, dentro do contêiner `[data-gallery]`:
 *
 *  - FILTROS: os chips de tipo/idioma viram `<button aria-pressed>` (uma escolha
 *    por dimensão; clicar de novo limpa). Cada item da grade carrega
 *    `data-kind`/`data-lang` com o MESMO valor da faceta que o presenter
 *    contou, e o item que não casa recebe `hidden`. Nenhuma rota, query string
 *    ou cache muda: filtrar no servidor faria a página ler `searchParams`, e
 *    `generateStaticParams` + `searchParams` já derrubou fichas inteiras (#250).
 *  - VISUALIZADOR: o clique numa imagem abre um `<dialog>` com a imagem grande,
 *    anterior/próxima (setas do teclado também), contador e Esc para fechar. O
 *    `<a href>` da grade continua sendo o caminho sem JavaScript e o de quem
 *    abre em outra aba (ctrl/cmd/shift + clique não é interceptado).
 *
 * A navegação do visualizador respeita o filtro: anterior/próxima andam só pelos
 * itens visíveis.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { GalleryFacet } from '../../src/lib/gallery-presenter'

/** Uma dimensão de filtro: os chips dela e o atributo que os itens carregam. */
export interface GalleryFacetGroup {
  /** `kind` casa com `data-kind` do item; `lang`, com `data-lang`. */
  readonly dimension: 'kind' | 'lang'
  readonly facets: readonly GalleryFacet[]
}

type Selection = Readonly<Record<GalleryFacetGroup['dimension'], string | null>>

const NO_SELECTION: Selection = { kind: null, lang: null }

/** Filtros da galeria: chips que filtram a grade que vem do servidor. */
export function GalleryFacetFilter({
  groups,
  label,
  total,
  unit,
}: {
  groups: readonly GalleryFacetGroup[]
  label: string
  total: number
  /** Plural do que a galeria conta ("imagens", "vídeos", "fotos"). */
  unit: string
}): ReactNode {
  const rootRef = useRef<HTMLElement>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [shown, setShown] = useState<number | null>(null)

  useEffect(() => {
    const container = rootRef.current?.closest('[data-gallery]')
    if (container == null) return
    const filtering = selection.kind !== null || selection.lang !== null
    let count = 0
    for (const item of container.querySelectorAll<HTMLElement>('[data-gallery-item]')) {
      const matches =
        (selection.kind === null || item.dataset.kind === selection.kind) &&
        (selection.lang === null || item.dataset.lang === selection.lang)
      item.hidden = !matches
      if (matches) count += 1
    }
    setShown(filtering ? count : null)
  }, [selection])

  const chips = groups.flatMap((group) =>
    group.facets.map((facet) => ({ dimension: group.dimension, facet })),
  )
  if (chips.length === 0) return null

  return (
    <section aria-label={label} className="gallery-facets" ref={rootRef}>
      <ul className="chip-row">
        {chips.map(({ dimension, facet }) => {
          const pressed = selection[dimension] === facet.value
          return (
            <li key={`${dimension}:${facet.value}`}>
              <button
                aria-pressed={pressed}
                className="chip chip--filter"
                onClick={() =>
                  setSelection((previous) => ({ ...previous, [dimension]: pressed ? null : facet.value }))
                }
                type="button"
              >
                {facet.label}
                <span className="chip__count">{facet.count}</span>
              </button>
            </li>
          )
        })}
        {shown !== null ? (
          <li>
            <button className="chip chip--clear" onClick={() => setSelection(NO_SELECTION)} type="button">
              Limpar filtros
            </button>
          </li>
        ) : null}
      </ul>
      {/* Anuncia o resultado do filtro para leitor de tela; vazio sem filtro. */}
      <p aria-live="polite" className="gallery-facets__status">
        {shown === null
          ? ''
          : shown === 0
            ? `Nenhum item com esses filtros. Limpe um deles para ver as ${total} ${unit}.`
            : `Mostrando ${shown} de ${total} ${unit}.`}
      </p>
    </section>
  )
}

interface ViewerItem {
  readonly src: string
  readonly alt: string
  readonly caption: string
}

function visibleLinks(container: Element): HTMLAnchorElement[] {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[data-gallery-open]')].filter(
    (link) => link.closest('[hidden]') === null,
  )
}

/** Visualizador da galeria: abre a imagem grande sem sair do site. */
export function GalleryLightbox(): ReactNode {
  const markerRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [items, setItems] = useState<readonly ViewerItem[]>([])
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    const container = markerRef.current?.closest('[data-gallery]')
    if (container == null) return
    const onClick = (event: Event): void => {
      if (!(event instanceof MouseEvent)) return
      // Abrir em outra aba continua sendo do leitor.
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      const link = target?.closest<HTMLAnchorElement>('a[data-gallery-open]')
      if (link == null || !container.contains(link)) return
      const links = visibleLinks(container)
      const at = links.indexOf(link)
      if (at < 0) return
      event.preventDefault()
      returnFocusRef.current = link
      setItems(
        links.map((each) => ({
          src: each.href,
          alt: each.querySelector('img')?.alt ?? '',
          caption: each.dataset.caption ?? '',
        })),
      )
      setIndex(at)
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (index !== null && !dialog.open) dialog.showModal()
    if (index === null && dialog.open) dialog.close()
  }, [index])

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (current === null || items.length === 0) return current
        return (current + delta + items.length) % items.length
      })
    },
    [items.length],
  )

  const item = index === null ? undefined : items[index]

  return (
    <>
      <span hidden ref={markerRef} />
      <dialog
        aria-label="Visualizador de imagens"
        className="gallery-viewer"
        onClick={(event) => {
          // Clique no fundo escuro (fora da imagem e dos botões) fecha.
          if (event.target === event.currentTarget) dialogRef.current?.close()
        }}
        onClose={() => {
          setIndex(null)
          returnFocusRef.current?.focus()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') step(1)
          if (event.key === 'ArrowLeft') step(-1)
        }}
        ref={dialogRef}
      >
        {item !== undefined && index !== null ? (
          <figure className="gallery-viewer__figure">
            <img alt={item.alt} className="gallery-viewer__img" key={item.src} src={item.src} />
            <figcaption className="gallery-viewer__caption">
              <span>{item.caption}</span>
              <span>
                {index + 1} de {items.length}
              </span>
              <a href={item.src} rel="noopener" target="_blank">
                Abrir original
              </a>
            </figcaption>
          </figure>
        ) : null}
        <button
          aria-label="Fechar visualizador"
          className="gallery-viewer__close"
          onClick={() => dialogRef.current?.close()}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
          </svg>
        </button>
        {items.length > 1 ? (
          <>
            <button
              aria-label="Imagem anterior"
              className="gallery-viewer__nav gallery-viewer__nav--prev"
              onClick={() => step(-1)}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
                <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
              </svg>
            </button>
            <button
              aria-label="Próxima imagem"
              className="gallery-viewer__nav gallery-viewer__nav--next"
              onClick={() => step(1)}
              type="button"
            >
              <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
                <path d="M9 5l7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
              </svg>
            </button>
          </>
        ) : null}
      </dialog>
    </>
  )
}
