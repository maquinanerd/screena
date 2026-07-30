import React from 'react'

export default function CinerieIcon() {
  return (
    <span className="cinerie-brand-icon" aria-label="Cinerie">
      <svg aria-hidden="true" viewBox="0 0 48 48" role="img">
        <rect x="2" y="2" width="44" height="44" rx="14" fill="currentColor" />
        <path
          d="M32.9 15.7a13 13 0 1 0 0 16.6l-4.4-3.2a7.6 7.6 0 1 1 0-10.2l4.4-3.2Z"
          fill="var(--cinerie-brand-surface, #fffdf8)"
        />
        <circle cx="34" cy="24" r="3" fill="var(--cinerie-brand-accent, #f5c518)" />
      </svg>
    </span>
  )
}
