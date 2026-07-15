import type { ReactNode } from 'react'

/** Link adjacente (anterior/proximo) com destino interno e rotulo descritivo. */
export interface AdjacentLink {
  href: string
  label: string
}

/**
 * Navegacao anterior/proximo reutilizavel (temporadas e episodios). Puramente
 * apresentacional: recebe os links ja resolvidos. Omite-se quando nao ha nenhum.
 * Links carregam `rel` e `aria-label` descritivos para acessibilidade.
 */
export function PrevNextNav({
  ariaLabel,
  previousItemLabel,
  nextItemLabel,
  previous,
  next,
}: {
  ariaLabel: string
  previousItemLabel: string
  nextItemLabel: string
  previous: AdjacentLink | null
  next: AdjacentLink | null
}): ReactNode {
  if (previous === null && next === null) return null
  return (
    <nav aria-label={ariaLabel} data-nav="prev-next">
      <ul>
        {previous !== null ? (
          <li>
            <a
              href={previous.href}
              rel="prev"
              aria-label={`${previousItemLabel}: ${previous.label}`}
            >
              ← {previous.label}
            </a>
          </li>
        ) : null}
        {next !== null ? (
          <li>
            <a href={next.href} rel="next" aria-label={`${nextItemLabel}: ${next.label}`}>
              {next.label} →
            </a>
          </li>
        ) : null}
      </ul>
    </nav>
  )
}
