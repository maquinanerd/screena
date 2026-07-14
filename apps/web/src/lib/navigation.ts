/**
 * navigation.ts — Itens da navegacao publica global. PURO (sem rede/DB/IO).
 *
 * Fonte unica dos links do header (site-header.tsx) e dos testes de navegacao
 * (tests/web/public-navigation): todo item aponta para rota publicada REAL —
 * o header nunca carrega link morto. Ordem e itens espelham a NAV do design
 * "Screen Screens v2" (FILMES · SÉRIES · PESSOAS · NOTÍCIAS · EXPLORAR); o
 * icone de busca do design fica de fora (busca esta fora de escopo).
 */

import {
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "./routes";

/** Um item de navegacao. `vertical` mapeia o acento de reforco (cor de apoio). */
export interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly vertical?: "movie" | "series";
}

/** Itens de navegacao global (pt-BR; invariante 7). So rotas existentes. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: "Filmes", href: MOVIES_INDEX_PATH, vertical: "movie" },
  { label: "Séries", href: SERIES_INDEX_PATH, vertical: "series" },
  { label: "Pessoas", href: PEOPLE_INDEX_PATH },
  { label: "Notícias", href: NEWS_INDEX_PATH },
  { label: "Explorar", href: EXPLORE_PATH },
];

/** Destino do wordmark: a home publica pt-BR (rota real desde a Fase 5D). */
export const HOME_HREF = HOME_PATH;

/**
 * Marca o item correspondente tanto no indice quanto em suas rotas filhas.
 * A comparacao respeita limites de segmento para nao confundir prefixos.
 */
export function isActiveNavigationPath(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;

  const currentPath = pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
  const navPath = href === "/" ? href : href.replace(/\/+$/, "");
  return currentPath === navPath || currentPath.startsWith(`${navPath}/`);
}
