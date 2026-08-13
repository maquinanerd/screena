/**
 * ratings-panel.test.tsx — A fileira de chips de nota, no DOM.
 *
 * DUAS COISAS QUE SO UM TESTE DE MARCACAO PEGA
 * --------------------------------------------
 * 1. CONTENCAO DO CREDITO. Os 12 testes do gate
 *    (`tests/governance/credit-required-on-display.test.ts`) exercitam o
 *    PRESENTER: eles provam que uma nota sem `attribution.text` nao vira item.
 *    Nenhum deles olha marcacao — e nenhum deles falharia se alguem movesse o
 *    credito para o rodape da pagina, para uma secao "Fontes" no fim ou para um
 *    tooltip. Todos continuariam verdes enquanto a licenca era violada em
 *    producao. Este arquivo fecha esse buraco: o credito tem de estar DENTRO do
 *    elemento do chip, e a assercao e de contencao (o texto aparece na fatia de
 *    marcacao daquele chip), nao de existencia na pagina.
 * 2. DIVISORIAS. "n chips => n-1 divisorias, nenhuma na borda" para 0, 1, 2, 3
 *    e 4 fontes.
 *
 * COMO A CONTENCAO E MEDIDA SEM jsdom. O projeto roda vitest em `environment:
 * 'node'` e nao tem testing-library. Em vez de adicionar dependencia, a
 * marcacao estatica e FATIADA por chip. O corte e exato porque cada chip e um
 * `<li>` que nao contem nenhum outro `<li>` — e essa precondicao e VERIFICADA
 * (`assertChipsHaveNoNestedListItems`) antes de qualquer assercao depender do
 * corte. Sem isso, a fatia poderia estar errada e os testes passariam por
 * acidente.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RatingsPanel } from "../ratings-panel";
import {
  buildRatingsView,
  type RatingsPanelView,
} from "../../../src/lib/ratings-presenter";

const CHIP_OPEN = '<li class="rating-chip"';

/** Nota completa e creditada; cada fonte troca so o que a distingue. */
function rating(over: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceKey: "imdb",
    sourceLabel: "IMDb",
    scoreType: "audience",
    label: "IMDb Rating",
    value: 7.9,
    best: 10,
    count: null,
    updatedAt: "2026-08-10T00:00:00.000Z",
    attribution: { text: "Nota fornecida por IMDb", url: null },
    ...over,
  };
}

const IMDB = rating({
  count: 8114,
  attribution: {
    text: "Nota fornecida por IMDb",
    url: "https://www.imdb.com/title/tt3896198/",
  },
});
const ROTTEN_TOMATOES = rating({
  sourceKey: "rotten_tomatoes",
  sourceLabel: "Rotten Tomatoes",
  scoreType: "critics",
  label: "Tomatometer",
  value: 85,
  best: 100,
  attribution: { text: "Nota fornecida por Rotten Tomatoes", url: null },
});
const METACRITIC = rating({
  sourceKey: "metacritic",
  sourceLabel: "Metacritic",
  scoreType: "critics",
  label: "Metascore",
  value: 67,
  best: 100,
  attribution: { text: "Nota fornecida por Metacritic", url: null },
});
const LETTERBOXD = rating({
  sourceKey: "letterboxd",
  sourceLabel: "Letterboxd",
  scoreType: "audience",
  label: "Letterboxd Rating",
  value: 4.2,
  best: 5,
  attribution: { text: "Nota fornecida por Letterboxd", url: null },
});

/**
 * CONTROLE POSITIVO. Constroi a view e exige que ela tenha EXATAMENTE o numero
 * de itens pedido.
 *
 * Sem isto, uma fixture que parou de passar no gate (um `attribution.text`
 * apagado, um `best` invalido) faria `buildRatingsView` devolver `null`, a
 * fileira nao renderizaria, e "0 divisorias" continuaria verdinho para o caso
 * de 4 fontes — provando o oposto do que o teste afirma. Ja aconteceu neste
 * repositorio; aqui a fixture nao tem chance de mentir em silencio.
 */
function viewOf(ratings: readonly Record<string, unknown>[]): RatingsPanelView | null {
  const view = buildRatingsView({ ratings } as never);
  const got = view?.items.length ?? 0;
  if (got !== ratings.length) {
    throw new Error(
      `FIXTURE INUTILIZAVEL: ${ratings.length} nota(s) entraram e ${got} item(ns) sairam do ` +
        "presenter. Toda assercao abaixo passaria pelo motivo errado. " +
        "Confira attribution.text, best/escala e scoreType das fixtures.",
    );
  }
  return view;
}

