/**
 * home-like-upcoming.test.tsx — O trilho "Em breve" DENTRO da página, nas três
 * superfícies home-like.
 *
 * O QUE SÓ ESTE ARQUIVO PEGA. Os testes puros de
 * `tests/web/home-upcoming-presenter.test.ts` provam que o presenter separa
 * filme de série. Nenhum deles falharia se `HomeLike` jogasse fora o
 * `verticalLabel`, marcasse todo bookmark como `movie` ou mandasse os dois
 * verticais para a mesma rota. Aqui a medida é o que o LEITOR vê na marcação
 * renderizada.
 *
 * COMO A MEDIDA É FEITA. A marcação é FATIADA por card (cada card é um
 * `<article class="glimpse-card"` que não contém outro `<article>`), e essa
 * precondição é VERIFICADA antes de qualquer asserção depender do corte — sem
 * isso a fatia poderia estar errada e os testes passariam por acidente. As
 * asserções olham TEXTO VISÍVEL dentro da fatia, não a existência do literal em
 * algum lugar da página.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeLike, type HomeLikeProps, type HomeLikeUpcoming } from "../home-like";
import { EMPTY_HOME_EDITORIAL_HIGHLIGHTS } from "../../../src/lib/home-editorial-presenter";
import {
  buildUpcomingItems,
  type HomeUpcomingItem,
  type UpcomingEntityInput,
} from "../../../src/lib/home-upcoming-presenter";

const NOW = new Date(Date.UTC(2026, 6, 7));

function entity(overrides: Partial<UpcomingEntityInput>): UpcomingEntityInput {
  return {
    vertical: "movie",
    titleOriginal: "Sem título",
    translationTitle: null,
    slug: "sem-slug",
    releaseDate: new Date(Date.UTC(2026, 7, 1)),
    backdropPath: null,
    posterPath: null,
    ...overrides,
  };
}

function items(...inputs: UpcomingEntityInput[]): HomeUpcomingItem[] {
  return buildUpcomingItems(inputs, NOW, 12);
}

/** `HomeLike` com TUDO desligado menos o trilho — a medida é só dele. */
function renderRail(upcoming: HomeLikeUpcoming): string {
  const props: HomeLikeProps = {
    heroSlides: [],
    tickerItems: [],
    editorialHighlights: EMPTY_HOME_EDITORIAL_HIGHLIGHTS,
    movieCards: [],
    seriesCards: [],
    upcoming,
    newsCards: [],
    showMoviesBand: false,
    showSeriesBand: false,
    adPrefix: "teste",
    emptyMessage: "vazio",
  };
  return renderToStaticMarkup(<HomeLike {...props} />);
}

const CARD_OPEN = '<article class="glimpse-card"';

/**
 * Fatia a marcação em um pedaço por card. Só é válido porque nenhum card
 * contém outro `<article>` — e isso é conferido aqui, não presumido.
 */
function cardSlices(markup: string): string[] {
  const parts = markup.split(CARD_OPEN).slice(1);
  for (const part of parts) {
    const slice = part.slice(0, part.indexOf("</article>"));
    expect(slice).not.toContain("<article");
  }
  return parts.map((part) => CARD_OPEN + part.slice(0, part.indexOf("</article>")));
}

/** Captura o que a página renderizou E o que ela registrou no log. */
function observe(render: () => string): { markup: string; logs: string[] } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    logs.push(String(line));
  });
  try {
    return { markup: render(), logs };
  } finally {
    spy.mockRestore();
  }
}

describe("o trilho aparece nas TRÊS rotas, com o dataset de cada uma", () => {
  it("/pt/filmes/ — só filme, e cada card diz 'Filme' e aponta para /pt/filmes/", () => {
    const markup = renderRail({
      items: items(
        entity({ slug: "duna-3", translationTitle: "Duna 3" }),
        entity({ slug: "avatar-4", translationTitle: "Avatar 4" }),
      ),
      vertical: "movie",
      route: "/pt/filmes/",
    });

    const cards = cardSlices(markup);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toContain(">Filme<");
      expect(card).not.toContain(">Série<");
      expect(card).toContain('href="/pt/filmes/');
      expect(card).not.toContain('href="/pt/series/');
    }
  });

  it("/pt/series/ — só série (a rota que NÃO tinha o trilho)", () => {
    const markup = renderRail({
      items: items(
        entity({ vertical: "series", slug: "fallout-2", translationTitle: "Fallout 2" }),
      ),
      vertical: "series",
      route: "/pt/series/",
    });

    const [card] = cardSlices(markup);
    expect(card).toBeDefined();
    expect(card).toContain(">Série<");
    expect(card).not.toContain(">Filme<");
    expect(card).toContain('href="/pt/series/fallout-2/"');
  });

  it("/pt/ — MISTO: os dois verticais no mesmo trilho, cada card dizendo o que é", () => {
    const markup = renderRail({
      items: items(
        entity({ slug: "duna-3", translationTitle: "Duna 3" }),
        entity({
          vertical: "series",
          slug: "fallout-2",
          translationTitle: "Fallout 2",
          releaseDate: new Date(Date.UTC(2026, 7, 2)),
        }),
      ),
      vertical: "mixed",
      route: "/pt/",
    });

    const cards = cardSlices(markup);
    expect(cards).toHaveLength(2);

    const filme = cards.find((c) => c.includes("Duna 3"));
    const serie = cards.find((c) => c.includes("Fallout 2"));
    expect(filme).toContain(">Filme<");
    expect(filme).toContain('href="/pt/filmes/duna-3/"');
    expect(serie).toContain(">Série<");
    expect(serie).toContain('href="/pt/series/fallout-2/"');
  });
});

