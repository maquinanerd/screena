import type { ReactNode } from 'react'

import { HOME_HREF, NAV_ITEMS } from '../../src/lib/navigation'

/** Rodapé mínimo: marca, rotas existentes e atribuição obrigatória do TMDB. */
export function SiteFooter(): ReactNode {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <a className="site-footer__brand" href={HOME_HREF} aria-label="Screen — início">
          Screen
        </a>
        <nav aria-label="Rodapé">
          <ul className="site-footer__links">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <p className="site-footer__attribution">
          Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.
        </p>
      </div>
    </footer>
  )
}
