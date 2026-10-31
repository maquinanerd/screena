'use client'

/**
 * O slot OpaPreco no NAVEGADOR (SPEC §14, caminho "sem SSR").
 *
 * Por que o anuncio nao vem no HTML do servidor: a invariante 3 (CLAUDE.md)
 * proibe API externa no render de pagina indexavel. O servidor entrega so a
 * RESERVA de altura com o skeleton da mesma geometria; este componente mede o
 * proprio container, pede a decisao a rota de MESMA ORIGEM `/api/opapreco/ad`
 * (e ela que fala com o ad server, com teto de 1,5 s) e troca o skeleton pelo
 * anuncio no mesmo frame da resposta.
 *
 * Sem oferta (204), erro ou demora: o slot colapsa — `height` ate 0 em 200ms
 * (`overflow: hidden`), ou de uma vez se estiver fora da tela ou com
 * `prefers-reduced-motion`. Nunca mensagem para o leitor.
 *
 * Impressao: quando 50% do criativo fica visivel por 1 s, uma vez, o navegador
 * avisa `/api/opapreco/track` (mesma origem); quem dispara a URL do ad server e
 * o servidor. O leitor nao fala com terceiro antes de clicar numa oferta.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { OP_SLOTS, viewportOf } from '../../../src/lib/opapreco/slots'
import type { OpComponentName, OpSlotId, OpSlotTags } from '../../../src/lib/opapreco/slots'
import type { AdDecision } from '../../../src/lib/opapreco/types'
import { AdCreative } from './ad-creative'
import { AdSkeleton } from './ad-skeleton'
import './opapreco.css'

/** Teto do lado do navegador: os 1,5 s do ad server + a ida e volta da rota propria. */
const CLIENT_DEADLINE_MS = 1800
/** Colapso da SPEC (§7). */
const COLLAPSE_MS = 200
/** Impressao: 50% visivel por 1 s (contrato `tracking.impressionUrl`). */
const IMPRESSION_RATIO = 0.5
const IMPRESSION_DWELL_MS = 1000

type Phase = 'loading' | 'ready' | 'collapsing' | 'gone'

export interface AdSlotClientProps {
  readonly id: OpSlotId
  readonly tags?: OpSlotTags
  readonly className?: string
}

function reserveStyle(id: OpSlotId): CSSProperties {
  const { reserve } = OP_SLOTS[id]
  return {
    '--op-reserve-mobile': reserve.mobile ?? '0px',
    '--op-reserve-tablet': reserve.tablet ?? '0px',
    '--op-reserve-desktop': reserve.desktop ?? '0px',
  } as CSSProperties
}

function buildQuery(id: OpSlotId, tags: OpSlotTags | undefined, viewport: string, containerWidth: number): string {
  const params = new URLSearchParams()
  params.set('slot', id)
  // So o CAMINHO da pagina: a query string pode carregar dado do leitor.
  params.set('path', window.location.pathname)
  params.set('viewport', viewport)
  params.set('containerWidth', String(containerWidth))
  if (tags?.vertical) params.set('vertical', tags.vertical)
  if (tags?.entity) params.set('entity', tags.entity)
  if (tags?.category) params.set('category', tags.category)
  if (tags?.genres && tags.genres.length > 0) params.set('genres', tags.genres.slice(0, 6).join(','))
  return params.toString()
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function isOffscreen(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.bottom <= 0 || rect.top >= window.innerHeight
}

function sendImpression(impressionUrl: string): void {
  const body = JSON.stringify({ url: impressionUrl })
  const sent =
    typeof navigator.sendBeacon === 'function' &&
    navigator.sendBeacon('/api/opapreco/track', new Blob([body], { type: 'application/json' }))
  if (!sent) {
    void fetch('/api/opapreco/track', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      keepalive: true,
    }).catch(() => undefined)
  }
}

/** Skeletons do SSR: quando o celular recebe outro componente (topo da materia), os dois vao e o CSS escolhe. */
function SlotSkeletons({ id }: { id: OpSlotId }): ReactNode {
  const { components } = OP_SLOTS[id]
  const wide: OpComponentName = components.desktop[0] ?? 'product_card_v1'
  const narrow: OpComponentName = components.mobile[0] ?? wide
  if (wide === narrow) return <AdSkeleton component={wide} />
  return (
    <>
      <span className="op-only-wide">
        <AdSkeleton component={wide} />
      </span>
      <span className="op-only-narrow">
        <AdSkeleton component={narrow} />
      </span>
    </>
  )
}

