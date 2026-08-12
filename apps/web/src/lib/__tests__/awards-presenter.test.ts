/**
 * awards-presenter.test.ts — Os formatos que a OMDb usa no campo `Awards`.
 *
 * Este parser existe antes da fonte: nenhuma pagina o consome hoje. Ele e
 * testado assim mesmo porque o dia em que a coluna existir, a interpretacao ja
 * estara provada — e porque a regra que mais importa aqui e a NEGATIVA: frase
 * que nao entendemos nao vira premio.
 */

import { describe, expect, it } from "vitest";

import { parseOmdbAwards } from "../awards-presenter";

describe("formatos reconhecidos", () => {
  it("com Oscar vencido: destaque verbatim + contagem agregada", () => {
    const parsed = parseOmdbAwards("Won 3 Oscars. 8 wins & 51 nominations total");
    expect(parsed).toEqual({
      recognized: true,
      view: {
        // VERBATIM: nao traduzimos o nome do premio.
        headline: "Won 3 Oscars",
        tally: { wins: 8, nominations: 51, label: "8 vitórias · 51 indicações" },
      },
    });
  });

  it("com indicacao ao Oscar: o mesmo, com o outro destaque", () => {
    const parsed = parseOmdbAwards("Nominated for 3 Oscars. 8 wins & 51 nominations total");
    expect(parsed.recognized && parsed.view.headline).toBe("Nominated for 3 Oscars");
    expect(parsed.recognized && parsed.view.tally.wins).toBe(8);
  });

  it("o numero do DESTAQUE nao e contado como vitoria agregada", () => {
    // "Won 3 Oscars" tem um 3 que NAO e "3 vitorias no total". Um parser que
    // varresse a frase inteira leria 3 e reportaria o numero errado.
    const parsed = parseOmdbAwards("Won 3 Oscars. 8 wins & 51 nominations total");
    expect(parsed.recognized && parsed.view.tally.wins).toBe(8);
    expect(parsed.recognized && parsed.view.tally.wins).not.toBe(3);
  });

  it("sem Oscar: so a contagem, sem destaque", () => {
    const parsed = parseOmdbAwards("12 wins & 30 nominations");
    expect(parsed).toEqual({
      recognized: true,
      view: {
        headline: null,
        tally: { wins: 12, nominations: 30, label: "12 vitórias · 30 indicações" },
      },
    });
  });

  it("singular sai no singular", () => {
    const parsed = parseOmdbAwards("1 win & 1 nomination");
    expect(parsed.recognized && parsed.view.tally.label).toBe("1 vitória · 1 indicação");
  });

  it("so vitorias, ou so indicacoes", () => {
    expect(parseOmdbAwards("2 wins").recognized && parseOmdbAwards("2 wins")).toMatchObject({
      view: { tally: { wins: 2, nominations: null, label: "2 vitórias" } },
    });
    const nomOnly = parseOmdbAwards("Nominated for 1 BAFTA Film Award. 3 nominations");
    expect(nomOnly.recognized && nomOnly.view.tally).toEqual({
      wins: null,
      nominations: 3,
      label: "3 indicações",
    });
  });

  it("premio que nao e Oscar mantem o proprio nome", () => {
    const parsed = parseOmdbAwards(
      "Won 2 Primetime Emmys. 15 wins & 40 nominations total",
    );
    expect(parsed.recognized && parsed.view.headline).toBe("Won 2 Primetime Emmys");
  });

  it("milhar em pt-BR", () => {
    const parsed = parseOmdbAwards("1234 wins & 5678 nominations");
    expect(parsed.recognized && parsed.view.tally.label).toBe(
      "1.234 vitórias · 5.678 indicações",
    );
  });
});

describe("recusa: frase que nao entendemos NAO vira premio", () => {
  it('"N/A" e ausencia declarada pela fonte, nao zero', () => {
    // "0 vitórias" seria uma afirmacao sobre o MUNDO que a fonte nao fez.
    expect(parseOmdbAwards("N/A")).toEqual({
      recognized: false,
      reason: "not_available",
      raw: "N/A",
    });
  });

  it("campo ausente, nulo ou vazio", () => {
    for (const input of [undefined, null, "", "   ", 42]) {
      expect(parseOmdbAwards(input)).toEqual({
        recognized: false,
        reason: "absent",
        raw: null,
      });
    }
  });

  it("formato desconhecido devolve o valor BRUTO para o chamador registrar", () => {
    // Nada falha em silencio: quem chamar loga este `raw` e o reconhecedor
    // pode ser estendido depois com evidencia, nunca com palpite.
    expect(parseOmdbAwards("Muitos prêmios importantes")).toEqual({
      recognized: false,
      reason: "unrecognized_format",
      raw: "Muitos prêmios importantes",
    });
  });
});
