/**
 * trailer-gate-and-embed.test.ts — As duas metades PURAS do trailer:
 * a política da URL do player e o gate de licença que decide se existe player.
 *
 * O gate é testado CONDIÇÃO POR CONDIÇÃO, e não só pelo resultado final. Um
 * gate de cinco checagens verificado apenas por "linha boa passa, linha ruim
 * não" fica verde com quatro delas apagadas — foi assim que a coluna
 * `display_allowed` já apareceu neste repositório como se fosse o gate inteiro
 * quando não era.
 */

import { describe, expect, it } from "vitest";

import {
  isDisplayableTrailerRow,
  pickTrailer,
  type TrailerRow,
} from "../../apps/web/src/lib/trailer-presenter";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeWatchUrl,
  isYouTubeVideoId,
} from "../../apps/web/src/lib/youtube-embed";

const ID = "dQw4w9WgXcQ"; // 11 caracteres — id válido de referência.

function row(overrides: Partial<TrailerRow> = {}): TrailerRow {
  return {
    site: "YouTube",
    videoKey: ID,
    name: "Trailer oficial",
    videoType: "Trailer",
    official: true,
    languageCode: "pt-BR",
    publishedAt: new Date("2026-07-01T00:00:00.000Z"),
    displayAllowed: true,
    licenseStatus: "official",
    ...overrides,
  };
}

