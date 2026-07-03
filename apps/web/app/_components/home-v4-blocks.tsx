import type { ReactNode } from "react";

import type { NewsCardView } from "../../src/lib/news-presenter";

/**
 * Blocos da home v4: faixa preta "Seu mês em números" + módulo de notícias
 * (magazine). Portados de `Screen Screens v4.dc.html`.
 *
 * PRESENTACIONAIS e PUROS (invariantes 3/4). Governança:
 * - "Seu mês em números" é dado de USUÁRIO (feature futura). Como não há login
 *   nem tracking nesta fase, a faixa mostra um estado NEUTRO (0 listas, 0
 *   avaliações, 0 em andamento, 0 na watchlist) — nunca números fabricados. O
 *   componente aceita `stats` para quando o dado real do usuário existir.
 * - O módulo de notícias mantém o layout magazine mesmo vazio: sem notícia real,
 *   exibe um estado vazio visualmente consistente — nunca uma notícia falsa.
 */

export interface HomeStat {
  value: string;
  label: string;
}

/** Estado neutro (sem usuário/tracking nesta fase). Nunca inventar números. */
const NEUTRAL_STATS: HomeStat[] = [
  { value: "0", label: "listas" },
  { value: "0", label: "avaliações" },
  { value: "0", label: "séries em andamento" },
  { value: "0", label: "na watchlist" },
];

function TrendIcon(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 16 9 10 13 14 21 6" />
      <polyline points="15 6 21 6 21 12" />
    </svg>
  );
}

export function HomeV4StatsBand({ stats = NEUTRAL_STATS }: { stats?: HomeStat[] }): ReactNode {
  return (
    <div className="home-v4-stats">
      <div className="container home-v4-stats__inner">
        <div className="home-v4-stats__left">
          <span className="home-v4-stats__eyebrow">
            <TrendIcon />
            Seu mês em números
          </span>
          <div className="home-v4-stats__list">
            {stats.map((stat) => (
              <span key={stat.label} className="home-v4-stats__item">
                <span className="home-v4-stats__value">{stat.value}</span> {stat.label}
              </span>
            ))}
          </div>
        </div>
        {/* Afordancia visual (sem rota de historico nesta fase). */}
        <span className="home-v4-stats__more" aria-hidden="true">Ver histórico →</span>
      </div>
    </div>
  );
}

function NewsTile({ card, variant }: { card: NewsCardView; variant: "lead" | "grid" }): ReactNode {
  return (
    <a className={`home-v4-news-tile home-v4-news-tile--${variant}`} href={card.href}>
      {card.image !== null ? (
        <img
          src={card.image.src}
          alt=""
          width={card.image.width}
          height={card.image.height}
          className="home-v4-news-tile__img"
          loading="lazy"
        />
      ) : null}
      <span className="home-v4-news-tile__scrim" aria-hidden="true" />
      <span className="home-v4-news-tile__body">
        {card.category !== null ? (
          <span className="home-v4-news-tile__cat">{card.category}</span>
        ) : null}
        <span className="home-v4-news-tile__title">{card.title}</span>
        {variant === "lead" && card.deck !== null ? (
          <span className="home-v4-news-tile__deck">{card.deck}</span>
        ) : null}
      </span>
    </a>
  );
}

export function HomeV4NewsMagazine({
  featured,
  cards,
}: {
  featured: NewsCardView | null;
  cards: NewsCardView[];
}): ReactNode {
  const hasNews = featured !== null || cards.length > 0;

  if (!hasNews) {
    // Estado vazio consistente com o layout magazine (nunca notícia falsa).
    return (
      <div className="home-v4-news">
        <div className="home-v4-news-tile home-v4-news-tile--lead home-v4-news-tile--empty">
          <span className="home-v4-news-tile__scrim" aria-hidden="true" />
          <span className="home-v4-news-tile__body">
            <span className="home-v4-news-tile__cat">Redação Screen</span>
            <span className="home-v4-news-tile__title">
              As notícias de cinema e séries chegam em breve.
            </span>
            <span className="home-v4-news-tile__deck">
              A editoria do Screen publica análises e coberturas revisadas — ainda não há
              matérias publicadas nesta seção.
            </span>
          </span>
        </div>
        <div className="home-v4-news__grid">
          <span className="home-v4-news-tile home-v4-news-tile--grid home-v4-news-tile--empty" aria-hidden="true" />
          <span className="home-v4-news-tile home-v4-news-tile--grid home-v4-news-tile--empty" aria-hidden="true" />
          <span className="home-v4-news-tile home-v4-news-tile--grid home-v4-news-tile--empty" aria-hidden="true" />
          <span className="home-v4-news-tile home-v4-news-tile--grid home-v4-news-tile--empty" aria-hidden="true" />
        </div>
      </div>
    );
  }

  return (
    <div className="home-v4-news">
      {featured !== null ? (
        <NewsTile card={featured} variant="lead" />
      ) : null}
      <div className="home-v4-news__grid">
        {cards.map((card) => (
          <NewsTile key={card.href} card={card} variant="grid" />
        ))}
      </div>
    </div>
  );
}
