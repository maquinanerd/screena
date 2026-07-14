"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { CinerieLogo, type CinerieLogoVariant } from "./cinerie-logo";
import { HOME_HREF, isActiveNavigationPath, NAV_ITEMS } from "../../src/lib/navigation";
import {
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from "../../src/lib/routes";

/**
 * SiteHeader — cabecalho/navegacao global do app publico @screena/web.
 *
 * Client component ENXUTO e PURO DE IO: a unica interatividade e o estado de
 * scroll para o comportamento adaptativo da nav sobre o hero (design v4). NAO
 * faz rede/DB/API/Gemini — respeita as invariantes 3/4 e passa em `audit:render`.
 *
 * Comportamento adaptativo (SOMENTE na `Public Marketing Home v4`, `/pt`):
 *  - sobre o hero (topo, sem scroll): header TRANSPARENTE com texto/logo brancos
 *    (o hero escuro aparece atras — o hero ja sobe sob a nav via margin-top
 *    negativa), dando a presenca cinematografica do v4;
 *  - ao rolar: vira SOLIDO com blur (visual claro padrao).
 * Em TODAS as demais telas (catalogo/ficha/etc.) o header e SEMPRE solido/claro
 * — a variacao e limitada a home e nao altera as paginas internas.
 *
 * Honestidade de nav (invariante 11 + page-map): itens apontam so para rotas
 * publicadas reais. `Entrar`/avatar/`Listas`/`Onde assistir` do v4 dependem de
 * login/watchlist inativos e por isso NAO sao renderizados.
 */

function isHomePath(pathname: string | null): boolean {
  if (pathname === null) return false;
  return pathname === HOME_PATH || pathname === HOME_PATH.replace(/\/$/, "");
}

function resolveLogoVariant(pathname: string | null): CinerieLogoVariant {
  if (isActiveNavigationPath(pathname, MOVIES_INDEX_PATH)) return "movie";
  if (isActiveNavigationPath(pathname, SERIES_INDEX_PATH)) return "series";
  if (isActiveNavigationPath(pathname, PEOPLE_INDEX_PATH)) return "people";
  if (isActiveNavigationPath(pathname, NEWS_INDEX_PATH)) return "news";
  return "neutral";
}

export function SiteHeader(): ReactNode {
  const pathname = usePathname();
  const home = isHomePath(pathname);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!home) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [home]);

  // Transparente/branco apenas na home E no topo (sobre o hero).
  const overHero = home && !scrolled;
  const logoVariant = resolveLogoVariant(pathname);

  return (
    <header className="site-header" data-over-hero={overHero ? "true" : undefined}>
      <div className="site-header__inner">
        {/* Logo branca sobre o hero; variante contextual no header solido. */}
        <a className="site-header__brand" href={HOME_HREF} aria-label="cinerie — início">
          <CinerieLogo
            className="site-header__logo"
            variant={logoVariant}
            tone={overHero ? "light" : "dark"}
          />
        </a>

        <nav className="site-header__nav" aria-label="Navegação principal">
          {NAV_ITEMS.map((item) => {
            const active = isActiveNavigationPath(pathname, item.href);

            return (
              <a
                key={item.href}
                className="site-header__link"
                href={item.href}
                data-vertical={item.vertical}
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