/**
 * Invariante 11: a diferença filme/série NUNCA depende só da cor. Se alguém
 * apagar o badge e deixar só o `data-vertical`, este bloco reprova.
 */
describe("invariante 11 — a vertical é TEXTO, não só acento", () => {
  const MISTO = {
    items: items(
      entity({ slug: "f", translationTitle: "Um filme" }),
      entity({
        vertical: "series",
        slug: "s",
        translationTitle: "Uma série",
        releaseDate: new Date(Date.UTC(2026, 7, 3)),
      }),
    ),
    vertical: "mixed",
    route: "/pt/",
  } as const;

  it("CONTROLE POSITIVO: os dois cards existem e são distinguíveis", () => {
    // Sem isto, um render quebrado que não produzisse card nenhum passaria nas
    // asserções negativas abaixo.
    expect(cardSlices(renderRail(MISTO))).toHaveLength(2);
  });

  it("apagar o acento não apaga a informação: o rótulo textual sobrevive", () => {
    // Simula a leitura de quem não enxerga cor: a marcação é lida SEM os
    // atributos de vertical (o acento) e a distinção tem de continuar de pé.
    const semAcento = renderRail(MISTO).replace(/ data-vertical="[a-z]+"/g, "");
    expect(semAcento).toContain(">Filme<");
    expect(semAcento).toContain(">Série<");
    expect(semAcento).toContain('href="/pt/filmes/f/"');
    expect(semAcento).toContain('href="/pt/series/s/"');
  });

  it("o bookmark de série grava `tv`, não `movie`", () => {
    // O bookmark de card só existe com entityId; sem o alvo certo o item iria
    // para a watchlist da entidade errada.
    const comId = items(
      entity({ id: "77", vertical: "series", slug: "s", translationTitle: "Uma série" }),
    );
    expect(comId[0]?.bookmarkType).toBe("tv");
    const [card] = cardSlices(
      renderRail({ items: comId, vertical: "series", route: "/pt/series/" }),
    );
    // Anônimo no SSR: o controle é o link real de login, com o nome do título.
    expect(card).toContain("Entrar para salvar Uma série na watchlist");
  });
});

describe("trilho vazio: fora do DOM **e** log emitido — na mesma asserção", () => {
  beforeEach(() => {
    // O caminho de PRODUÇÃO é o que interessa: é lá que a ausência some.
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("/pt/series/ sem estreia futura registra a ROTA e a VERTICAL consultadas", () => {
    const observed = observe(() =>
      renderRail({ items: [], vertical: "series", route: "/pt/series/" }),
    );

    // Nada do trilho no DOM…
    expect(observed.markup).not.toContain("glimpse-rail");
    expect(observed.markup).not.toContain("Próximos lançamentos no catálogo");
    // …e o motivo registrado, com o que o operador precisa para agir.
    expect(observed.logs).toEqual([
      JSON.stringify({
        event: "section_absent",
        section: "em-breve",
        reason: "no_upcoming_title",
        route: "/pt/series/",
        vertical: "series",
        actionable: true,
      }),
    ]);
  });

  it("a home vazia se distingue de /pt/filmes/ vazia SÓ pelo log", () => {
    const home = observe(() => renderRail({ items: [], vertical: "mixed", route: "/pt/" }));
    const filmes = observe(() =>
      renderRail({ items: [], vertical: "movie", route: "/pt/filmes/" }),
    );

    // Visualmente idênticas: nenhuma das duas tem trilho.
    expect(home.markup).toBe(filmes.markup);
    // Operacionalmente diferentes.
    expect(home.logs).not.toEqual(filmes.logs);
    expect(home.logs[0]).toContain('"vertical":"mixed"');
    expect(filmes.logs[0]).toContain('"vertical":"movie"');
  });

  it("CONTROLE POSITIVO: com item, o trilho renderiza e NÃO registra nada", () => {
    const observed = observe(() =>
      renderRail({
        items: items(entity({ slug: "duna-3", translationTitle: "Duna 3" })),
        vertical: "movie",
        route: "/pt/filmes/",
      }),
    );
    expect(observed.markup).toContain("glimpse-rail");
    expect(observed.logs).toEqual([]);
  });
});
