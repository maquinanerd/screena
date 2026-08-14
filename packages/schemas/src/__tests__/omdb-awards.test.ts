/**
 * omdb-awards.test.ts — Os formatos que a OMDb usa no campo `Awards`.
 *
 * As cinco primeiras frases sao MEDIDAS em producao (SELECT sobre
 * `api_cache WHERE provider_api='omdb'`), nao inventadas. Sao o controle
 * POSITIVO desta suite: se o reconhecedor parar de ler o dado real que esta no
 * banco agora, estes casos caem.
 *
 * A regra que mais importa continua sendo a NEGATIVA: frase que nao
 * entendemos nao vira premio.
 */

import { describe, expect, it } from "vitest";

import { parseOmdbAwards } from "../omdb-awards.js";

/** Frases REAIS, copiadas da medicao em producao (2026-08-13). */
const PRODUCTION_SAMPLES = [
  ["Won 4 Oscars. 160 wins & 220 nominations total", "Oscars", 4, 160, 220],
  ["Won 1 Oscar. 45 wins & 148 nominations total", "Oscar", 1, 45, 148],
  ["Won 2 Oscars. 163 wins & 165 nominations total", "Oscars", 2, 163, 165],
  ["Won 7 Oscars. 370 wins & 378 nominations total", "Oscars", 7, 370, 378],
  ["Won 2 Oscars. 125 wins & 376 nominations total", "Oscars", 2, 125, 376],
] as const;

describe("as cinco frases reais de producao", () => {
  it.each(PRODUCTION_SAMPLES)(
    "%s",
    (raw, awardName, count, wins, nominations) => {
      expect(parseOmdbAwards(raw)).toEqual({
        recognized: true,
        awards: {
          highlight: { outcome: "won", count, awardName },
          tally: { wins, nominations },
        },
      });
    },
  );

  it("o numero do DESTAQUE nunca e contado como vitoria agregada", () => {
    // "Won 4 Oscars" tem um 4 que NAO e "4 vitorias no total". Um parser que
    // varresse a frase inteira leria 4 e reportaria o numero errado.
    const parsed = parseOmdbAwards("Won 4 Oscars. 160 wins & 220 nominations total");
    expect(parsed.recognized && parsed.awards.tally.wins).toBe(160);
    expect(parsed.recognized && parsed.awards.tally.wins).not.toBe(4);
  });
});

describe("outros formatos reconhecidos", () => {
  it("indicacao: o mesmo, com o outro desfecho", () => {
    expect(parseOmdbAwards("Nominated for 3 Oscars. 8 wins & 51 nominations total")).toEqual({
      recognized: true,
      awards: {
        highlight: { outcome: "nominated", count: 3, awardName: "Oscars" },
        tally: { wins: 8, nominations: 51 },
      },
    });
  });

  it("sem destaque: so a contagem", () => {
    expect(parseOmdbAwards("12 wins & 30 nominations")).toEqual({
      recognized: true,
      awards: { highlight: null, tally: { wins: 12, nominations: 30 } },
    });
  });

  it("singular nos dois campos", () => {
    expect(parseOmdbAwards("1 win & 1 nomination")).toEqual({
      recognized: true,
      awards: { highlight: null, tally: { wins: 1, nominations: 1 } },
    });
  });

  it("so vitorias, ou so indicacoes", () => {
    expect(parseOmdbAwards("2 wins").recognized && parseOmdbAwards("2 wins")).toMatchObject({
      awards: { tally: { wins: 2, nominations: null } },
    });
    const nomOnly = parseOmdbAwards("Nominated for 1 BAFTA Film Award. 3 nominations");
    expect(nomOnly.recognized && nomOnly.awards).toEqual({
      highlight: { outcome: "nominated", count: 1, awardName: "BAFTA Film Award" },
      tally: { wins: null, nominations: 3 },
    });
  });

  it("premio que nao e Oscar mantem o PROPRIO nome, palavra por palavra", () => {
    const parsed = parseOmdbAwards("Won 2 Primetime Emmys. 15 wins & 40 nominations total");
    // Assercao LITERAL: o nome atravessa o reconhecedor sem ser tocado.
    expect(parsed.recognized && parsed.awards.highlight?.awardName).toBe("Primetime Emmys");
  });

  it('a grafia antiga com "Another" tambem e lida', () => {
    // "Won 4 Oscars. Another 152 wins & 213 nominations." e formato historico da
    // OMDb e ainda aparece em payload guardado.
    expect(parseOmdbAwards("Won 4 Oscars. Another 152 wins & 213 nominations.")).toEqual({
      recognized: true,
      awards: {
        highlight: { outcome: "won", count: 4, awardName: "Oscars" },
        tally: { wins: 152, nominations: 213 },
      },
    });
  });
});

describe("recusa: frase que nao entendemos NAO vira premio", () => {
  it('"N/A" e ausencia declarada pela fonte, nao zero', () => {
    // "0 vitorias" seria uma afirmacao sobre o MUNDO que a fonte nao fez.
    expect(parseOmdbAwards("N/A")).toEqual({
      recognized: false,
      reason: "not_available",
      raw: "N/A",
    });
  });

  it("campo ausente, nulo, vazio ou de tipo errado", () => {
    for (const input of [undefined, null, "", "   ", 42, {}]) {
      expect(parseOmdbAwards(input)).toEqual({ recognized: false, reason: "absent", raw: null });
    }
  });

  it("formato desconhecido devolve o valor BRUTO para o chamador registrar", () => {
    expect(parseOmdbAwards("Muitos prêmios importantes")).toEqual({
      recognized: false,
      reason: "unrecognized_format",
      raw: "Muitos prêmios importantes",
    });
  });

  it("frase LIDA PELA METADE e recusada INTEIRA, com o bruto", () => {
    // O defeito que este caso existe para impedir: ler "Won 4 Oscars. 160 wins
    // & 220 nominations" e jogar fora o resto em silencio. Metade de um fato
    // exibida como se fosse o fato inteiro e pior que bloco ausente.
    const raw = "Won 4 Oscars. 160 wins & 220 nominations total. Also disqualified in 1972";
    expect(parseOmdbAwards(raw)).toEqual({
      recognized: false,
      reason: "unrecognized_format",
      raw,
    });
  });

  it("destaque com verbo conhecido mas forma desconhecida NAO passa cru", () => {
    // Antes desta versao, "Won several Oscars" saia VERBATIM para a tela de um
    // site em portugues. Agora ele e recusado com o bruto, para o reconhecedor
    // ser estendido depois com evidencia.
    expect(parseOmdbAwards("Won several Oscars")).toEqual({
      recognized: false,
      reason: "unrecognized_format",
      raw: "Won several Oscars",
    });
  });
});
