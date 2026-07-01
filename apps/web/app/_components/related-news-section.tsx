import type { ReactNode } from "react";

import { NewsCard } from "./news-card";
import type { NewsCardView } from "../../src/lib/news-presenter";

/**
 * RelatedNewsSection - secao "Noticias relacionadas" das paginas de detalhe
 * (filme/serie/pessoa). PRESENTACIONAL e PURO: recebe os cards ja montados por
 * props e so produz JSX; nao importa @screena/db nem faz IO.
 *
 * So aparece quando ha pelo menos 1 noticia relacionada real: com lista vazia,
 * retorna `null` (nenhuma secao vazia; nao induz thin content). Reusa `NewsCard`.
 */

interface RelatedNewsSectionProps {
  cards: NewsCardView[];
}

export function RelatedNewsSection({ cards }: RelatedNewsSectionProps): ReactNode {
  if (cards.length === 0) return null;

  return (
    <div className="container">
      <section className="related-news" aria-labelledby="related-news-title">
        <h2 id="related-news-title" className="related-news__title">
          Noticias relacionadas
        </h2>
        <ul className="related-news__grid">
          {cards.map((card) => (
            <li key={card.href} className="related-news__item">
              <NewsCard card={card} variant="feed" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
