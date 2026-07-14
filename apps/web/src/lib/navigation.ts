/**
 * navigation.ts — Itens da navegacao publica global. PURO (sem rede/DB/IO).
 *
 * Fonte unica dos links do header (site-header.tsx) e dos testes de navegacao
 * (tests/web/public-navigation): todo item aponta para rota publicada REAL —
 * o header nunca carrega link morto. Ordem e itens espelham a NAV do design
 * HTML canonico `Screen Screens v4.dc.html`. Itens que dependem de produto
 * autenticado/streaming (Listas e Onde assistir) ficam ausentes ate existirem;
 * Explorar continua acessivel pelo icone de busca do mesmo header.
 */

import { HOME_PATH, MOVIES_INDEX_PATH, NEWS_INDEX_PATH, SERIES_INDEX_PATH } from "./routes";

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
  { label: "Notícias", href: NEWS_INDEX_PATH },
];

/** Destino do wordmark: a home publica pt-BR (rota real desde a Fase 5D). */
export const HOME_HREF = HOME_PATH;

function normalizeNavigationPath(value: string): string {
  return value === "/" ? value : value.replace(/\/+$/, "");
}

/** Retorna o estado ativo de uma rota de índice e de suas subrotas. */
export function isActiveNavigationPath(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  const current = normalizeNavigationPath(pathname);
  const target = normalizeNavigationPath(href);
  if (target === normalizeNavigationPath(HOME_PATH)) return current === target;
  return current === target || current.startsWith(`${target}/`);
}

/** Telas já portadas cujo hero ocupa a área sob o header transparente. */
export function isCinematicHeroPath(pathname: string | null): boolean {
  if (pathname === null) return false;
  const current = normalizeNavigationPath(pathname);
  const exactHeroPaths = [HOME_PATH].map(normalizeNavigationPath);
  if (exactHeroPaths.includes(current)) return true;
  return current.startsWith(`${normalizeNavigationPath(NEWS_INDEX_PATH)}/`);
}