function markupOf(ratings: readonly Record<string, unknown>[]): string {
  return renderToStaticMarkup(<RatingsPanel view={viewOf(ratings)} />);
}

/**
 * PRECONDICAO DO CORTE: nenhum chip contem outro `<li>`.
 *
 * Se algum dia um chip ganhar uma lista interna, o fatiamento por `</li>` passa
 * a cortar cedo e as assercoes de contencao viram ruido. Melhor estourar aqui,
 * com a causa nomeada, do que ficar verde sobre uma fatia errada.
 */
function assertChipsHaveNoNestedListItems(markup: string): void {
  const opens = markup.split("<li").length - 1;
  const chips = markup.split(CHIP_OPEN).length - 1;
  if (opens !== chips) {
    throw new Error(
      `CORTE INVALIDO: a marcacao tem ${opens} <li> para ${chips} chip(s). Algum chip ganhou ` +
        "uma lista aninhada, e o fatiamento por </li> deixou de delimitar o chip. " +
        "Ajuste o extrator antes de confiar nas assercoes de contencao.",
    );
  }
}

/** As fatias de marcacao de cada chip, na ordem em que aparecem. */
function chipSlices(markup: string): string[] {
  assertChipsHaveNoNestedListItems(markup);
  return markup
    .split(CHIP_OPEN)
    .slice(1)
    .map((chunk) => {
      const end = chunk.indexOf("</li>");
      if (end === -1) throw new Error("CORTE INVALIDO: chip sem </li> de fechamento.");
      return chunk.slice(0, end);
    });
}

function dividerCount(markup: string): number {
  return markup.split('class="rating-chip__divider"').length - 1;
}

describe("credito: DENTRO do chip da nota, nunca solto na pagina", () => {
  it("o credito de cada fonte esta na fatia de marcacao do SEU chip", () => {
    const markup = markupOf([IMDB, ROTTEN_TOMATOES, METACRITIC]);
    const chips = chipSlices(markup);
    expect(chips).toHaveLength(3);

    const esperado: readonly [string, string][] = [
      ["imdb", "Nota fornecida por IMDb"],
      ["rotten_tomatoes", "Nota fornecida por Rotten Tomatoes"],
      ["metacritic", "Nota fornecida por Metacritic"],
    ];

    for (const [sourceKey, credito] of esperado) {
      const chip = chips.find((slice) => slice.includes(`data-rating-source="${sourceKey}"`));
      expect(chip, `chip de ${sourceKey} ausente`).toBeDefined();
      // CONTENCAO: o credito esta dentro do chip...
      expect(chip!).toContain(credito);
      // ...e dentro do elemento de credito, nao perdido em qualquer lugar dele.
      expect(chip!).toContain('class="rating-chip__credit"');
    }
  });

  it("nenhum credito aparece FORA de um chip (nao virou rodape nem secao Fontes)", () => {
    const markup = markupOf([IMDB, ROTTEN_TOMATOES, METACRITIC]);
    // Remove as fatias dos chips; o que sobra e "o resto da fileira".
    let resto = markup;
    for (const chip of chipSlices(markup)) resto = resto.replace(chip, "");

    expect(resto).not.toContain("Nota fornecida por IMDb");
    expect(resto).not.toContain("Nota fornecida por Rotten Tomatoes");
    expect(resto).not.toContain("Nota fornecida por Metacritic");
  });

  it("o credito e TEXTO VISIVEL, nunca so aria-label ou title", () => {
    const chip = chipSlices(markupOf([ROTTEN_TOMATOES]))[0]!;
    // O texto aparece como conteudo do elemento (`>...<`), nao dentro de aspas
    // de atributo.
    expect(chip).toContain(">Nota fornecida por Rotten Tomatoes<");
    expect(chip).not.toContain('aria-label="Nota fornecida');
    expect(chip).not.toContain('title="Nota fornecida');
  });

  it("linkback so onde ha URL canonica: IMDb linka, Rotten Tomatoes credita em texto", () => {
    const chips = chipSlices(markupOf([IMDB, ROTTEN_TOMATOES]));
    const imdb = chips.find((c) => c.includes('data-rating-source="imdb"'))!;
    const rt = chips.find((c) => c.includes('data-rating-source="rotten_tomatoes"'))!;

    expect(imdb).toContain('href="https://www.imdb.com/title/tt3896198/"');
    // A OMDb nao entrega identificador de RT/Metacritic: derivar slug do titulo
    // fabricaria um link que pode nao existir.
    expect(rt).not.toContain("<a");
    expect(rt).toContain("Nota fornecida por Rotten Tomatoes");
  });
});

