"use client";

import type { ReactNode } from "react";
import { useRef } from "react";

/**
 * ComingSoonRail — trilho horizontal INTERATIVO da seção "Em breve" (v4 §7).
 * Client component ISOLADO (a home /pt continua server component): as setas
 * ‹ › rolam o trilho via `scrollBy` (~2 cards por clique) e o trilho tem
 * scroll-snap para parecer slide. O `heading` (barra + título + subtítulo) é
 * server-rendered e passado como prop — só o nav + o trilho são client.
 *
 * Alimentado por DADO REAL (filmes upcoming do TMDB, via getter server) quando
 * existe; senão, placeholder visual só em dev/preview. `duration` é OPCIONAL: só
 * o placeholder tem (pílula "▶ 2:05" de fidelidade). Item real NÃO tem trailer,
 * então NÃO exibe pílula de duração — nunca fingimos duração de trailer. Cada
 * card linka ao índice/ficha REAL de filmes.
 */

export type ComingSoonItem = {
  title: string;
  date: string;
  /** Duração do trailer (só placeholder visual); ausente = sem pílula. */
  duration?: string;
  href: string;
};

export function ComingSoonRail({
  items,
  heading,
}: {
  items: readonly ComingSoonItem[];
  heading: ReactNode;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  function scrollRail(direction: "prev" | "next"): void {
    const rail = railRef.current;
    if (rail === null) return;
    const step = 252 * 2; // 232px do card + 20px de gap, ~2 cards por clique
    rail.scrollBy({
      left: direction === "next" ? step : -step,
      behavior: "smooth",
    });
  }

  return (
    <>
      <header className="home-v4-soon-head">
        {heading}
        <div className="home-v4-soon-nav">
          <button
            className="home-v4-rail-arrow"
            type="button"
            aria-label="Trailer anterior"
            onClick={() => scrollRail("prev")}
          >
            ‹
          </button>
          <button
            className="home-v4-rail-arrow"
            type="button"
            aria-label="Próximo trailer"
            onClick={() => scrollRail("next")}
          >
            ›
          </button>
        </div>
      </header>

      <div className="home-v4-soon-rail" ref={railRef}>
        {items.map((item, index) => (
          <a
            key={`coming-soon-${item.title}-${index}`}
            href={item.href}
            className="home-v4-trailer-card"
          >
            <span className="home-v4-trailer-thumb">
              <span className="home-v4-trailer-scrim" aria-hidden="true" />
              {item.duration ? (
                <span className="home-v4-trailer-duration">
                  <span aria-hidden="true">▶</span>
                  {item.duration}
                </span>
              ) : null}
            </span>
            <span className="home-v4-trailer-date">
              <span aria-hidden="true">▤</span>
              {item.date}
            </span>
            <h3 className="home-v4-trailer-title">{item.title}</h3>
          </a>
        ))}
      </div>
    </>
  );
}
