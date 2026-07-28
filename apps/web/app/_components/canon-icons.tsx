/**
 * canon-icons.tsx — Ícones do canônico "Screen Screens v4.dc.html"
 * (SHA-256 6936a341…), geometria EXATA dos <symbol id="ic-*"> do handoff.
 * Server-safe (sem estado). Cor via currentColor; tamanho via prop.
 */

import type { ReactNode, SVGProps } from 'react'

type IconProps = { size?: number } & SVGProps<SVGSVGElement>

function base(
  size: number | undefined,
  props: SVGProps<SVGSVGElement>,
  extra: SVGProps<SVGSVGElement>,
): SVGProps<SVGSVGElement> {
  return {
    'aria-hidden': true,
    viewBox: '0 0 24 24',
    width: size ?? 16,
    height: size ?? 16,
    focusable: false,
    ...extra,
    ...props,
  }
}

const stroke = (w: number): SVGProps<SVGSVGElement> => ({
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: w,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export function IcFilm({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { ...stroke(1.7), strokeLinecap: undefined })}>
      <rect height="15" rx="1.5" width="17" x="3.5" y="4.5" />
      <line x1="8" x2="8" y1="4.5" y2="19.5" />
      <line x1="16" x2="16" y1="4.5" y2="19.5" />
      <line x1="3.5" x2="20.5" y1="12" y2="12" />
    </svg>
  )
}

export function IcTv({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <rect height="12" rx="2" width="18" x="3" y="7" />
      <polyline points="8 3.5 12 6.5 16 3.5" />
    </svg>
  )
}

export function IcLayers({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.7))}>
      <polygon points="12 3 21 8 12 13 3 8" />
      <polyline points="3 12 12 17 21 12" />
      <polyline points="3 16 12 21 21 16" />
    </svg>
  )
}

export function IcBookmark({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinejoin: 'round' })}>
      <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
    </svg>
  )
}

export function IcBookmarkFilled({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { fill: 'currentColor' })}>
      <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
    </svg>
  )
}

export function IcMore({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { fill: 'currentColor' })}>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}

export function IcCal2({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <rect height="16" rx="2" width="17" x="3.5" y="5" />
      <line x1="3.5" x2="20.5" y1="9.5" y2="9.5" />
      <line x1="8" x2="8" y1="3" y2="6.5" />
      <line x1="16" x2="16" y1="3" y2="6.5" />
    </svg>
  )
}

export function IcAlert({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <path d="M12 4 21 19.5H3z" />
      <line x1="12" x2="12" y1="10" y2="14.5" />
      <circle cx="12" cy="17.3" fill="currentColor" r="0.4" stroke="none" />
    </svg>
  )
}

export function IcCheck2({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(2))}>
      <polyline points="3 12.5 8 17.5 15 8" />
      <polyline points="12 15 14 17 21 7.5" />
    </svg>
  )
}

export function IcClock({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.9))}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  )
}

export function IcUpload({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15" />
      <polyline points="8 8.5 12 4.5 16 8.5" />
      <line x1="12" x2="12" y1="4.5" y2="15.5" />
    </svg>
  )
}

export function IcDownload({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <path d="M4 15v3.5a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5V15" />
      <polyline points="8 11.5 12 15.5 16 11.5" />
      <line x1="12" x2="12" y1="4" y2="15" />
    </svg>
  )
}

export function IcEye({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.7))}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function IcLock({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <rect height="9" rx="1.5" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function IcGlobe({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.7))}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </svg>
  )
}

export function IcStar({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { fill: 'currentColor' })}>
      <path d="M12 2.4l2.92 6.24 6.83.9-5.04 4.73 1.3 6.79L12 17.7l-6.01 3.36 1.3-6.79L2.25 9.54l6.83-.9z" />
    </svg>
  )
}

export function IcUser({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  )
}

export function IcMail({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <rect height="13" rx="2" width="18" x="3" y="5.5" />
      <polyline points="4 7 12 13 20 7" />
    </svg>
  )
}

export function IcId({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.7))}>
      <rect height="13" rx="2" width="18" x="3" y="5.5" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 16a3.4 3.4 0 0 1 6 0" />
      <line x1="14" x2="18.5" y1="10" y2="10" />
      <line x1="14" x2="18.5" y1="13.5" y2="13.5" />
    </svg>
  )
}

export function IcChat({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <path d="M4 5h16v11H9l-4 4z" />
    </svg>
  )
}

export function IcCrown({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, { fill: 'currentColor' })}>
      <path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 10h-13z" />
    </svg>
  )
}

export function IcTrend2({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(2))}>
      <polyline points="3 16 9 10 13 14 21 6" />
      <polyline points="15 6 21 6 21 12" />
    </svg>
  )
}

export function IcTrash({ size, ...props }: IconProps): ReactNode {
  return (
    <svg {...base(size, props, stroke(1.8))}>
      <polyline points="4 6.5 20 6.5" />
      <path d="M6.5 6.5 7.5 20a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.5 6.5" />
      <path d="M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

/** Mapa tipo → ícone/cor/badge do canônico (TM). Cores via tokens CSS. */
export const CANON_TYPE = {
  movie: { label: 'Filme', accentVar: 'var(--c-accent-movie)', Icon: IcFilm },
  tv: { label: 'Série', accentVar: 'var(--c-accent-series)', Icon: IcTv },
  season: { label: 'Temporada', accentVar: 'var(--c-accent-series)', Icon: IcLayers },
  episode: { label: 'Episódio', accentVar: 'var(--c-accent-episode)', Icon: IcTv },
} as const