describe("a URL do player: nocookie, sem query, id de 11 caracteres", () => {
  it("CONTROLE POSITIVO: id válido vira URL de embed", () => {
    expect(buildYouTubeEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
  });

  it("é SEMPRE o domínio nocookie, nunca youtube.com", () => {
    const url = buildYouTubeEmbedUrl(ID) ?? "";
    expect(url.startsWith("https://www.youtube-nocookie.com/")).toBe(true);
    expect(url).not.toContain("//www.youtube.com");
  });

  it("NEGATIVO — a URL do player não tem NENHUM parâmetro", () => {
    // Afirmar "nenhum ?" é mais forte que listar parâmetros proibidos: um
    // parâmetro novo entra sem ninguém lembrar de acrescentá-lo à lista.
    const url = buildYouTubeEmbedUrl(ID) ?? "";
    expect(url).not.toContain("?");
    expect(url).not.toContain("&");
    expect(url.toLowerCase()).not.toContain("autoplay");
  });

  it("fail-closed: qualquer coisa que não seja um id de 11 caracteres vira null", () => {
    for (const invalido of [
      null,
      undefined,
      "",
      "curto",
      "dQw4w9WgXcQextra",
      "dQw4w9WgXc/", // barra viraria caminho na URL
      "dQw4w9WgXc.", // ponto fora do alfabeto seguro
      "../../etc/pw",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(buildYouTubeEmbedUrl(invalido), String(invalido)).toBeNull();
      expect(isYouTubeVideoId(invalido as string), String(invalido)).toBe(false);
    }
  });

  it("o link de escape usa o domínio público (é navegação, não recurso embutido)", () => {
    expect(buildYouTubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(buildYouTubeWatchUrl("curto")).toBeNull();
  });
});

describe("gate de exibição do trailer — cada condição sozinha", () => {
  it("CONTROLE POSITIVO: a linha de referência passa", () => {
    // Sem isto, um gate quebrado que reprovasse tudo passaria em todo o resto.
    expect(isDisplayableTrailerRow(row())).toBe(true);
    expect(pickTrailer([row()])).not.toBeNull();
  });

  it("display_allowed=false reprova (a coluna-mestra)", () => {
    expect(isDisplayableTrailerRow(row({ displayAllowed: false }))).toBe(false);
  });

  it("licença unknown ou blocked reprova (invariante 6)", () => {
    expect(isDisplayableTrailerRow(row({ licenseStatus: "unknown" }))).toBe(false);
    expect(isDisplayableTrailerRow(row({ licenseStatus: "blocked" }))).toBe(false);
    // E as permitidas continuam permitidas.
    for (const ok of ["official", "licensed", "third_party"]) {
      expect(isDisplayableTrailerRow(row({ licenseStatus: ok })), ok).toBe(true);
    }
  });

  it("site diferente de YouTube reprova (é o único player que carregamos)", () => {
    for (const site of ["Vimeo", "youtube", "YouTube Shorts", ""]) {
      expect(isDisplayableTrailerRow(row({ site })), site).toBe(false);
    }
  });

  it("tipo que não é trailer reprova — botão de trailer não abre bastidor", () => {
    for (const tipo of ["Clip", "Featurette", "Behind the Scenes", "Bloopers", null]) {
      expect(isDisplayableTrailerRow(row({ videoType: tipo })), String(tipo)).toBe(false);
    }
    expect(isDisplayableTrailerRow(row({ videoType: "Teaser" }))).toBe(true);
  });

  it("chave malformada reprova (fail-closed, não vira caminho na URL)", () => {
    expect(isDisplayableTrailerRow(row({ videoKey: "curto" }))).toBe(false);
    expect(isDisplayableTrailerRow(row({ videoKey: "dQw4w9WgXc/" }))).toBe(false);
  });

  it("ESTADO DE HOJE: a linha como a ingestão a cria não passa", () => {
    // `tmdb_videos` nasce display_allowed=false + license unknown. Enquanto a
    // decisão de licença de VÍDEO não existir, isto é o que produção devolve.
    const comoNasce = row({ displayAllowed: false, licenseStatus: "unknown" });
    expect(isDisplayableTrailerRow(comoNasce)).toBe(false);
    expect(pickTrailer([comoNasce])).toBeNull();
  });
});

describe("pickTrailer — escolha determinística", () => {
  it("Trailer vence Teaser", () => {
    const escolhido = pickTrailer([
      row({ videoKey: "teaserAAAAA", videoType: "Teaser" }),
      row({ videoKey: "trailerBBBB", videoType: "Trailer" }),
    ]);
    expect(escolhido?.embedUrl).toContain("trailerBBBB");
  });

  it("oficial vence não-oficial (e `official: null` conta como não-oficial)", () => {
    const escolhido = pickTrailer([
      row({ videoKey: "naoOficialA", official: null }),
      row({ videoKey: "oficialBBBB", official: true }),
    ]);
    expect(escolhido?.embedUrl).toContain("oficialBBBB");
  });

  it("pt-BR vence inglês, que vence o resto (invariante 7)", () => {
    const escolhido = pickTrailer([
      row({ videoKey: "japonesAAAA", languageCode: "ja" }),
      row({ videoKey: "inglesBBBBB", languageCode: "en" }),
      row({ videoKey: "brasilCCCCC", languageCode: "pt-BR" }),
    ]);
    expect(escolhido?.embedUrl).toContain("brasilCCCCC");
  });

  it("com tudo empatado, o mais RECENTE vence", () => {
    const escolhido = pickTrailer([
      row({ videoKey: "antigoAAAAA", publishedAt: new Date("2026-01-01T00:00:00.000Z") }),
      row({ videoKey: "novoBBBBBBB", publishedAt: new Date("2026-07-01T00:00:00.000Z") }),
    ]);
    expect(escolhido?.embedUrl).toContain("novoBBBBBBB");
  });

  it("empate TOTAL desempata pela chave — a ordem do banco nunca decide", () => {
    const a = row({ videoKey: "aaaaaaaaaaa", publishedAt: null });
    const b = row({ videoKey: "bbbbbbbbbbb", publishedAt: null });
    expect(pickTrailer([a, b])?.embedUrl).toBe(pickTrailer([b, a])?.embedUrl);
    expect(pickTrailer([b, a])?.embedUrl).toContain("aaaaaaaaaaa");
  });

  it("lista vazia, ou toda reprovada, devolve null", () => {
    expect(pickTrailer([])).toBeNull();
    expect(pickTrailer([row({ displayAllowed: false }), row({ site: "Vimeo" })])).toBeNull();
  });

  it("o par embed/escape sai do MESMO vídeo", () => {
    const escolhido = pickTrailer([row({ videoKey: "mesmoIdAAAA" })]);
    expect(escolhido?.embedUrl).toBe("https://www.youtube-nocookie.com/embed/mesmoIdAAAA");
    expect(escolhido?.watchUrl).toBe("https://www.youtube.com/watch?v=mesmoIdAAAA");
  });
});