describe("contagem de votos: so quando a fonte informa", () => {
  it("IMDb mostra o volume; Rotten Tomatoes nao inventa 31 criticas", () => {
    const chips = chipSlices(markupOf([IMDB, ROTTEN_TOMATOES]));
    const imdb = chips.find((c) => c.includes('data-rating-source="imdb"'))!;
    const rt = chips.find((c) => c.includes('data-rating-source="rotten_tomatoes"'))!;

    expect(imdb).toContain("8.114 votos");
    expect(rt).not.toContain("votos");
    expect(rt).not.toContain("críticas");
  });
});

describe("fileira dirigida por dado: 0, 1, 2, 3 e 4 fontes", () => {
  it("ZERO fontes: a fileira inteira nao vai ao DOM", () => {
    expect(renderToStaticMarkup(<RatingsPanel view={buildRatingsView({ ratings: [] } as never)} />)).toBe("");
  });

  it.each([
    ["1 fonte", [IMDB], 1],
    ["2 fontes", [IMDB, ROTTEN_TOMATOES], 2],
    ["3 fontes", [IMDB, ROTTEN_TOMATOES, METACRITIC], 3],
    ["4 fontes", [IMDB, ROTTEN_TOMATOES, METACRITIC, LETTERBOXD], 4],
  ])("%s: %i chip(s) e exatamente n-1 divisorias, nenhuma na borda", (_nome, ratings, n) => {
    const markup = markupOf(ratings as Record<string, unknown>[]);
    const chips = chipSlices(markup);

    expect(chips).toHaveLength(n);
    expect(dividerCount(markup)).toBe(n - 1);
    // Nunca sobra risco na PONTA: o primeiro chip nao tem divisoria liderante...
    expect(chips[0]).not.toContain("rating-chip__divider");
    // ...e o ultimo tambem nao emite nenhuma a sua direita (a divisoria e
    // sempre liderante, entao nao existe "depois do ultimo").
    expect(markup.slice(markup.lastIndexOf("</li>"))).not.toContain("rating-chip__divider");
  });

  it("ordem de prioridade declarada, independente da ordem de entrada", () => {
    // Entra fora de ordem de proposito.
    const markup = markupOf([METACRITIC, LETTERBOXD, ROTTEN_TOMATOES, IMDB]);
    const ordem = chipSlices(markup).map(
      (chip) => /data-rating-source="([^"]+)"/.exec(chip)![1],
    );
    expect(ordem).toEqual(["imdb", "rotten_tomatoes", "metacritic", "letterboxd"]);
  });
});

describe("licenca: a marca grafica da fonte NAO vai ao ar (logo_allowed = false)", () => {
  it("o slot da marca e o nome em texto — sem svg, sem img, sem cor de marca", () => {
    const chip = chipSlices(markupOf([IMDB]))[0]!;

    expect(chip).toContain('class="rating-chip__mark"');
    expect(chip).toContain(">IMDb<");
    expect(chip).not.toContain("<svg");
    expect(chip).not.toContain("<img");
    // As cores de marca do canonico (amarelo IMDb, tomate RT, azul TMDB).
    expect(chip).not.toContain("#F5C518");
    expect(chip).not.toContain("#FA320A");
    expect(chip).not.toContain("#01B4E4");
  });
});

describe("sufixo por fonte chega ao DOM", () => {
  it("Rotten Tomatoes sai como % e Metacritic como /100 na marcacao", () => {
    const chips = chipSlices(markupOf([ROTTEN_TOMATOES, METACRITIC]));
    const rt = chips.find((c) => c.includes('data-rating-source="rotten_tomatoes"'))!;
    const mc = chips.find((c) => c.includes('data-rating-source="metacritic"'))!;

    expect(rt).toContain(">85<");
    expect(rt).toContain(">%<");
    expect(rt).not.toContain(">/100<");
    expect(mc).toContain(">67<");
    expect(mc).toContain(">/100<");
  });
});
