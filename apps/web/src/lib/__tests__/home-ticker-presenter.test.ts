import { describe, expect, it } from "vitest";

import {
  formatEventDate,
  HOME_TICKER_MAX_ITEMS,
  orderAndDedupeTickerItems,
  startOfUtcDay,
  tickerItemId,
  type HomeTickerItem,
  type TickerProvider,
} from "../home-ticker-presenter";

/**
 * A faixa amarela é um CARROSSEL de novidades reais, não um item único. Estes
 * testes provam a ordenação determinística, o dedupe em duas camadas e o teto
 * de itens — as três coisas que separam "cinco novidades" de "cinco dots".
 */

const NOW = new Date("2026-07-28T15:00:00.000Z");
const TODAY = "2026-07-28";

const PROVIDER: TickerProvider = {
  name: "Max",
  key: "max",
  // Obrigatorio desde que a faixa passou a dizer o que a oferta CUSTA: nomear a
  // plataforma sem a modalidade afirma que o titulo esta incluso na assinatura
  // que o leitor ja paga, e compra/aluguel sao a maioria do corpus.
  modalityLabel: "Assinatura",
  attributionText: "Disponibilidade fornecida por Movie of the Night",
  attributionUrl: "https://www.movieofthenight.com/",
};

function episode(
  entityId: string,
  eventAtIso: string,
  today: boolean,
): HomeTickerItem {
  const kind = today ? ("episode_today" as const) : ("episode_upcoming" as const);
  return {
    kind,
    id: tickerItemId(kind, "tv", entityId, eventAtIso),
    badge: today ? "NOVO" : "EM BREVE",
    title: `Série ${entityId}`,
    detail: "T2 · E5",
    href: `/pt/series/serie-${entityId}/`,
    provider: null,
    eventAtIso,
    entityType: "tv",
    entityId,
    seasonEp: "T2 · E5",
    episodeTitle: null,
  };
}

function movieRelease(entityId: string, eventAtIso: string): HomeTickerItem {
  return {
    kind: "movie_release",
    id: tickerItemId("movie_release", "movie", entityId, eventAtIso),
    badge: eventAtIso === TODAY ? "NOVO" : "EM BREVE",
    title: `Filme ${entityId}`,
    detail: "estreia hoje",
    href: `/pt/filmes/filme-${entityId}/`,
    provider: null,
    eventAtIso,
    entityType: "movie",
    entityId,
  };
}

function seriesRelease(entityId: string, eventAtIso: string): HomeTickerItem {
  return {
    kind: "series_release",
    id: tickerItemId("series_release", "tv", entityId, eventAtIso),
    badge: "EM BREVE",
    title: `Série ${entityId}`,
    detail: "temporada 3 estreia",
    href: `/pt/series/serie-${entityId}/`,
    provider: null,
    eventAtIso,
    entityType: "tv",
    entityId,
    seasonNumber: 3,
  };
}

function arrival(entityId: string, eventAtIso: string): HomeTickerItem {
  return {
    kind: "streaming_arrival",
    id: tickerItemId("streaming_arrival", "movie", entityId, eventAtIso),
    badge: "NOVO",
    title: `Filme ${entityId}`,
    detail: "chegou ao streaming",
    href: `/pt/filmes/filme-${entityId}/`,
    provider: PROVIDER,
    eventAtIso,
    entityType: "movie",
    entityId,
  };
}

