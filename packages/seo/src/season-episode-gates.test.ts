/**
 * season-episode-gates.test.ts — os portões de CONTEÚDO de temporada e episódio.
 *
 * É a saída da válvula de 2026-08-27 por dado, pedida pelo dono em 22/09/2026.
 * Cada caso traz o par que prova que a regra olha o DADO: o mesmo registro sai
 * do índice sem o dado e volta com ele. Um banimento por tipo passaria no lado
 * "noindex" e reprovaria no lado "index".
 */

import { describe, expect, it } from "vitest";

import {
  MIN_SEASON_EPISODES_WITH_SYNOPSIS,
  MIN_SYNOPSIS_CHARS,
  SYNOPSIS_TRIM_CHARS,
  evaluateEpisodeQualityGate,
  evaluateSeasonQualityGate,
  hasRealSynopsis,
  synopsisLength,
  type EpisodeQualityGateInput,
  type SeasonQualityGateInput,
} from "./entity-quality-gates.js";

/** Uma sinopse com exatamente `n` caracteres. */
function sinopse(n: number): string {
  return "x".repeat(n);
}

describe("sinopse de verdade: a medida", () => {
  it("(1) o piso é 60 caracteres e a lista de trim é espaço, tab, CR e LF", () => {
    expect(MIN_SYNOPSIS_CHARS).toBe(60);
    expect(SYNOPSIS_TRIM_CHARS).toBe(" \t\r\n");
    expect(MIN_SEASON_EPISODES_WITH_SYNOPSIS).toBe(3);
  });

  it("(2) no piso passa; um caractere abaixo não", () => {
    expect(hasRealSynopsis(sinopse(60))).toBe(true);
    expect(hasRealSynopsis(sinopse(59))).toBe(false);
    expect(hasRealSynopsis(null)).toBe(false);
  });

  it("(3) branco nas pontas não conta — a MESMA lista que o BTRIM do SQL tira", () => {
    // O BTRIM sem segundo argumento só tira espaço; o SQL passa esta lista.
    expect(synopsisLength(`\n\t  ${sinopse(59)} \r\n`)).toBe(59);
    expect(hasRealSynopsis(`\n\n${sinopse(59)}\n\n`)).toBe(false);
  });

  it("(4) conta pontos de código, como char_length do PostgreSQL", () => {
    // Um emoji são DUAS unidades UTF-16 e UM caractere para o PostgreSQL. Se a
    // página contasse `length`, 30 emojis passariam aqui e reprovariam no SQL.
    const emojis = "🎬".repeat(30);
    expect(emojis.length).toBe(60);
    expect(synopsisLength(emojis)).toBe(30);
    expect(hasRealSynopsis(emojis)).toBe(false);
  });
});

describe("portão de temporada", () => {
  const base: SeasonQualityGateInput = {
    seriesInIndex: true,
    seasonNumber: 1,
    overview: null,
    episodesWithSynopsis: 0,
  };

  it("(5) sem sinopse e sem guia de episódios: fora — e volta com o dado", () => {
    const fora = evaluateSeasonQualityGate(base);
    expect(fora.passed).toBe(false);
    expect(fora.code).toBe("no_season_content");
    expect(evaluateSeasonQualityGate({ ...base, overview: sinopse(60) }).passed).toBe(true);
  });

  it("(6) sem sinopse própria, o guia de episódios sustenta a página a partir de três", () => {
    const tres = evaluateSeasonQualityGate({ ...base, episodesWithSynopsis: 3 });
    expect(tres.passed).toBe(true);
    expect(tres.code).toBe("episode_guide");
    expect(evaluateSeasonQualityGate({ ...base, episodesWithSynopsis: 2 }).passed).toBe(false);
  });

  it("(7) CONTROLE: sinopse curta não conta como sinopse", () => {
    expect(evaluateSeasonQualityGate({ ...base, overview: sinopse(59) }).code).toBe(
      "no_season_content",
    );
  });

  it("(8) série fora do índice leva a temporada junto, mesmo com conteúdo", () => {
    const v = evaluateSeasonQualityGate({ ...base, seriesInIndex: false, overview: sinopse(200) });
    expect(v.passed).toBe(false);
    expect(v.code).toBe("series_not_in_index");
  });

  it("(9) temporada 0 (especiais) não tem rota pública", () => {
    expect(evaluateSeasonQualityGate({ ...base, seasonNumber: 0, overview: sinopse(80) }).code).toBe(
      "invalid_season_number",
    );
  });
});

describe("portão de episódio", () => {
  const completo: EpisodeQualityGateInput = {
    seriesInIndex: true,
    overview: sinopse(80),
    stillPath: "/still.jpg",
  };

  it("(10) sinopse de verdade e imagem própria: indexa", () => {
    const v = evaluateEpisodeQualityGate(completo);
    expect(v.passed).toBe(true);
    expect(v.gate).toBe("episode");
  });

  it("(11) sem sinopse: fora — o caso de 33 de 38 episódios medidos — e volta com ela", () => {
    const fora = evaluateEpisodeQualityGate({ ...completo, overview: null });
    expect(fora.code).toBe("no_episode_synopsis");
    expect(evaluateEpisodeQualityGate({ ...completo, overview: sinopse(59) }).code).toBe(
      "no_episode_synopsis",
    );
    expect(evaluateEpisodeQualityGate({ ...completo, overview: sinopse(60) }).passed).toBe(true);
  });

  it("(12) sem imagem própria: fora", () => {
    expect(evaluateEpisodeQualityGate({ ...completo, stillPath: null }).code).toBe(
      "no_episode_still",
    );
    expect(evaluateEpisodeQualityGate({ ...completo, stillPath: "  " }).code).toBe(
      "no_episode_still",
    );
  });

  it("(13) série fora do índice leva o episódio junto", () => {
    expect(evaluateEpisodeQualityGate({ ...completo, seriesInIndex: false }).code).toBe(
      "series_not_in_index",
    );
  });
});
