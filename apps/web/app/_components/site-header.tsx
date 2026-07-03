import type { ReactNode } from "react";

import { HOME_HREF, NAV_ITEMS } from "../../src/lib/navigation";
import { EXPLORE_PATH } from "../../src/lib/site";

/**
 * SiteHeader — cabecalho/navegacao global do app publico @screena/web.
 *
 * Server component PURO (sem "use client"): so JSX estatico + constantes de
 * rota puras (`site.ts`). Zero rede, zero DB, zero API externa, zero Gemini,
 * zero estado/JS de cliente — respeita as invariantes 3 e 4 (pureza de render)
 * e passa em `audit:render`. Renderizado uma unica vez no layout raiz, aparece
 * em todas as telas (pagina de filme e preview de desenvolvimento).
 *
 * Estetica: mesma linguagem White Cinematic Editorial da Movie Detail
 * (off-white quente, Montserrat, cantos retos), a partir do handoff do Claude
 * Design ("Screena Screens"). O header e NEUTRO/institucional: nao carrega cor
 * de vertical. O vermelho de FILME e o verde de SERIE aparecem apenas como
 * reforco de hover/foco nos respectivos links — nunca como unico sinal
 * (invariante 11: o proprio texto "Filmes"/"Series" e o segmento de URL
 * /pt/filmes/ vs /pt/series/ ja diferenciam a vertical).
 *
 * Escopo desta fatia: navegacao estrutural. Sem busca funcional e sem menu
 * mobile complexo — apenas responsividade basica (via globals.css).
 */

/*
 * Itens de navegacao e destino do wordmark vivem no modulo puro
 * `src/lib/navigation.ts` (fonte unica, testada em tests/web/public-navigation
 * — todo item aponta para rota publicada real; "Explorar" voltou porque a rota
 * /pt/explorar/ existe desde a Fase 5D).
 */

export function SiteHeader(): ReactNode {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        {/* Logo oficial Screen (SVG local em /brand). O header tem fundo claro
            -> logo preta (neutra, sem cor de vertical). O alt="Screen" fornece o
            nome acessivel do link para a home. */}
        <a className="site-header__brand" href={HOME_HREF}>
          <img
            className="site-header__logo"
            src="/brand/screen-logo-black.svg"
            alt="Screen"
            width={135}
            height={26}
          />
        </a>

        <nav className="site-header__nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              className="site-header__link"
              href={item.href}
              data-vertical={item.vertical}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Acao de busca: o icone leva ao hub /pt/explorar/ (rota real). Nao ha
            campo de busca funcional (busca esta fora de escopo); apenas um link,
            mantendo o header puro (invariantes 3/4). */}
        <div className="site-header__actions">
          <a className="site-header__search" href={EXPLORE_PATH} aria-label="Explorar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.6" y1="16.6" x2="21" y2="21" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
}
