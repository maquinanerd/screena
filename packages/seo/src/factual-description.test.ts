/**
 * Descricao factual de quem nao tem sinopse.
 *
 * O que se trava: so fato que a pagina ja mostra, em ordem fixa; fato ausente
 * vira frase ausente; titulo sozinho nao vira descricao; e o corte de 160
 * caracteres leva a frase MENOS importante, nunca a do meio.
 */

import { describe, expect, it } from "vitest";

import {
  describeMovieFactually,
  describePersonFactually,
  describeSeriesFactually,
  joinWithE,
} from "./factual-description.js";
import { buildMetaDescription } from "./meta-description.js";

const ORIGEM = {
  title: "A Origem",
  year: 2010,
  genres: ["Ficção científica", "Ação", "Aventura"],
  directors: ["Christopher Nolan"],
  cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page", "Tom Hardy"],
  runtimeLabel: "2h 28min",
};

describe("enumeracao", () => {
  it("(1) a, a e b, a, b e c — e item vazio nao conta", () => {
    expect(joinWithE([])).toBe("");
    expect(joinWithE(["a"])).toBe("a");
    expect(joinWithE(["a", " ", "b"])).toBe("a e b");
    expect(joinWithE(["a", "b", "c"])).toBe("a, b e c");
  });
});

describe("filme", () => {
  it("(2) cada frase e um fato da pagina, na ordem de importancia", () => {
    expect(describeMovieFactually(ORIGEM)).toBe(
      "A Origem (2010) é um filme de ficção científica e ação. Direção: Christopher Nolan. " +
        "Elenco: Leonardo DiCaprio, Joseph Gordon-Levitt e Elliot Page. Duração: 2h 28min.",
    );
  });

  it("(3) o corte de 160 caracteres leva a ULTIMA frase, e fecha na frase", () => {
    expect(buildMetaDescription(describeMovieFactually(ORIGEM))).toBe(
      "A Origem (2010) é um filme de ficção científica e ação. Direção: Christopher Nolan. " +
        "Elenco: Leonardo DiCaprio, Joseph Gordon-Levitt e Elliot Page.",
    );
  });

  it("(4) fato ausente = frase ausente", () => {
    expect(
      describeMovieFactually({ ...ORIGEM, year: null, genres: [], cast: [], runtimeLabel: null }),
    ).toBe("A Origem é um filme. Direção: Christopher Nolan.");
  });

  it("(5) titulo sem nenhum fato alem dele nao vira descricao", () => {
    expect(
      describeMovieFactually({ ...ORIGEM, genres: [], directors: [], cast: [], runtimeLabel: " " }),
    ).toBeNull();
    expect(describeMovieFactually({ ...ORIGEM, title: "  " })).toBeNull();
  });

  it("(6) genero entra minusculo na frase, sem estragar sigla", () => {
    expect(describeMovieFactually({ ...ORIGEM, genres: ["Cinema TV"], directors: [], cast: [], runtimeLabel: null })).toBe(
      "A Origem (2010) é um filme de cinema TV.",
    );
    expect(describeMovieFactually({ ...ORIGEM, genres: ["TV"], directors: [], cast: [], runtimeLabel: null })).toBe(
      "A Origem (2010) é um filme de TV.",
    );
  });
});

describe("serie", () => {
  const RED_DWARF = {
    title: "Red Dwarf",
    periodLabel: "1988–2020",
    genres: ["Comédia", "Ficção científica"],
    seasonsCount: 13,
    cast: ["Craig Charles", "Chris Barrie", "Danny John-Jules"],
  };

  it("(7) periodo, genero, temporadas e elenco", () => {
    expect(describeSeriesFactually(RED_DWARF)).toBe(
      "Red Dwarf (1988–2020) é uma série de comédia e ficção científica, com 13 temporadas. " +
        "Elenco: Craig Charles, Chris Barrie e Danny John-Jules.",
    );
  });

  it("(8) uma temporada no singular; contagem invalida nao vira frase", () => {
    expect(describeSeriesFactually({ ...RED_DWARF, genres: [], cast: [], seasonsCount: 1 })).toBe(
      "Red Dwarf (1988–2020) é uma série, com 1 temporada.",
    );
    expect(describeSeriesFactually({ ...RED_DWARF, genres: [], cast: [], seasonsCount: 0 })).toBeNull();
  });
});

describe("pessoa", () => {
  const DICAPRIO = {
    name: "Leonardo DiCaprio",
    roleLabel: "Atuação",
    knownFor: [
      { title: "A Origem", year: 2010 },
      { title: "O Regresso", year: 2015 },
      { title: "Titanic", year: 1997 },
      { title: "Prenda-me Se For Capaz", year: 2002 },
    ],
    birthDateLabel: "11 de novembro de 1974",
    placeOfBirth: "Los Angeles, California, USA",
    deathDateLabel: null,
  };

  it("(9) funcao, trabalhos em destaque e nascimento — sem genero gramatical", () => {
    expect(describePersonFactually(DICAPRIO)).toBe(
      "Leonardo DiCaprio — atuação. Trabalhos em destaque: A Origem (2010), O Regresso (2015) e Titanic (1997). " +
        "Nascimento: 11 de novembro de 1974, Los Angeles, California, USA.",
    );
  });

  it("(10) so o local de nascimento, e o falecimento quando existe", () => {
    expect(
      describePersonFactually({
        ...DICAPRIO,
        roleLabel: null,
        knownFor: [],
        birthDateLabel: null,
        placeOfBirth: "Recife",
        deathDateLabel: "2 de maio de 2001",
      }),
    ).toBe("Leonardo DiCaprio. Natural de Recife. Falecimento: 2 de maio de 2001.");
  });

  it("(11) nome sem nenhum fato alem dele nao vira descricao", () => {
    expect(
      describePersonFactually({
        ...DICAPRIO,
        roleLabel: " ",
        knownFor: [],
        birthDateLabel: null,
        placeOfBirth: null,
      }),
    ).toBeNull();
  });
});
