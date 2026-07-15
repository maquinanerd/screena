/** Navegação pública global. PURO: sem rede, banco, env ou IO. */

import {
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from './routes'

export interface NavItem {
  readonly label: string
  readonly href: string
}

/** Somente destinos públicos que possuem uma rota real no app. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Filmes', href: MOVIES_INDEX_PATH },
  { label: 'Séries', href: SERIES_INDEX_PATH },
  { label: 'Pessoas', href: PEOPLE_INDEX_PATH },
  { label: 'Notícias', href: NEWS_INDEX_PATH },
  { label: 'Explorar', href: EXPLORE_PATH },
]

export const HOME_HREF = HOME_PATH

function normalizeNavigationPath(value: string): string {
  return value === '/' ? value : value.replace(/\/+$/, '')
}

/** Marca como ativa tanto a rota de índice quanto suas páginas filhas. */
export function isActiveNavigationPath(pathname: string | null, href: string): boolean {
  if (pathname === null) return false
  const current = normalizeNavigationPath(pathname)
  const target = normalizeNavigationPath(href)
  if (target === normalizeNavigationPath(HOME_PATH)) return current === target
  return current === target || current.startsWith(`${target}/`)
}
