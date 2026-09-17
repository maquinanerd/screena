/**
 * home-like-item-list.test.tsx — o `ItemList` de `/pt/filmes/` e `/pt/series/`
 * descreve o que a pagina MOSTRA.
 *
 * O DEFEITO (auditoria de SEO de 11/09/2026, secao 3.4): o `ItemList` trazia 24
 * titulos da listagem por ano, e 0 de 24 apareciam ou eram linkados na pagina.
 *
 * COMO A MEDIDA E FEITA. `HomeLike` e renderizado com os cards do trilho, e o
 * `ItemList` e montado com os MESMOS cards; cada `url` do schema tem de existir
 * como `href` na marcacao. O controle negativo prova que a medida reprova um
 * titulo que a pagina nao renderiza — sem ele, uma paridade que aceitasse tudo
 * passaria igual.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeLike, type HomeLikeProps } from "../home-like";
import type { EntityCard } from "../../../src/lib/entity-index-presenter";
import { EMPTY_HOME_EDITORIAL_HIGHLIGHTS } from "../../../src/lib/home-editorial-presenter";
import { railItemListJsonLd } from "../../../src/lib/rail-item-list";

const SITE = "https://cinerie.com";

function card(kind: "movie" | "series", slug: string, title: string): EntityCard {
  return {
    kind,
    entityId: null,
    title,
    href: `/pt/${kind === "movie" ? "filmes" : "series"}/${slug}/`,
    meta: null,
    image: null,
    screenScore: null,
  };
}

function render(overrides: Partial<HomeLikeProps>): string {
  const props: HomeLikeProps = {
    heroSlides: [],
    tickerItems: [],
    editorialHighlights: EMPTY_HOME_EDITORIAL_HIGHLIGHTS,
    movieCards: [],
    seriesCards: [],
    upcoming: { items: [], vertical: "movie", route: "/pt/filmes/" },
    newsCards: [],
    showMoviesBand: false,
    showSeriesBand: false,
    adPrefix: "teste",
    emptyMessage: "vazio",
    rankingPanels: [],
    vertical: "movies",
    ...overrides,
  };
  return renderToStaticMarkup(<HomeLike {...props} />);
}

/** Os `href` que a marcacao realmente contem. */
function hrefsOf(markup: string): Set<string> {
  return new Set([...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? ""));
}

/** As `url` do `ItemList`, sem a origem — a forma em que o `href` sai no HTML. */
function listedPaths(list: Record<string, unknown> | null): string[] {
  const elements = (list?.itemListElement ?? []) as { url: string }[];
  return elements.map((element) => element.url.slice(SITE.length));
}

// O trilho "Em breve" vazio registra a ausencia no console; aqui ela e ruido.
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("o ItemList das categorias e o trilho renderizado", () => {
  it("(1) /pt/filmes/: toda url do ItemList e um link de 'Filmes em alta'", () => {
    const cards = [card("movie", "duna-parte-dois", "Duna: Parte Dois"), card("movie", "oppenheimer", "Oppenheimer")];
    const markup = render({ movieCards: cards, showMoviesBand: true });
    const paths = listedPaths(railItemListJsonLd("Filmes em alta", cards, SITE));
    expect(paths).toEqual(["/pt/filmes/duna-parte-dois/", "/pt/filmes/oppenheimer/"]);
    const hrefs = hrefsOf(markup);
    for (const listed of paths) expect(hrefs.has(listed), listed).toBe(true);
  });

  it("(2) /pt/series/: toda url do ItemList e um link de 'Séries da semana'", () => {
    const cards = [card("series", "silo", "Silo"), card("series", "ruptura", "Ruptura")];
    const markup = render({
      seriesCards: cards,
      showSeriesBand: true,
      vertical: "series",
      upcoming: { items: [], vertical: "series", route: "/pt/series/" },
    });
    const paths = listedPaths(railItemListJsonLd("Séries da semana", cards, SITE));
    const hrefs = hrefsOf(markup);
    expect(paths).toHaveLength(2);
    for (const listed of paths) expect(hrefs.has(listed), listed).toBe(true);
  });

  it("(3) sem card no trilho, nao ha ItemList", () => {
    expect(railItemListJsonLd("Filmes em alta", [], SITE)).toBeNull();
  });

  it("(4) CONTROLE NEGATIVO: um titulo que a pagina NAO renderiza reprova na medida", () => {
    const markup = render({ movieCards: [card("movie", "duna-parte-dois", "Duna")], showMoviesBand: true });
    const fora = listedPaths(railItemListJsonLd("Filmes em alta", [card("movie", "fora-da-pagina", "X")], SITE));
    expect(hrefsOf(markup).has(fora[0] ?? "")).toBe(false);
  });
});
