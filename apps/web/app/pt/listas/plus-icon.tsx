import type { ReactNode } from 'react'

/** Ícone "+" do canônico (ic-plus), geometria exata do handoff. */
export function IcPlusIcon({ size = 14 }: { size?: number }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
    >
      <line x1="12" x2="12" y1="5.5" y2="18.5" />
      <line x1="5.5" x2="18.5" y1="12" y2="12" />
    </svg>
  )
}
