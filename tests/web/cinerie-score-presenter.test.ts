/**
 * cinerie-score-presenter.test.ts — A regra de exibicao do Cinerie Score.
 *
 * A regra e uma so e e inegociavel: exibe se, e somente se, houver >= 2 fontes
 * CONTADAS. Este arquivo a prova nos DOIS sentidos, e prova tambem que as tres
 * ausencias possiveis nao colapsam num silencio unico.
 */

import { describe, expect, it } from "vitest";

import type { CountedSource } from "@screena/cinerie-score";
import {
  decideCinerieScore,
  type CinerieScoreInputView,
} from "../../apps/web/src/lib/cinerie-score-presenter";

function fonte(source: string, normalized: number, group: "critics" | "audience", weight = 1): CountedSource {
  return { source, normalized, group, weight };
}

const IMDB = fonte("imdb", 84, "audience", 3);
const TMDB = fonte("tmdb", 72, "audience", 1);
const RT = fonte("rotten_tomatoes", 92, "critics");
const MC = fonte("metacritic", 78, "critics");

function entrada(over: Partial<CinerieScoreInputView> = {}): CinerieScoreInputView {
  return { authorized: true, value: 85, counted: [IMDB, RT], ...over };
}

describe("a licenca vem ANTES de tudo", () => {
  it("NEGATIVO: sem autorizacao para derivar, nao renderiza — nem com 4 fontes", () => {
    // O estado de HOJE. A formula existe, esta registrada e testada; o que falta
    // e permissao das FONTES para derivar (OMDb e TMDB proibem nos termos).
    // Autorizacao do dono nao cria direito que a fonte nao deu.
    const d = decideCinerieScore(entrada({ authorized: false, counted: [IMDB, TMDB, RT, MC] }));
    expect(d.rendered).toBe(false);
    if (d.rendered) throw new Error("nao deveria renderizar");
    expect(d.reason).toBe("no_approved_formula");
  });

  it("CONTROLE POSITIVO: com autorizacao e 2 fontes, renderiza", () => {
    // Sem isto, um `decideCinerieScore` que sempre recusasse passaria em todos
    // os negativos acima e abaixo.
    const d = decideCinerieScore(entrada());
    expect(d.rendered).toBe(true);
  });
});

describe("o piso de duas fontes — nos dois sentidos", () => {
  it("POSITIVO: 2 fontes renderizam", () => {
    const d = decideCinerieScore(entrada({ counted: [IMDB, RT] }));
    expect(d.rendered).toBe(true);
    if (!d.rendered) throw new Error("deveria renderizar");
    expect(d.view.sources).toEqual(["imdb", "rotten_tomatoes"]);
  });

  it("POSITIVO: 3 e 4 fontes tambem renderizam", () => {
    for (const counted of [[IMDB, RT, MC], [IMDB, TMDB, RT, MC]]) {
      expect(decideCinerieScore(entrada({ counted })).rendered, `${counted.length} fontes`).toBe(true);
    }
  });

  it("NEGATIVO: 1 fonte NAO renderiza, e o motivo diz POR QUE", () => {
    const d = decideCinerieScore(entrada({ counted: [IMDB] }));
    expect(d.rendered).toBe(false);
    if (d.rendered) throw new Error("nao deveria renderizar");
    expect(d.reason).toBe("single_source_insufficient");
  });

  it("NEGATIVO: 1 fonte nao renderiza NEM com nota alta", () => {
    for (const value of [10, 50, 99, 100]) {
      const d = decideCinerieScore(entrada({ counted: [RT], value }));
      expect(d.rendered, `valor ${value}`).toBe(false);
    }
  });

  it("NEGATIVO: 0 fontes -> `no_rating_at_all`, NAO `single_source_insufficient`", () => {
    // As duas ausencias pedem acoes diferentes ao operador. Colapsa-las faria
    // ele procurar a segunda fonte de um titulo que nao tem a primeira.
    const d = decideCinerieScore(entrada({ counted: [], value: null }));
    expect(d.rendered).toBe(false);
    if (d.rendered) throw new Error("nao deveria renderizar");
    expect(d.reason).toBe("no_rating_at_all");
  });

  it("os TRES motivos sao distintos entre si", () => {
    const motivos = [
      decideCinerieScore(entrada({ authorized: false })),
      decideCinerieScore(entrada({ counted: [IMDB] })),
      decideCinerieScore(entrada({ counted: [], value: null })),
    ].map((d) => (d.rendered ? "renderizou" : d.reason));
    expect(new Set(motivos).size).toBe(3);
  });
});

describe("a linha de composicao NOMEIA as fontes", () => {
  it("diz de quantas fontes e quais, na ordem", () => {
    const d = decideCinerieScore(entrada({ counted: [IMDB, RT, MC] }));
    if (!d.rendered) throw new Error("deveria renderizar");
    expect(d.view.compositionLine).toBe(
      "Composto de 3 fontes: IMDb, Rotten Tomatoes e Metacritic.",
    );
  });

  it("duas fontes usam `e`, sem virgula sobrando", () => {
    const d = decideCinerieScore(entrada({ counted: [IMDB, TMDB] }));
    if (!d.rendered) throw new Error("deveria renderizar");
    expect(d.view.compositionLine).toBe("Composto de 2 fontes: IMDb e TMDB.");
  });

  it("NEGATIVO: fonte sem rotulo declarado nao compoe em silencio", () => {
    // Uma fonte que nao pode ser NOMEADA na linha tambem nao pode entrar no
    // numero: o leitor veria um "composto de 2 fontes" citando uma so.
    const d = decideCinerieScore(entrada({ counted: [IMDB, fonte("letterboxd", 80, "audience")] }));
    expect(d.rendered).toBe(false);
    if (d.rendered) throw new Error("nao deveria renderizar");
    expect(d.reason).toBe("single_source_insufficient");
  });
});

describe("o numero e um INTEIRO 0-100, e nada mais", () => {
  it("arredonda e mantem a escala", () => {
    const d = decideCinerieScore(entrada({ value: 84.6 }));
    if (!d.rendered) throw new Error("deveria renderizar");
    expect(d.view.value).toBe(85);
    expect(d.view.scale).toBe(100);
  });

  it("valor invalido nao vira numero na tela", () => {
    for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = decideCinerieScore(entrada({ value }));
      expect(d.rendered, `valor ${String(value)}`).toBe(false);
    }
  });

  it("NEGATIVO: a view nao carrega escala, icone ou cor de outra marca", () => {
    // "Nunca estrela, tomate, ou cor que imite a escala de outra marca." A view
    // e um conjunto FECHADO de campos — um campo de icone teria de ser
    // adicionado aqui, e este teste reprova quando alguem o fizer sem pensar.
    const d = decideCinerieScore(entrada());
    if (!d.rendered) throw new Error("deveria renderizar");
    expect(Object.keys(d.view).sort()).toEqual([
      "compositionLine",
      "scale",
      "sources",
      "value",
    ]);
    // O que e proibido e o ROTULO DE METRICA de outra marca, nao o NOME da
    // fonte. A primeira versao deste teste barrava "tomat" e reprovou por
    // encontrar "Rotten Tomatoes" na linha de composicao — que e exatamente o
    // que a linha DEVE dizer. Nomear a fonte e obrigatorio; vestir a marca dela
    // e que e proibido.
    const serializado = JSON.stringify(d.view).toLowerCase();
    for (const proibido of ["tomatometer", "popcornmeter", "metascore", "estrela", "★", "🍅"]) {
      expect(serializado, proibido).not.toContain(proibido);
    }
  });
});
