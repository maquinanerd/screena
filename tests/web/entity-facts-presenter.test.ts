/**
 * entity-facts-presenter.test.ts — A ficha técnica é lista de FATOS.
 *
 * O que se trava: campo sem dado não vira linha (nem "N/A"); orçamento só com
 * moeda E ano; classificação nunca de outro país com rótulo de brasileira (a
 * garantia é de construção: só a BR chega — provado no normalizador; aqui se
 * prova que a linha não inventa); direção/roteiro viram pessoas com link.
 */

import { describe, expect, it } from "vitest";

import {
  buildMovieFichaFacts,
  buildSeriesFichaFacts,
  formatBudget,
  formatDatePt,
  type MovieFichaInput,
} from "../../apps/web/src/lib/entity-facts-presenter";

const BASE: MovieFichaInput = {
  titleOriginal: "The Matrix",
  displayTitle: "Matrix",
  directors: [
    { name: "Lana Wachowski", href: "/pt/pessoas/lana-wachowski/" },
    { name: "Lilly Wachowski", href: null },
  ],
  writers: [{ name: "Lana Wachowski", href: "/pt/pessoas/lana-wachowski/" }],
  genres: ["Ação", "Ficção científica"],
  countries: ["Estados Unidos"],
  releaseDateBr: "1999-05-21",
  releaseDate: "1999-03-31",
  runtimeLabel: "2 h 16 min",
  statusLabel: "Lançado",
  originalLanguageLabel: "Inglês",
  certification: "14",
  companies: ["Warner Bros. Pictures"],
  budget: 63_000_000n,
  releaseYear: 1999,
};

describe("ficha de filme", () => {
  it("compõe as linhas do canônico, com direção/roteiro como PESSOAS", () => {
    const rows = buildMovieFichaFacts(BASE);
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual([
      "Título original",
      "Direção",
      "Roteiro",
      "Gêneros",
      "País de origem",
      "Estreia",
      "Duração",
      "Situação",
      "Idioma original",
      "Classificação",
      "Distribuição",
      "Orçamento",
    ]);
    const direcao = rows.find((r) => r.label === "Direção")!;
    expect("people" in direcao && direcao.people[0]?.href).toBe("/pt/pessoas/lana-wachowski/");
  });

  it("campo sem dado NÃO vira linha — nunca vazio nem N/A", () => {
    const rows = buildMovieFichaFacts({
      ...BASE,
      directors: [],
      writers: [],
      genres: [],
      countries: [],
      certification: null,
      companies: [],
      budget: null,
    });
    const labels = rows.map((r) => r.label);
    for (const ausente of ["Direção", "Roteiro", "Gêneros", "País de origem", "Classificação", "Distribuição", "Orçamento"]) {
      expect(labels).not.toContain(ausente);
    }
    for (const row of rows) {
      if ("value" in row) {
        expect(row.value.trim()).not.toBe("");
        expect(row.value).not.toMatch(/N\/A/i);
      }
    }
  });

  it("a ESTREIA prefere a regional BR; sem ela, a global", () => {
    expect(
      buildMovieFichaFacts(BASE).find((r) => r.label === "Estreia"),
    ).toEqual({ label: "Estreia", value: "21 de maio de 1999" });
    expect(
      buildMovieFichaFacts({ ...BASE, releaseDateBr: null }).find((r) => r.label === "Estreia"),
    ).toEqual({ label: "Estreia", value: "31 de março de 1999" });
  });

  it("título original só quando difere do exibido", () => {
    const iguais = buildMovieFichaFacts({ ...BASE, titleOriginal: "Matrix" });
    expect(iguais.map((r) => r.label)).not.toContain("Título original");
  });
});

describe("orçamento: moeda E ano, sempre juntos", () => {
  it("formata em dólar compacto com o ano da estreia", () => {
    expect(formatBudget(63_000_000n, 1999)).toBe("US$ 63 milhões (1999)");
    expect(formatBudget(1_500_000n, 2020)).toBe("US$ 1,5 milhão (2020)");
    expect(formatBudget(1_200_000_000n, 2024)).toBe("US$ 1,2 bilhão (2024)");
  });

  it("SEM ano de estreia, a linha não existe — valor sem os dois engana", () => {
    expect(formatBudget(63_000_000n, null)).toBeNull();
    const rows = buildMovieFichaFacts({ ...BASE, releaseYear: null });
    expect(rows.map((r) => r.label)).not.toContain("Orçamento");
  });

  it("orçamento nulo/zero não vira linha", () => {
    expect(formatBudget(null, 1999)).toBeNull();
    expect(formatBudget(0n, 1999)).toBeNull();
  });
});

describe("data pt-BR determinística", () => {
  it("converte ISO sem Intl", () => {
    expect(formatDatePt("2026-08-20")).toBe("20 de agosto de 2026");
    expect(formatDatePt("lixo")).toBeNull();
  });
});

describe("ficha de série (Detalhes)", () => {
  it("compõe com emissora e produção; sem dado, sem linha", () => {
    const rows = buildSeriesFichaFacts({
      titleOriginal: "Dark",
      displayTitle: "Dark",
      genres: ["Drama", "Mistério"],
      countries: ["Alemanha"],
      periodLabel: "2017–2020",
      statusLabel: "Encerrada",
      seasonsCountLabel: "3 temporadas",
      episodesCountLabel: "26 episódios",
      originalLanguageLabel: "Alemão",
      certification: "16",
      networks: ["Netflix"],
      companies: [],
    });
    const labels = rows.map((r) => r.label);
    expect(labels).toContain("Emissora");
    expect(labels).toContain("Classificação");
    expect(labels).not.toContain("Produção");
    expect(labels).not.toContain("Título original");
  });
});
