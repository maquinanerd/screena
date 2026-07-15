import type { ReactNode } from 'react'

import type { ExternalLink } from '../../src/lib/external-links'

interface EntityExternalIdsProps {
  links: ExternalLink[]
  label?: string
}

/** Links reais de identidade; não representa rating ou disponibilidade. */
export function EntityExternalIds({
  links,
  label = 'Também em',
}: EntityExternalIdsProps): ReactNode {
  if (links.length === 0) return null

  return (
    <nav className="entity-links" aria-label={label}>
      <span>{label}: </span>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} rel="noopener nofollow" target="_blank">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
