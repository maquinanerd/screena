/**
 * Testes puros do presenter de notas externas (invariantes 1, 2 e 6).
 *
 * Garantem: cada nota fica na ESCALA DA PROPRIA FONTE (IMDb 10, Rotten Tomatoes
 * 100) e nunca e reescalada/convertida; critica e publico nunca se fundem;
 * ATRIBUICAO obrigatoria (nota sem credito nao e exibida); o fornecedor tecnico
 * jamais vira fonte; ordem estavel; e `null` quando nada sobrevive — caso em que
 * a pagina simplesmente omite o painel.
 */

import { describe, expect, it } from "vitest";

import type { PublicExternalRating, RatingsPayload } from "@screena/public-contracts";

import {
  buildRatingsView,
  formatRatingCount,
  formatRatingDate,
  formatRatingNumber,
} from "../../apps/web/src/lib/ratings-presenter";

function rating(overrides: Partial<PublicExternalRating> = {}): PublicExternalRating {
  return {
    sourceKey: "imdb",
    sourceLabel: "IMDb",
    scoreType: "audience",
    value: 8.4,
    best: 10,
    count: 1234,
    label: "IMDb Rating",
    updatedAt: "2026-06-20T00:00:00.000Z",
    attribution: { text: "Nota fornecida por IMDb", url: "https://www.imdb.com/title/tt1/" },
    ...overrides,
  } as PublicExternalRating;
}

function payload(ratings: PublicExternalRating[]): RatingsPayload {
  return {
    entity: { kind: "movie", id: "1", title: "Filme", canonicalUrl: null },
    ratings,
  };
}

describe("formatadores puros", () => {
  it("formata numero em pt-BR sem arredondar a fonte", () => {
    expect(formatRatingNumber(8.4)).toBe("8,4");
    expect(formatRatingNumber(92)).toBe("92");
    expect(formatRatingNumber(4.25)).toBe("4,25");
  });

  it("formata contagem com separador de milhar", () => {
    expect(formatRatingCount(1234)).toBe("1.234");
    expect(formatRatingCount(999)).toBe("999");
    expect(formatRatingCount(1234567)).toBe("1.234.567");
  });

  it("formata data ISO -> DD/MM/AAAA e recusa invalido", () => {
    expect(formatRatingDate("2026-06-20T00:00:00Z")).toBe("20/06/2026");
    expect(formatRatingDate("20/06/2026")).toBeNull();
    expect(formatRatingDate(null)).toBeNull();
  });
});

describe("buildRatingsView — escalas por fonte (invariante 1)", () => {
  /**
   * ATUALIZADO com a correcao do sufixo por fonte.
   *
   * Este teste afirmava `rotten_tomatoes:92/100` — e estava errado, no mesmo
   * lugar em que a pagina estava errada: o Tomatometer e PROPORCAO de criticas
   * positivas ("92% aprovaram"), nao 92 pontos numa regua de 100. A ultima
   * assercao chegava a exigir "/" em toda `scoreLabel`, o que TRAVAVA a forma
   * certa: com ela no lugar, escrever "92%" quebrava a suite.
   *
   * A REGRA que este teste defende continua identica e continua valendo: nada
   * e reescalado entre fontes, e o 8,4 do IMDb jamais vira 84 de coisa nenhuma.
   * O que muda e como cada fonte escreve a propria medida.
   * Ver `tests/governance/rating-suffix-by-source.test.ts`.
   */
  it("IMDb 8,4/10 e Rotten Tomatoes 92% convivem SEM normalizacao", () => {
    const view = buildRatingsView(
      payload([
        rating(),
        rating({
          sourceKey: "rotten_tomatoes",
          sourceLabel: "Rotten Tomatoes",
          scoreType: "critics",
          value: 92,
          best: 100,
          label: "Tomatometer",
          attribution: {
            text: "Nota fornecida por Rotten Tomatoes",
            url: "https://www.rottentomatoes.com/m/x",
          },
        }),
      ]),
    );

    const scores = view!.items.map((i) => `${i.sourceKey}:${i.scoreLabel}`);
    expect(scores).toContain("imdb:8,4/10");
    expect(scores).toContain("rotten_tomatoes:92%");
    // O 8,4 do IMDb NUNCA vira 84/100 nem 84% para "comparar" com o Tomatometer.
    expect(scores).not.toContain("imdb:84/100");
    expect(scores).not.toContain("imdb:84%");
    // E o Tomatometer nunca volta a ser apresentado como nota numa regua de 100.
    expect(scores).not.toContain("rotten_tomatoes:92/100");
    // O valor nunca aparece sem a MEDIDA ao lado — nunca um numero solto.
    for (const item of view!.items) {
      expect(item.valueSuffix).not.toBe("");
      expect(item.scoreLabel).toBe(`${item.valueLabel}${item.valueSuffix}`);
    }
  });

  it("nao emite nota agregada propria (nenhum 'Cinerie Score')", () => {
    const view = buildRatingsView(
      payload([rating(), rating({ sourceKey: "metacritic", sourceLabel: "Metacritic", value: 78, best: 100, label: "Metascore", scoreType: "critics", attribution: { text: "Nota fornecida por Metacritic", url: "https://www.metacritic.com/m/x" } })]),
    );
    // Duas notas entram, duas notas saem: nada de media/sintese.
    expect(view!.items).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/cinerie[ _-]?score/i);
  });
});

