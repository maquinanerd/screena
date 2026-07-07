"use client";

import { useEffect, useState } from "react";

import { SERIES_INDEX_PATH } from "../../src/lib/site";

/**
 * EpisodesTicker — faixa amarela (carrossel) abaixo do hero da Public Marketing
 * Home v4, seguindo o componente "Barra de Episódios Novos" do design v4
 * (docs EpisodesTicker.md). Um slide por vez entre séries com "episódio novo
 * hoje": badge NOVO + série + T/E + CTA "Onde assistir" com o wordmark do
 * streaming. Auto-rotação (4200ms), dots clicáveis, pausa no hover, respeita
 * prefers-reduced-motion.
 *
 * ⚠️ MOCK VISUAL — DÍVIDA TÉCNICA (ver memory home-v4-ticker-mock-debt):
 * os dados de `episodesToday()` são placeholder de FIDELIDADE VISUAL apenas.
 * NÃO são reais: não há `watch_availability` confirmada, então "Onde assistir
 * <streaming>" e "novo episódio hoje" NÃO afirmam disponibilidade/estreia real
 * (tensiona a invariante 6 e as regras de streaming). Antes de produção/
 * indexação, trocar por dado real governado (ex.: `/api/episodes/today` a partir
 * de `watch_availability`) ou remover o componente. Nada aqui é persistido, nem
 * vira schema.org.
 *
 * SAFE-LINK: todo `href` aponta para o índice REAL de séries (SERIES_INDEX_PATH),
 * nunca para slugs de série específicos que podem não existir no catálogo (evita
 * 404). Isso NÃO afirma disponibilidade real — só garante um destino existente
 * até a feature de estreias/streaming existir.
 */

const AUTO_MS = 4200;

export type EpisodeTickerItem = {
  /** Nome da série exibido (negrito). */
  series: string;
  /** "T{temporada} · E{episódio}". */
  seasonEp: string;
  /** Wordmark textual do streaming (placeholder — sem logo oficial). */
  logo: string;
  /** Cor da marca do streaming, legível sobre o amarelo da faixa. */
  logoColor: string;
  /** Destino do CTA — sempre o índice REAL de séries (safe-link, sem 404). */
  href: string;
};

/**
 * Fonte ÚNICA de dados (mock local, só visual). Ponto único a trocar por
 * `fetch('/api/episodes/today')` quando a feature de estreias/streaming existir.
 * Cores: wordmark legível sobre o amarelo (#F5C518) — Apple TV+ usa a tinta
 * escura (o branco do guia de marca ficaria invisível na faixa). Todos os `href`
 * apontam para o índice REAL de séries (safe-link) — nunca para slugs específicos
 * que poderiam dar 404.
 */
function episodesToday(): EpisodeTickerItem[] {
  return [
    {
      series: "Wednesday",
      seasonEp: "T2 · E6",
      logo: "NETFLIX",
      logoColor: "#E50914",
      href: SERIES_INDEX_PATH,
    },
    {
      series: "The Bear",
      seasonEp: "T3 · E4",
      logo: "Star+",
      logoColor: "#0A4DB3",
      href: SERIES_INDEX_PATH,
    },
    {
      series: "Severance",
      seasonEp: "T2 · E5",
      logo: "Apple TV+",
      logoColor: "#101010",
      href: SERIES_INDEX_PATH,
    },
    {
      series: "The Last of Us",
      seasonEp: "T2 · E3",
      logo: "Max",
      logoColor: "#6D5AE0",
      href: SERIES_INDEX_PATH,
    },
    {
      series: "The Boys",
      seasonEp: "T4 · E7",
      logo: "prime video",
      logoColor: "#0A6C8E",
      href: SERIES_INDEX_PATH,
    },
  ];
}

const EPISODES = episodesToday();

export function EpisodesTicker() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-rotação: reinicia a cada troca de slide (idx nas deps) — logo, clique
  // num dot também reinicia o timer. Pausa no hover (`paused`). Não roda se o
  // usuário pediu menos movimento (prefers-reduced-motion) ou se só há 1 slide.
  useEffect(() => {
    if (paused || EPISODES.length <= 1) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setIdx((i) => (i + 1) % EPISODES.length);
    }, AUTO_MS);
    return () => window.clearInterval(timer);
  }, [paused, idx]);

  const current = EPISODES[idx];
  if (current === undefined) return null;

  return (
    <section
      className="ep-ticker"
      aria-label="Episódios novos hoje"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="ep-ticker__inner">
        <div className="ep-ticker__info" aria-live="polite">
          <span className="ep-ticker__badge">NOVO</span>
          <p className="ep-ticker__text">
            <strong className="ep-ticker__series">{current.series}</strong>
            {" · "}
            <span className="ep-ticker__se">{current.seasonEp}</span>
            {" · novo episódio hoje"}
          </p>
        </div>

        <div className="ep-ticker__controls">
          <div
            className="ep-ticker__dots"
            role="tablist"
            aria-label="Selecionar episódio"
          >
            {EPISODES.map((item, i) => (
              <button
                key={item.series}
                type="button"
                role="tab"
                className={`ep-ticker__dot${i === idx ? " is-active" : ""}`}
                aria-label={`Ir para o slide ${i + 1}: ${item.series}`}
                aria-selected={i === idx}
                onClick={() => setIdx(i)}
              />
            ))}
          </div>

          <a className="ep-ticker__cta" href={current.href}>
            <span className="ep-ticker__cta-label">Onde assistir</span>
            <span
              className="ep-ticker__logo"
              style={{ color: current.logoColor }}
            >
              {current.logo}
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
