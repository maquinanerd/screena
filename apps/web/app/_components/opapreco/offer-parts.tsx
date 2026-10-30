/**
 * Pecas comuns dos seis componentes OpaPreco: imagem do produto, selo de
 * afiliado, desconto, preco de referencia e os dois icones. Presentacionais e
 * puras (sem estado, sem efeito): servem tanto ao render do cliente quanto ao
 * `react-dom/server` dos testes.
 */

import type { ReactNode } from 'react'

import {
  MINUS_SIGN,
  discountAria,
  formatBRL,
  hasProvenDiscount,
  isLowestRecent,
} from '../../../src/lib/opapreco/format'
import type { Offer, OfferEyebrow } from '../../../src/lib/opapreco/types'

/** Quadro de imagem por componente (dimensoes da SPEC §5 vivem no CSS). */
export type ImageFrame = 'card' | 'compact' | 'hero' | 'grid' | 'drop' | 'context'

/** Icone de etiqueta da SPEC §8: produto sem imagem mantem o quadro. */
export function TagIcon({ size }: { size: number }): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" width={size}>
      <path d="M3 12V4h8l10 10-8 8L3 12z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  )
}

/** Seta "abre em outra aba" do CTA primario. */
export function ExternalArrow(): ReactNode {
  return (
    <svg aria-hidden="true" fill="none" height="14" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 16 16" width="14">
      <path d="M5 11L11 5M6 5h5v5" />
    </svg>
  )
}

const ICON_SIZE: Record<ImageFrame, number> = {
  card: 28,
  compact: 22,
  hero: 40,
  grid: 26,
  drop: 28,
  context: 24,
}

/**
 * `object-fit: contain` sobre `#F7F7F7` com `mix-blend-mode: multiply` (no
 * CSS). `alt=""`: o titulo ja esta no nome do link. `loading="lazy"` exceto no
 * hero, que costuma ser o primeiro anuncio da dobra.
 */
export function OfferImage({
  frame,
  offer,
  showMerchant = false,
}: {
  frame: ImageFrame
  offer: Offer
  showMerchant?: boolean
}): ReactNode {
  return (
    <span className={`op-img op-img--${frame}`}>
      {offer.productImage !== null ? (
        <img
          alt=""
          className="op-img__el"
          decoding="async"
          loading={frame === 'hero' ? 'eager' : 'lazy'}
          src={offer.productImage}
        />
      ) : (
        <span className="op-img__empty">
          <TagIcon size={ICON_SIZE[frame]} />
          {showMerchant ? <span className="op-img__merchant">{offer.merchant}</span> : null}
        </span>
      )}
    </span>
  )
}

/** Selo bordado de afiliado (card, hero, drop): visivel sem interacao, 11px. */
export function DisclosureBadge({ children }: { children: string }): ReactNode {
  return <span className="op-badge">{children}</span>
}

/** `OpaPreço | rotulo` — assinatura constante do topo (SPEC §1.3). */
export function Signature({ label }: { label: string }): ReactNode {
  return (
    <span className="op-sig">
      <span className="op-sig__brand">OpaPreço</span>
      <span aria-hidden="true" className="op-sig__rule" />
      <span>{label}</span>
    </span>
  )
}

/**
 * `−17%` com o texto "17% de desconto" para leitor de tela: o desconto nunca e
 * so cor (SPEC §10). So existe com prova — `hasProvenDiscount` decide.
 */
export function DiscountBadge({ percent }: { percent: number }): ReactNode {
  return (
    <span className="op-disc">
      <span aria-hidden="true">{`${MINUS_SIGN}${percent}%`}</span>
      <span className="visually-hidden">{discountAria(percent)}</span>
    </span>
  )
}

/** Preco de referencia riscado, com o rotulo falado "Preço de referência". */
export function ReferencePrice({ value, label = 'Preço de referência' }: { value: number; label?: string }): ReactNode {
  return (
    <s className="op-ref">
      <span className="visually-hidden">{`${label} `}</span>
      {formatBRL(value)}
    </s>
  )
}

/** O desconto da oferta, se comprovado: referencia riscada + badge. */
export function ProvenDiscount({ offer, withReference = true }: { offer: Offer; withReference?: boolean }): ReactNode {
  if (!hasProvenDiscount(offer)) return null
  return (
    <>
      {withReference ? <ReferencePrice value={offer.referencePrice} /> : null}
      <DiscountBadge percent={offer.discountPercent} />
    </>
  )
}

/**
 * Rotulo do topo. "Menor preço recente" so com `currentPrice <= lowest30d`;
 * "Boa oportunidade" so com desconto comprovado de pelo menos 10% (SPEC §12) —
 * um rotulo que o ad server mande sem a prova vira "Oferta verificada".
 */
export function eyebrowOf(offer: Offer): OfferEyebrow {
  if (isLowestRecent(offer) && (offer.eyebrow === null || offer.eyebrow === 'Menor preço recente')) {
    return 'Menor preço recente'
  }
  if (offer.eyebrow === 'Boa oportunidade' && hasProvenDiscount(offer) && offer.discountPercent >= 10) {
    return 'Boa oportunidade'
  }
  return 'Oferta verificada'
}

/** O `<a>` de oferta habilitado ou o desabilitado (sem href, `aria-disabled`). */
export interface OfferLinkProps {
  readonly className: string
  readonly component: string
  readonly offer: Offer
  readonly ariaLabel: string
  readonly disabled: boolean
  readonly onExpiredClick?: (() => void) | undefined
  readonly expiresAt?: string | null | undefined
  readonly children: ReactNode
}

/**
 * Um unico `<a href rel="sponsored noopener" target="_blank">` por oferta (um
 * tab stop; o CTA dentro e um `<span>`). Quando a oferta vence depois do render,
 * o clique e interceptado e o componente passa ao estado desabilitado.
 */
export function OfferLink({
  ariaLabel,
  children,
  className,
  component,
  disabled,
  expiresAt,
  offer,
  onExpiredClick,
}: OfferLinkProps): ReactNode {
  if (disabled) {
    return (
      <a aria-disabled="true" aria-label={ariaLabel} className={className} data-ad-component={component}>
        {children}
      </a>
    )
  }
  return (
    <a
      aria-label={ariaLabel}
      className={className}
      data-ad-component={component}
      href={offer.href}
      onClick={(event) => {
        if (expiresAt != null && Date.parse(expiresAt) < Date.now()) {
          event.preventDefault()
          onExpiredClick?.()
        }
      }}
      rel="sponsored noopener"
      target="_blank"
    >
      {children}
    </a>
  )
}
