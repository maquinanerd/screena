/**
 * Testes puros dos helpers de URL canonica do site publico (site.ts).
 *
 * Garantem que toda URL publica nasce no dominio canonico
 * https://thescreen.media, com barra final (trailingSlash do app), sem barra
 * duplicada, e que slug/path invalidos sao REJEITADOS (null) em vez de gerar
 * URL quebrada ou externa.
 */

import { describe, expect, it } from "vitest";

import {
  canonicalPublicUrl,
  detailPath,
  EXPLORE_PATH,
  HOME_PATH,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
  SITE_URL,
} from "../../apps/web/src/lib/site";

describe("site.ts — constantes de rota publica", () => {
  it("todas as rotas publicas sao pt-BR com barra final", () => {
    for (const path of [
      HOME_PATH,
      MOVIES_INDEX_PATH,
      SERIES_INDEX_PATH,
      PEOPLE_INDEX_PATH,
      NEWS_INDEX_PATH,
      EXPLORE_PATH,
    ]) {
      expect(path.startsWith("/pt/")).toBe(true);
      expect(path.endsWith("/")).toBe(true);
    }
  });

  it("dominio canonico e thescreen.media, sem barra final", () => {
    expect(SITE_URL).toBe("https://thescreen.media");
  });
});

describe("canonicalPublicUrl", () => {
  it("gera URL absoluta no dominio canonico com barra final", () => {
    expect(canonicalPublicUrl("/pt/filmes/")).toBe(
      "https://thescreen.media/pt/filmes/",
    );
  });

  it("garante barra final quando ausente", () => {
    expect(canonicalPublicUrl("/pt/filmes")).toBe(
      "https://thescreen.media/pt/filmes/",
    );
  });

  it("remove barras duplicadas internas", () => {
    expect(canonicalPublicUrl("/pt//filmes///slug/")).toBe(
      "https://thescreen.media/pt/filmes/slug/",
    );
  });

  it("rejeita path externo com esquema", () => {
    expect(canonicalPublicUrl("https://evil.example/pt/")).toBeNull();
  });

  it("rejeita path protocolo-relativo (//host)", () => {
    expect(canonicalPublicUrl("//evil.example/pt/")).toBeNull();
  });

  it("rejeita path que nao comeca em /", () => {
    expect(canonicalPublicUrl("pt/filmes/")).toBeNull();
  });

  it("rejeita path vazio/whitespace", () => {
    expect(canonicalPublicUrl("")).toBeNull();
    expect(canonicalPublicUrl("   ")).toBeNull();
  });
});

describe("detailPath", () => {
  it("monta caminho de detalhe com barra final", () => {
    expect(detailPath(MOVIES_INDEX_PATH, "oppenheimer")).toBe(
      "/pt/filmes/oppenheimer/",
    );
  });

  it("rejeita slug null", () => {
    expect(detailPath(MOVIES_INDEX_PATH, null)).toBeNull();
  });

  it("rejeita slug vazio/whitespace", () => {
    expect(detailPath(MOVIES_INDEX_PATH, "")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "   ")).toBeNull();
  });

  it("rejeita slug com caracteres de path/URL", () => {
    expect(detailPath(MOVIES_INDEX_PATH, "a/b")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "a\\b")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "http://x")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "a?b")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "a#b")).toBeNull();
    expect(detailPath(MOVIES_INDEX_PATH, "..")).toBeNull();
  });
});
