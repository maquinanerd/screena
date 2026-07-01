import type { ReactNode } from "react";

import { MOVIES_INDEX_PATH, PT_LOCALE_SEGMENT } from "../../src/lib/site";

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

/** Um item de navegacao. `vertical` mapeia o acento de reforco (cor de apoio). */
interface NavItem {
  readonly label: string;
  readonly href: string;
  readonly vertical?: "movie" | "series";
}

/**
 * Itens de navegacao global (pt-BR; invariante 7). As rotas apontam para os
 * caminhos canonicos futuros — esta fatia nao cria as paginas de indice.
 */
const NAV_ITEMS: readonly NavItem[] = [
  { label: "Filmes", href: MOVIES_INDEX_PATH, vertical: "movie" },
  { label: "Séries", href: `/${PT_LOCALE_SEGMENT}/series/`, vertical: "series" },
  { label: "Notícias", href: `/${PT_LOCALE_SEGMENT}/noticias/` },
  { label: "Explorar", href: `/${PT_LOCALE_SEGMENT}/explorar/` },
];

/** Destino do wordmark: a pagina inicial pt-BR. */
const HOME_HREF = `/${PT_LOCALE_SEGMENT}/`;

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
      </div>
    </header>
  );
}