export function AdSlotClient({ className, id, tags }: AdSlotClientProps): ReactNode {
  const definition = OP_SLOTS[id]
  const rootRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [decision, setDecision] = useState<AdDecision | null>(null)
  const [now, setNow] = useState(0)
  const [expired, setExpired] = useState(false)
  const tagsKey = JSON.stringify(tags ?? {})

  const collapse = useCallback(() => {
    const element = rootRef.current
    if (element === null || prefersReducedMotion() || isOffscreen(element)) {
      setPhase('gone')
      return
    }
    element.style.height = `${element.offsetHeight}px`
    setPhase('collapsing')
    window.requestAnimationFrame(() => {
      element.style.height = '0px'
    })
    window.setTimeout(() => setPhase('gone'), COLLAPSE_MS)
  }, [])

  // Pede a decisao uma vez por montagem (e de novo se o slot ou as tags mudarem).
  useEffect(() => {
    const element = rootRef.current
    if (element === null) return
    const viewport = viewportOf(window.innerWidth)
    if (definition.reserve[viewport] === null) {
      // Lateral abaixo de 1024px: o CSS ja escondeu; nao se pede anuncio.
      setPhase('gone')
      return
    }
    const controller = new AbortController()
    const deadline = window.setTimeout(() => controller.abort(), CLIENT_DEADLINE_MS)
    const containerWidth = Math.round(element.getBoundingClientRect().width)
    const query = buildQuery(id, JSON.parse(tagsKey) as OpSlotTags, viewport, containerWidth)

    fetch(`/api/opapreco/ad?${query}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (response.status !== 200) return null
        return (await response.json()) as AdDecision
      })
      .then((received) => {
        if (controller.signal.aborted) return
        if (received === null) {
          collapse()
          return
        }
        setNow(Date.now())
        setDecision(received)
        setPhase('ready')
      })
      .catch(() => {
        collapse()
      })
      .finally(() => window.clearTimeout(deadline))

    return () => {
      window.clearTimeout(deadline)
      controller.abort()
    }
  }, [collapse, definition, id, tagsKey])

  // Impressao: 50% visivel por 1 s, uma vez por decisao.
  useEffect(() => {
    const element = rootRef.current
    if (phase !== 'ready' || decision === null || element === null) return
    if (typeof IntersectionObserver !== 'function') return
    let timer: number | undefined
    let fired = false
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.intersectionRatio >= IMPRESSION_RATIO)
        if (visible && timer === undefined && !fired) {
          timer = window.setTimeout(() => {
            fired = true
            observer.disconnect()
            sendImpression(decision.impressionUrl)
          }, IMPRESSION_DWELL_MS)
        } else if (!visible && timer !== undefined) {
          window.clearTimeout(timer)
          timer = undefined
        }
      },
      { threshold: [0, IMPRESSION_RATIO, 1] },
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [decision, phase])

  // Oferta que vence com a aba aberta: ao voltar para a aba, revalida (SPEC §7, disabled).
  useEffect(() => {
    if (decision?.expiresAt == null) return
    const expiresAt = Date.parse(decision.expiresAt)
    const check = (): void => {
      if (document.visibilityState === 'visible' && Date.now() > expiresAt) setExpired(true)
    }
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [decision])

  if (phase === 'gone') return null

  const component = decision?.component ?? definition.components.desktop[0]
  const classes = [
    'cin-adslot',
    definition.sidebar ? 'cin-adslot--sidebar' : null,
    phase === 'ready' ? 'cin-adslot--ready' : 'cin-adslot--loading',
    phase === 'collapsing' ? 'cin-adslot--collapsing' : null,
    className ?? null,
  ]
    .filter((value): value is string => value !== null && value !== '')
    .join(' ')

  return (
    <div
      aria-busy={phase === 'loading' ? true : undefined}
      className={classes}
      data-ad-component={component}
      data-op-slot={id}
      ref={rootRef}
      style={reserveStyle(id)}
    >
      {phase === 'ready' && decision !== null ? (
        <AdCreative decision={decision} expired={expired} now={now} onExpired={() => setExpired(true)} />
      ) : phase === 'loading' ? (
        <SlotSkeletons id={id} />
      ) : null}
    </div>
  )
}
