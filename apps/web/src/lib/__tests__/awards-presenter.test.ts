/**
 * awards-presenter.test.ts — A frase que vai para a tela.
 *
 * O reconhecimento em si e provado em
 * `packages/schemas/src/__tests__/omdb-awards.test.ts`. Aqui prova-se a UNICA
 * regra deste modulo, e ela e literal:
 *
 *   **a estrutura da frase e portugues; o NOME DO PREMIO nunca e traduzido.**
 *
 * As assercoes de nome sao comparacoes de string exata, de proposito. Um
 * `toContain("Oscar")` passaria com "Oscar de Melhor Filme" — e inventar nome
 * de premio e exatamente o defeito.
 */

import { describe, expect, it } from "vitest";

import { buildAwardsView, buildAwardsViewFromRaw } from "../awards-presenter";

describe("estrutura em pt-BR, nome do premio verbatim", () => {
  it("vitoria: Won -> Venceu, com o nome intacto", () => {
    expect(buildAwardsViewFromRaw("Won 4 Oscars. 160 wins & 220 nominations total")).toEqual({
      headline: "Venceu 4 Oscars",
      tally: { wins: 160, nominations: 220, label: "160 vitórias · 220 indicações" },
    });
  });

  it("singular real da amostra de producao (Interstellar)", () => {
    // "Won 1 Oscar" — o nome ja vem no singular da fonte, e sai assim.
    expect(buildAwardsViewFromRaw("Won 1 Oscar. 45 wins & 148 nominations total")).toEqual({
      headline: "Venceu 1 Oscar",
      tally: { wins: 45, nominations: 148, label: "45 vitórias · 148 indicações" },
    });
  });

  it("indicacao: Nominated for -> Concorreu a (verbo, nao adjetivo)", () => {
    // "Indicado"/"Indicada" concordaria em genero com filme/serie e erraria
    // metade do catalogo. "Concorreu a" nao flexiona.
    const view = buildAwardsViewFromRaw("Nominated for 3 Oscars. 8 wins & 51 nominations total");
    expect(view?.headline).toBe("Concorreu a 3 Oscars");
  });

  it("NOME NAO TRADUZIDO — assercao literal, premio a premio", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["Won 2 Primetime Emmys. 15 wins & 40 nominations total", "Venceu 2 Primetime Emmys"],
      ["Nominated for 1 BAFTA Film Award. 3 nominations", "Concorreu a 1 BAFTA Film Award"],
      ["Won 3 Golden Globes. 5 wins & 9 nominations total", "Venceu 3 Golden Globes"],
    ];
    for (const [raw, expected] of cases) {
      expect(buildAwardsViewFromRaw(raw)?.headline).toBe(expected);
    }
  });

  it("nada de traducao acidental: nenhuma palavra do nome vira portugues", () => {
    const headline = buildAwardsViewFromRaw("Won 2 Screen Actors Guild Awards. 4 wins")?.headline;
    expect(headline).toBe("Venceu 2 Screen Actors Guild Awards");
    // Controle negativo explicito: se alguem introduzir uma tabela de traducao,
    // e este e o texto que apareceria.
    expect(headline).not.toContain("Prêmios");
    expect(headline).not.toContain("Sindicato");
  });

  it("singular e plural da contagem agregada", () => {
    expect(buildAwardsViewFromRaw("1 win & 1 nomination")?.tally.label).toBe(
      "1 vitória · 1 indicação",
    );
    expect(buildAwardsViewFromRaw("2 wins & 2 nominations")?.tally.label).toBe(
      "2 vitórias · 2 indicações",
    );
  });

  it("so vitorias, ou so indicacoes", () => {
    expect(buildAwardsViewFromRaw("2 wins")?.tally.label).toBe("2 vitórias");
    expect(buildAwardsViewFromRaw("3 nominations")?.tally.label).toBe("3 indicações");
  });

  it("milhar em pt-BR", () => {
    expect(buildAwardsViewFromRaw("1234 wins & 5678 nominations")?.tally.label).toBe(
      "1.234 vitórias · 5.678 indicações",
    );
  });

  it("sem destaque: so a contagem, sem frase inventada", () => {
    expect(buildAwardsViewFromRaw("12 wins & 30 nominations")).toEqual({
      headline: null,
      tally: { wins: 12, nominations: 30, label: "12 vitórias · 30 indicações" },
    });
  });
});

describe("frase recusada nao vira faixa", () => {
  it.each([["N/A"], [""], ["Muitos prêmios importantes"], ["Won several Oscars"]])(
    "%s -> null",
    (raw) => {
      expect(buildAwardsViewFromRaw(raw)).toBeNull();
    },
  );

  it("ausente / nulo / tipo errado", () => {
    for (const raw of [undefined, null, 42]) {
      expect(buildAwardsViewFromRaw(raw)).toBeNull();
    }
  });
});

describe("buildAwardsView direto da estrutura (o caminho da leitura)", () => {
  it("compoe sem passar pelo literal", () => {
    expect(
      buildAwardsView({
        highlight: { outcome: "won", count: 7, awardName: "Oscars" },
        tally: { wins: 370, nominations: 378 },
      }),
    ).toEqual({
      headline: "Venceu 7 Oscars",
      tally: { wins: 370, nominations: 378, label: "370 vitórias · 378 indicações" },
    });
  });
});