describe("ticker — ordenação", () => {
  it("hoje primeiro, depois futuro por data crescente, depois streaming", () => {
    const out = orderAndDedupeTickerItems(
      [
        arrival("90", "2026-07-26T00:00:00.000Z"),
        episode("2", "2026-08-05", false),
        episode("1", TODAY, true),
        episode("3", "2026-07-30", false),
      ],
      NOW,
    );
    expect(out.map((i) => i.kind)).toEqual([
      "episode_today",
      "episode_upcoming",
      "episode_upcoming",
      "streaming_arrival",
    ]);
    expect(out.map((i) => i.entityId)).toEqual(["1", "3", "2", "90"]);
  });

  it("é determinística: a mesma entrada embaralhada dá a mesma saída", () => {
    const items = [
      episode("1", TODAY, true),
      movieRelease("2", TODAY),
      seriesRelease("3", "2026-08-01"),
      arrival("4", "2026-07-27T10:00:00.000Z"),
    ];
    const a = orderAndDedupeTickerItems(items, NOW).map((i) => i.id);
    const b = orderAndDedupeTickerItems([...items].reverse(), NOW).map((i) => i.id);
    expect(b).toEqual(a);
  });

  it("uma oferta que passa a valer HOJE conta como acontecimento de hoje", () => {
    const out = orderAndDedupeTickerItems(
      [episode("1", "2026-08-10", false), arrival("2", "2026-07-28T06:00:00.000Z")],
      NOW,
    );
    expect(out[0]?.kind).toBe("streaming_arrival");
  });

  it("chegadas ao streaming vêm da mais recente para a mais antiga", () => {
    const out = orderAndDedupeTickerItems(
      [
        arrival("1", "2026-07-22T00:00:00.000Z"),
        arrival("2", "2026-07-26T00:00:00.000Z"),
        arrival("3", "2026-07-24T00:00:00.000Z"),
      ],
      NOW,
    );
    expect(out.map((i) => i.entityId)).toEqual(["2", "3", "1"]);
  });
});

describe("ticker — dedupe em duas camadas", () => {
  it("a MESMA novidade nunca aparece duas vezes", () => {
    const same = episode("1", TODAY, true);
    expect(orderAndDedupeTickerItems([same, { ...same }], NOW)).toHaveLength(1);
  });

  it("a mesma SÉRIE não ocupa dois slots (episódio + estreia de temporada)", () => {
    const out = orderAndDedupeTickerItems(
      [episode("7", TODAY, true), seriesRelease("7", "2026-08-02")],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.entityId).toBe("7");
  });

  it("o mesmo FILME não aparece como estreia E como chegada ao streaming", () => {
    const out = orderAndDedupeTickerItems(
      [movieRelease("9", TODAY), arrival("9", "2026-07-27T00:00:00.000Z")],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("movie_release");
  });

  it("entidades DIFERENTES com o mesmo id em tabelas diferentes não colidem", () => {
    // `movies.id` e `tv_shows.id` são sequências independentes: o filme 5 e a
    // série 5 são entidades distintas e ambas podem aparecer.
    const out = orderAndDedupeTickerItems(
      [movieRelease("5", TODAY), episode("5", TODAY, true)],
      NOW,
    );
    expect(out).toHaveLength(2);
  });
});

describe("ticker — teto de itens", () => {
  it("nunca passa de cinco itens, mesmo com muitas novidades reais", () => {
    const many = Array.from({ length: 12 }, (_, i) => episode(String(i), TODAY, true));
    expect(orderAndDedupeTickerItems(many, NOW)).toHaveLength(HOME_TICKER_MAX_ITEMS);
  });

  it("com menos novidades do que o alvo, devolve só o que é REAL", () => {
    const out = orderAndDedupeTickerItems([episode("1", TODAY, true)], NOW);
    expect(out).toHaveLength(1);
    expect(orderAndDedupeTickerItems([], NOW)).toEqual([]);
  });
});

describe("ticker — helpers puros", () => {
  it("startOfUtcDay zera a hora em UTC", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-07-28T00:00:00.000Z");
  });

  it("formatEventDate usa pt-BR em UTC (sem alegar hora)", () => {
    expect(formatEventDate(new Date("2026-08-02T00:00:00.000Z"))).toBe("2 de agosto");
  });

  it("tickerItemId é estável e distingue tipo, entidade e data", () => {
    expect(tickerItemId("movie_release", "movie", "1", TODAY)).toBe(
      "movie_release:movie:1:2026-07-28",
    );
    expect(tickerItemId("movie_release", "movie", "1", null)).toBe(
      "movie_release:movie:1:-",
    );
  });
});
