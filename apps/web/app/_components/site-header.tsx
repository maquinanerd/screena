"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import {
  HOME_HREF,
  isActiveNavigationPath,
  isCinematicHeroPath,
  NAV_ITEMS,
} from "../../src/lib/navigation";
import { EXPLORE_PATH } from "../../src/lib/routes";
import { ScreenLogo, type ScreenLogoAccent } from "./screen-logo";

const HEADER_ITEMS = [{ label: "Início", href: HOME_HREF }, ...NAV_ITEMS] as const;

function logoAccent(pathname: string | null): ScreenLogoAccent {
  if (pathname?.startsWith("/pt/filmes") === true) return "movie";
  if (pathname?.startsWith("/pt/series") === true) return "series";
  return "neutral";
}

function isNewsPath(pathname: string | null): boolean {
  return pathname?.startsWith("/pt/noticias") === true;
}

/** Nav fixa do HTML canônico, ligada somente a rotas públicas reais. */
export function SiteHeader(): ReactNode {
  const pathname = usePathname();
  const heroScreen = isCinematicHeroPath(pathname);
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!heroScreen) {
      setScrolled(false);
      return;
    }
    const onScroll = (): void => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [heroScreen]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = (): void => {
      if (desktop.matches) setDrawerOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const drawer = drawerRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || focusable === undefined || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

  const overHero = heroScreen && !scrolled;
  const ink = overHero ? "light" : "dark";
  const news = isNewsPath(pathname);
  const accent = logoAccent(pathname);

  const navigation = (mobile: boolean): ReactNode => (
    <nav
      aria-label={mobile ? "Principal no celular" : "Principal"}
      className={mobile ? "site-header__drawer-nav" : "site-header__nav"}
    >
      {HEADER_ITEMS.map((item) => {
        const active = isActiveNavigationPath(pathname, item.href);
        return (
          <a
            aria-current={active ? "page" : undefined}
            className={mobile ? "site-header__drawer-link" : "site-header__link"}
            data-active={active ? "true" : undefined}
            data-vertical={"vertical" in item ? item.vertical : undefined}
            href={item.href}
            key={item.href}
            onClick={mobile ? () => setDrawerOpen(false) : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );

  return (
    <header
      className="site-header"
      data-drawer-open={drawerOpen ? "true" : undefined}
      data-over-hero={overHero ? "true" : undefined}
    >
      <div className="site-header__inner">
        <a className="site-header__brand" href={HOME_HREF} aria-label="Screen — início">
          <ScreenLogo
            accent={accent}
            className="site-header__logo"
            height={30}
            ink={ink}
            width={156}
          />
          {news ? <span className="site-header__news">NEWS</span> : null}
        </a>

        {navigation(false)}

        <div className="site-header__actions">
          <a className="site-header__search" href={EXPLORE_PATH} aria-label="Explorar">
            <svg
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="16.6" x2="21" y1="16.6" y2="21" />
            </svg>
          </a>
          <button
            aria-controls="site-mobile-drawer"
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? "Fechar menu" : "Abrir menu"}
            className="site-header__menu"
            onClick={() => setDrawerOpen((open) => !open)}
            ref={menuButtonRef}
            type="button"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {drawerOpen ? (
        <div className="site-header__drawer" id="site-mobile-drawer" ref={drawerRef}>
          {navigation(true)}
        </div>
      ) : null}
    </header>
  );
}
