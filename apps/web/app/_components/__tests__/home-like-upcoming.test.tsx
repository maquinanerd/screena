/**
 * home-like-upcoming.test.tsx — O trilho "Em breve" DENTRO da página, nas três
 * superfícies home-like.
 *
 * O QUE SÓ ESTE ARQUIVO PEGA. Os testes puros de
 * `tests/web/home-upcoming-presenter.test.ts` provam que o presenter separa
 * filme de série e conhecem o piso. Nenhum deles falharia se `HomeLike` jogasse
 * fora o `verticalLabel`, marcasse todo bookmark como `movie`, mandasse os dois
 * verticais para a mesma rota ou aplicasse o piso com um `return null` mudo.
 * Aqui a medida é o que o LEITOR vê na marcação renderizada — e o que o
 * OPERADOR vê no log quando não há marcação nenhuma.
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
  HOME_UPCOMING_MIN,
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

/**
 * Enche o trilho até o piso com itens genéricos daquela vertical, para que o
 * caso sob teste seja a DISTINÇÃO entre cards e não a contagem. Os itens de
 * recheio estreiam depois (dia 20+) para nunca disputarem a ordem com os
 * títulos nomeados de cada teste.
 */
function padding(vertical: "movie" | "series", count: number): UpcomingEntityInput[] {
  return Array.from({ length: count }, (_unused, i) =>
    entity({
      vertical,
      slug: `recheio-${vertical}-${i}`,
      translationTitle: `Recheio ${vertical} ${i}`,
      releaseDate: new Date(Date.UTC(2026, 7, 20 + i)),
    }),
  );
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
        entity({
          slug: "avatar-4",
          translationTitle: "Avatar 4",
          releaseDate: new Date(Date.UTC(2026, 7, 2)),
        }),
        ...padding("movie", 2),
      ),
      vertical: "movie",
      route: "/pt/filmes/",
    });

    const cards = cardSlices(markup);
    expect(cards).toHaveLength(4);
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
        ...padding("series", 3),
      ),
      vertical: "series",
      route: "/pt/series/",
    });

    const cards = cardSlices(markup);
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card).toContain(">Série<");
      expect(card).not.toContain(">Filme<");
      expect(card).toContain('href="/pt/series/');
    }
    expect(cards[0]).toContain('href="/pt/series/fallout-2/"');
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
        ...padding("movie", 1),
        ...padding("series", 1),
      ),
      vertical: "mixed",
      route: "/pt/",
    });

    const cards = cardSlices(markup);
    expect(cards).toHaveLength(4);

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
      ...padding("movie", 1),
      ...padding("series", 1),
    ),
    vertical: "mixed",
    route: "/pt/",
  } as const;

  it("CONTROLE POSITIVO: os cards existem e são distinguíveis", () => {
    // Sem isto, um render quebrado que não produzisse card nenhum passaria nas
    // asserções negativas abaixo.
    expect(cardSlices(renderRail(MISTO))).toHaveLength(4);
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
      ...padding("series", 3),
    );
    expect(comId[0]?.bookmarkType).toBe("tv");
    const [card] = cardSlices(
      renderRail({ items: comId, vertical: "series", route: "/pt/series/" }),
    );
    // Anônimo no SSR: o controle é o link real de login, com o nome do título.
    expect(card).toContain("Entrar para salvar Uma série na watchlist");
  });
});

describe("trilho fora do DOM **e** log emitido — na mesma asserção", () => {
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
        available: 0,
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

  it("CONTROLE POSITIVO: no piso, o trilho renderiza e NÃO registra nada", () => {
    const observed = observe(() =>
      renderRail({
        items: items(...padding("movie", HOME_UPCOMING_MIN)),
        vertical: "movie",
        route: "/pt/filmes/",
      }),
    );
    expect(observed.markup).toContain("glimpse-rail");
    expect(observed.logs).toEqual([]);
  });
});

/**
 * O piso. "Menos de 4 não mostra a seção" é fácil de cumprir errado: um
 * `if (items.length < 4) return null` cumpre a metade visual e devolve a
 * ausência muda. Aqui as duas metades são medidas juntas — e o motivo tem de
 * ser DIFERENTE do motivo de trilho vazio.
 */
describe("piso de 4 itens — abaixo dele o trilho some COM motivo", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("3 itens: fora do DOM, log `below_upcoming_floor` e a contagem real", () => {
    const observed = observe(() =>
      renderRail({
        items: items(...padding("movie", 3)),
        vertical: "movie",
        route: "/pt/filmes/",
      }),
    );

    expect(observed.markup).not.toContain("glimpse-rail");
    expect(observed.logs).toEqual([
      JSON.stringify({
        event: "section_absent",
        section: "em-breve",
        reason: "below_upcoming_floor",
        route: "/pt/filmes/",
        vertical: "movie",
        available: 3,
        actionable: true,
      }),
    ]);
  });

  it("1, 2 e 3 itens somem; 4 acende — a fronteira é exatamente o piso", () => {
    const renderiza = (n: number): boolean =>
      observe(() =>
        renderRail({
          items: items(...padding("movie", n)),
          vertical: "movie",
          route: "/pt/filmes/",
        }),
      ).markup.includes("glimpse-rail");

    expect([1, 2, 3].map(renderiza)).toEqual([false, false, false]);
    expect(renderiza(HOME_UPCOMING_MIN)).toBe(true);
    expect(renderiza(HOME_UPCOMING_MIN + 1)).toBe(true);
  });

  it("`vazio` e `abaixo do piso` NÃO colapsam no mesmo motivo", () => {
    // Colapsar os dois apagaria justamente o caso em que a ingestão já funciona
    // e falta pouco para acender.
    const vazio = observe(() =>
      renderRail({ items: [], vertical: "movie", route: "/pt/filmes/" }),
    );
    const abaixo = observe(() =>
      renderRail({
        items: items(...padding("movie", 3)),
        vertical: "movie",
        route: "/pt/filmes/",
      }),
    );

    // Visualmente idênticos…
    expect(vazio.markup).toBe(abaixo.markup);
    // …e o log é a ÚNICA coisa que os separa.
    expect(vazio.logs[0]).toContain('"reason":"no_upcoming_title"');
    expect(vazio.logs[0]).toContain('"available":0');
    expect(abaixo.logs[0]).toContain('"reason":"below_upcoming_floor"');
    expect(abaixo.logs[0]).toContain('"available":3');
  });

  it("abaixo do piso a página não finge conteúdo: cai no estado vazio honesto", () => {
    // Se o trilho fosse a única coisa da página e sumisse pelo piso, contar
    // aqueles 3 itens como conteúdo deixaria a página em branco sem explicação.
    const markup = observe(() =>
      renderRail({
        items: items(...padding("movie", 3)),
        vertical: "movie",
        route: "/pt/filmes/",
      }),
    ).markup;
    expect(markup).toContain("vazio");
  });
});
