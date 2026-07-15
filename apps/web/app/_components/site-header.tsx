'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { HOME_HREF, isActiveNavigationPath, NAV_ITEMS } from '../../src/lib/navigation'

/** Cabeçalho deliberadamente neutro, pronto para receber o design canônico. */
export function SiteHeader(): ReactNode {
  const pathname = usePathname()

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a className="site-header__brand" href={HOME_HREF} aria-label="Screen — início">
          Screen
        </a>
        <nav aria-label="Principal" className="site-header__nav">
          <ul className="site-header__links">
            {NAV_ITEMS.map((item) => {
              const active = isActiveNavigationPath(pathname, item.href)
              return (
                <li key={item.href}>
                  <a
                    aria-current={active ? 'page' : undefined}
                    className="site-header__link"
                    href={item.href}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </header>
  )
}