describe("buildRatingsView — critica != publico (invariante 1)", () => {
  it("Tomatometer e Popcornmeter da MESMA fonte nao se fundem", () => {
    const view = buildRatingsView(
      payload([
        rating({
          sourceKey: "rotten_tomatoes",
          sourceLabel: "Rotten Tomatoes",
          scoreType: "critics",
          value: 92,
          best: 100,
          label: "Tomatometer",
          attribution: { text: "Nota fornecida por Rotten Tomatoes", url: "https://rt/x" },
        }),
        rating({
          sourceKey: "rotten_tomatoes",
          sourceLabel: "Rotten Tomatoes",
          scoreType: "audience",
          value: 71,
          best: 100,
          label: "Popcornmeter",
          attribution: { text: "Nota fornecida por Rotten Tomatoes", url: "https://rt/x" },
        }),
      ]),
    );

    expect(view!.items).toHaveLength(2);
    const byType = Object.fromEntries(view!.items.map((i) => [i.scoreType, i]));
    expect(byType.critics!.metricLabel).toBe("Tomatometer");
    expect(byType.critics!.scoreTypeLabel).toBe("Crítica");
    expect(byType.audience!.metricLabel).toBe("Popcornmeter");
    expect(byType.audience!.scoreTypeLabel).toBe("Público");
  });

  it("scoreType desconhecido e descartado (nao vira rotulo inventado)", () => {
    const view = buildRatingsView(
      payload([rating({ scoreType: "vibes" as PublicExternalRating["scoreType"] })]),
    );
    expect(view).toBeNull();
  });
});

/**
 * REESCRITO em 2026-08-13. Este bloco se chamava "atribuicao obrigatoria
 * (invariante 6)" e exigia que o presenter DESCARTASSE a nota sem credito.
 *
 * A invariante 6 nao mudou: dado sem licenca nao aparece. O que mudou foi o
 * endereco do CREDITO — por decisao do proprietario ele vive no rodape global, e
 * o rodape o deriva da LICENCA da fonte, nao da linha. Entao o presenter deixou
 * de recusar a linha, e passou apenas a PRESERVAR o que ela carrega.
 *
 * A garantia de presenca do credito: `footer-credits.test.tsx`.
 */
describe("buildRatingsView — atribuicao PRESERVADA (o credito mora no rodape)", () => {
  it("nota sem credito nao e mais descartada, e a ausencia vira null explicito", () => {
    const semObjeto = buildRatingsView(payload([rating({ attribution: null })]));
    expect(semObjeto).not.toBeNull();
    expect(semObjeto!.items[0]!.attribution).toEqual({ text: null, url: null });

    // Espaco em branco nao vira credito de mentira: normaliza para null.
    const soEspacos = buildRatingsView(
      payload([rating({ attribution: { text: "  ", url: null } })]),
    );
    expect(soEspacos).not.toBeNull();
    expect(soEspacos!.items[0]!.attribution.text).toBeNull();
  });

  it("exibe credito sem link quando a fonte nao registrou linkback", () => {
    const view = buildRatingsView(
      payload([rating({ attribution: { text: "Nota fornecida por IMDb", url: null } })]),
    );
    expect(view!.items[0]!.attribution).toEqual({
      text: "Nota fornecida por IMDb",
      url: null,
    });
  });

  it("credita a FONTE, nunca o fornecedor tecnico (invariante 2)", () => {
    const view = buildRatingsView(payload([rating()]));
    const serialized = JSON.stringify(view);
    expect(view!.items[0]!.attribution.text).toBe("Nota fornecida por IMDb");
    expect(serialized).not.toMatch(/rapidapi/i);
    expect(serialized).not.toMatch(/film[ _-]?show[ _-]?ratings/i);
  });
});

describe("buildRatingsView — dados invalidos e vazio", () => {
  it("descarta nota com escala invalida (numero sem escala confiavel)", () => {
    expect(buildRatingsView(payload([rating({ best: 0 })]))).toBeNull();
    expect(buildRatingsView(payload([rating({ best: Number.NaN })]))).toBeNull();
    expect(buildRatingsView(payload([rating({ value: Number.NaN })]))).toBeNull();
  });

  it("omite contagem quando o upstream nao informa (nunca zero fabricado)", () => {
    const view = buildRatingsView(payload([rating({ count: null })]));
    expect(view!.items[0]!.countLabel).toBeNull();
  });

  it("retorna null sem nenhuma nota — a pagina omite o painel", () => {
    expect(buildRatingsView(payload([]))).toBeNull();
  });

  it("deriva o carimbo pelo updatedAt mais recente", () => {
    const view = buildRatingsView(
      payload([
        rating({ updatedAt: "2026-05-01T00:00:00Z" }),
        rating({
          sourceKey: "metacritic",
          sourceLabel: "Metacritic",
          scoreType: "critics",
          value: 78,
          best: 100,
          label: "Metascore",
          updatedAt: "2026-06-20T00:00:00Z",
          attribution: { text: "Nota fornecida por Metacritic", url: "https://mc/x" },
        }),
      ]),
    );
    expect(view!.updatedAtLabel).toBe("Atualizado em 20/06/2026");
  });
});

describe("buildRatingsView — ordem estavel", () => {
  it("ordena por fonte, depois natureza, depois metrica", () => {
    const view = buildRatingsView(
      payload([
        rating({
          sourceKey: "rotten_tomatoes",
          sourceLabel: "Rotten Tomatoes",
          scoreType: "critics",
          value: 92,
          best: 100,
          label: "Tomatometer",
          attribution: { text: "Nota fornecida por Rotten Tomatoes", url: "https://rt/x" },
        }),
        rating(),
      ]),
    );
    expect(view!.items.map((i) => i.sourceKey)).toEqual(["imdb", "rotten_tomatoes"]);
  });
});
