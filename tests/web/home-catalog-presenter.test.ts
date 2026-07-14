import { describe, expect, it } from "vitest";

import {
  buildTrendingMovieCards,
  HOME_TRENDING_CARD_LIMIT,
} from "../../apps/web/src/lib/home-catalog-presenter";
import type {
  MovieListItemInput,
} from "../../apps/web/src/lib/entity-index-presenter";

function movie(title: string, slug: string | null): MovieListItemInput {
  return {
    titleOriginal: title,
    translationTitle: null,
    slug,
    year: 2026,
    posterPath: null,
  };
}

describe("home catalog presenter", () => {
  it("preserva a ordem persistida e não repete títulos para completar a grade", () => {
    const cards = buildTrendingMovieCards([
      movie("Primeiro", "primeiro"),
      movie("Segundo", "segundo"),
    ]);

    expect(cards.map((card) => card.title)).toEqual(["Primeiro", "Segundo"]);
    expect(cards).toHaveLength(2);
  });

  it("descarta entradas inválidas e aplica o limite canônico de seis", () => {
    const inputs = [
      movie("Inválido", null),
      ...Array.from({ length: 8 }, (_, index) =>
        movie(`Filme ${index + 1}`, `filme-${index + 1}`),
      ),
    ];

    const cards = buildTrendingMovieCards(inputs);
    expect(cards).toHaveLength(HOME_TRENDING_CARD_LIMIT);
    expect(cards[0]?.title).toBe("Filme 1");
    expect(cards.at(-1)?.title).toBe("Filme 6");
  });
});
