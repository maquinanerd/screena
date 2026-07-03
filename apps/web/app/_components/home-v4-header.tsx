import type { ReactNode } from "react";

import {
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/site";

/**
 * HomeV4Header — cabecalho ESPECIFICO da home, portado da NAV do design
 * `Screen Screens v4.dc.html` (logo · nav · busca · Entrar · avatar), sobreposto
 * ao hero escuro. So aparece na home; as paginas internas mantem o `SiteHeader`
 * global (que continua com a nav publica real Filmes/Series/Pessoas/Noticias/
 * Explorar, exigida por tests/web/public-navigation).
 *
 * Server component PURO (invariantes 3/4): so JSX + constantes de rota. Toda
 * entrada da nav aponta para rota publica REAL — "Listas" e "Onde assistir"
 * levam ao hub /pt/explorar/ enquanto as rotas dedicadas nao existem (o TEXTO
 * segue o design). "Entrar" e o avatar sao afordancias VISUAIS (nao ha login
 * nesta fase — nao sao links funcionais nem constroem autenticacao).
 */

const NAV = [
  { label: "Início", href: HOME_PATH, active: true },
  { label: "Filmes", href: MOVIES_INDEX_PATH, active: false },
  { label: "Séries", href: SERIES_INDEX_PATH, active: false },
  { label: "Listas", href: EXPLORE_PATH, active: false },
  { label: "Onde assistir", href: EXPLORE_PATH, active: false },
];

export function HomeV4Header(): ReactNode {
  return (
    <header className="home-v4-header">
      <div className="home-v4-header__inner">
        <a className="home-v4-header__brand" href={HOME_PATH} aria-label="Screen — início">
          <span>S</span>
          <span>C</span>
          <span>R</span>
          <span className="home-v4-header__box" aria-hidden="true" />
          <span>N</span>
        </a>

        <nav className="home-v4-header__nav" aria-label="Navegação da home">
          {NAV.map((item) => (
            <a
              key={item.label}
              className={`home-v4-header__link${item.active ? " home-v4-header__link--active" : ""}`}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="home-v4-header__actions">
          <a className="home-v4-header__search" href={EXPLORE_PATH} aria-label="Explorar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.6" y1="16.6" x2="21" y2="21" />
            </svg>
          </a>
          {/* Afordancias visuais do design (sem login nesta fase). */}
          <span className="home-v4-header__enter" aria-hidden="true">Entrar</span>
          <span className="home-v4-header__avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="3.6" />
              <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
            </svg>
          </span>
        </div>
      </div>
    </header>
  );
}
