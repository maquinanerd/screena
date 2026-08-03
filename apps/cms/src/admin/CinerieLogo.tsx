import React from 'react'

import CinerieIcon from './CinerieIcon.js'

export default function CinerieLogo() {
  return (
    <span className="cinerie-brand-logo" aria-label="Cinerie Editorial">
      <CinerieIcon />
      <span className="cinerie-brand-logo__copy">
        <strong>CINERIE</strong>
        <small>Editorial</small>
      </span>
    </span>
  )
}
