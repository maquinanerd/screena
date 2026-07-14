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
 * Alimentado exclusivamente por dado real já persistido (filmes com estreia
 * futura). Não promete trailer, player ou plataforma: cada card mostra apenas
 * imagem, data e título existentes e linka para a ficha real.
 *
 * `imageUrl` é OPCIONAL e, quando presente, é a URL pública REMOTA do CDN de
 * imagens do TMDB (montada no presenter pelo helper governado a partir do
 * `file_path` cru): o thumb 16:9 renderiza `<img>` com `loading="lazy"` +
 * `decoding="async"`; ausente/null -> thumb com gradiente neutro. O servidor não
 * salva imagem — sem `/media/tmdb`, sem disco.
 */

export type ComingSoonItem = {
  title: string;
  date: string;
  href: string;
  /** URL pública remota do TMDB (backdrop/pôster) ou null/ausente = sem imagem. */
  imageUrl?: string | null;
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
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({
      left: direction === "next" ? step : -step,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  return (
    <>
      <div className="home-v4-soon-head">
        {heading}
        {items.length > 3 ? (
          <div className="home-v4-soon-nav">
            <button
              className="home-v4-rail-arrow"
              type="button"
              aria-label="Lançamento anterior"
              onClick={() => scrollRail("prev")}
            >
              ‹
            </button>
            <button
              className="home-v4-rail-arrow"
              type="button"
              aria-label="Próximo lançamento"
              onClick={() => scrollRail("next")}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>

      <div className="home-v4-soon-rail" ref={railRef}>
        {items.map((item, index) => (
          <a
            key={`coming-soon-${item.title}-${index}`}
            href={item.href}
            className="home-v4-trailer-card"
          >
            <span className="home-v4-trailer-thumb">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={`Imagem de ${item.title}`}
                  className="home-v4-trailer-img"
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              <span className="home-v4-trailer-scrim" aria-hidden="true" />
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
