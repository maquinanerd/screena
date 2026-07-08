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
  configuredSiteUrl,
  detailPath,
  EXPLORE_PATH,
  HOME_PATH,
  isOfficialIndexableEnvironment,
  LOCAL_SITE_URL,
  MOVIES_INDEX_PATH,
  NEWS_INDEX_PATH,
  normalizeSiteOrigin,
  OFFICIAL_SITE_URL,
  PEOPLE_INDEX_PATH,
  PUBLIC_INDEXING_ENABLED_ENV,
  PUBLIC_SITE_URL_ENV,
  resolveSiteUrl,
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

  it("SITE_URL tem formato de origin publico absoluto, sem barra final", () => {
    const url = new URL(SITE_URL);
    expect(["https:", "http:"]).toContain(url.protocol);
    expect(url.origin).toBe(SITE_URL);
    expect(url.pathname).toBe("/");
  });
});

describe("site origin por env", () => {
  it("documenta as envs canonicas de origem publica e opt-in de indexacao", () => {
    expect(PUBLIC_SITE_URL_ENV).toBe("THE_SCREEN_PUBLIC_SITE_URL");
    expect(PUBLIC_INDEXING_ENABLED_ENV).toBe(
      "THE_SCREEN_PUBLIC_INDEXING_ENABLED",
    );
  });

  it("normaliza origin http/https sem barra final", () => {
    expect(normalizeSiteOrigin("https://THESCREEN.MEDIA/")).toBe(
      OFFICIAL_SITE_URL,
    );
    expect(normalizeSiteOrigin("http://localhost:3000/")).toBe(LOCAL_SITE_URL);
  });

  it("rejeita origin com path, query, hash, credencial ou protocolo invalido", () => {
    expect(normalizeSiteOrigin("https://thescreen.media/pt/")).toBeNull();
    expect(normalizeSiteOrigin("https://thescreen.media/?x=1")).toBeNull();
    expect(normalizeSiteOrigin("https://thescreen.media/#x")).toBeNull();
    expect(normalizeSiteOrigin("https://u:p@thescreen.media")).toBeNull();
    expect(normalizeSiteOrigin("ftp://thescreen.media")).toBeNull();
  });

  it("resolve origem configurada por env e cai no dominio oficial como fallback", () => {
    expect(
      configuredSiteUrl({
        THE_SCREEN_PUBLIC_SITE_URL: "https://screen-staging.example.com/",
      }),
    ).toBe("https://screen-staging.example.com");
    expect(
      resolveSiteUrl({
        THE_SCREEN_PUBLIC_SITE_URL: "https://screen-staging.example.com/",
      }),
    ).toBe("https://screen-staging.example.com");
    expect(resolveSiteUrl({})).toBe(OFFICIAL_SITE_URL);
  });

  it("so considera indexavel a producao oficial explicitamente configurada", () => {
    expect(
      isOfficialIndexableEnvironment({
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "production",
      }),
    ).toBe(true);
    expect(
      isOfficialIndexableEnvironment({
        THE_SCREEN_PUBLIC_SITE_URL: LOCAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "development",
      }),
    ).toBe(false);
    expect(
      isOfficialIndexableEnvironment({
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "1",
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isOfficialIndexableEnvironment({
        THE_SCREEN_PUBLIC_SITE_URL: OFFICIAL_SITE_URL,
        THE_SCREEN_PUBLIC_INDEXING_ENABLED: "0",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(isOfficialIndexableEnvironment({ NODE_ENV: "production" })).toBe(
      false,
    );
  });
});

describe("canonicalPublicUrl", () => {
  it("gera URL absoluta no dominio canonico com barra final", () => {
    expect(canonicalPublicUrl("/pt/filmes/")).toBe(
      `${OFFICIAL_SITE_URL}/pt/filmes/`,
    );
  });

  it("garante barra final quando ausente", () => {
    expect(canonicalPublicUrl("/pt/filmes")).toBe(
      `${OFFICIAL_SITE_URL}/pt/filmes/`,
    );
  });

  it("remove barras duplicadas internas", () => {
    expect(canonicalPublicUrl("/pt//filmes///slug/")).toBe(
      `${OFFICIAL_SITE_URL}/pt/filmes/slug/`,
    );
  });

  it("usa a origem publica configurada, sem forcar producao em staging/dev", () => {
    expect(
      canonicalPublicUrl("/pt/filmes/", "https://screen-staging.example.com/"),
    ).toBe("https://screen-staging.example.com/pt/filmes/");
    expect(canonicalPublicUrl("/pt/filmes/", LOCAL_SITE_URL)).toBe(
      "http://localhost:3000/pt/filmes/",
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
