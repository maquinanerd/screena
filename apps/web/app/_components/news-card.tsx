import type { ReactNode } from "react";

import type { NewsCardView } from "../../src/lib/news-presenter";

/**
 * NewsCard - card editorial de noticia (usado no destaque, no feed e em
 * "Leia tambem"). PRESENTACIONAL e PURO: recebe a `NewsCardView` ja montada por
 * props e so produz JSX. Nao importa @screena/db nem faz IO. Renderiza so dados
 * reais; sem imagem local segura, mostra fallback visual.
 */

export type NewsCardVariant = "featured" | "feed" | "related";

interface NewsCardProps {
  card: NewsCardView;
  variant: NewsCardVariant;
}

export function NewsCard({ card, variant }: NewsCardProps): ReactNode {
  const meta = [card.author, card.dateLabel, card.readTimeLabel].filter(
    (item): item is string => item !== null,
  );
  const showDeck = variant !== "related" && card.deck !== null;

  return (
    <a className="news-card" href={card.href} data-variant={variant}>
      <span className={`news-card__media${card.image ? " news-card__media--real" : ""}`}>
        {card.image !== null ? (
          <img
            src={card.image.src}
            alt={`Imagem de ${card.title}`}
            width={card.image.width}
            height={card.image.height}
            className="news-card__image"
            loading="lazy"
          />
        ) : (
          <span className="news-card__fallback" aria-hidden="true" />
        )}
      </span>
      <span className="news-card__body">
        {card.category !== null ? (
          <span className="news-card__category">{card.category}</span>
        ) : null}
        <span className="news-card__title">{card.title}</span>
        {showDeck ? <span className="news-card__deck">{card.deck}</span> : null}
        {meta.length > 0 ? (
          <span className="news-card__meta">{meta.join(" · ")}</span>
        ) : null}
      </span>
    </a>
  );
}
