/**
 * root-locale.test.ts — teste SENTINELA de `apps/**` + trava da fonte unica de
 * locales (baseline R-07).
 *
 * DUPLA FUNCAO:
 *  1. SENTINELA da coleta de testes: este arquivo VIVE dentro de `apps/web`.
 *     Antes do Prompt 01, o `include` do vitest cobria apenas
 *     tests/packages/api-clients/services — um teste em `apps/**` NUNCA rodava
 *     (falha silenciosa). Se este arquivo parar de ser coletado, a regressao
 *     volta sem sinal. (Controle negativo executado no PR: uma asercao
 *     deliberadamente falsa aqui derrubou `pnpm test`.)
 *  2. TRAVA da fonte unica: `apps/web` nao pode mais redeclarar a lista de
 *     locales. Os valores de rota DEVEM derivar de `@screena/config`.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_URL_LOCALE,
  LOCALE_URL_SEGMENT,
  PUBLISHED_LOCALES as CONFIG_PUBLISHED_LOCALES,
  PUBLISHED_URL_LOCALES,
  SUPPORTED_LOCALES as CONFIG_SUPPORTED_LOCALES,
  SUPPORTED_URL_LOCALES,
} from "@screena/config";

import {
  DEFAULT_LOCALE,
  PUBLISHED_LOCALES,
  resolveLocale,
  resolveRootRedirectLocale,
  rootRedirectPath,
  SUPPORTED_LOCALES,
} from "../root-locale";

describe("locale: fonte unica em @screena/config", () => {
  it("os locales de rota de apps/web derivam do config (nao ha lista paralela)", () => {
    expect([...SUPPORTED_LOCALES]).toEqual([...SUPPORTED_URL_LOCALES]);
    expect([...PUBLISHED_LOCALES]).toEqual([...PUBLISHED_URL_LOCALES]);
    expect(DEFAULT_LOCALE).toBe(DEFAULT_URL_LOCALE);
  });

  it("os segmentos de URL derivam dos language_codes do config via LOCALE_URL_SEGMENT", () => {
    const derivedSupported = [
      ...new Set(CONFIG_SUPPORTED_LOCALES.map((code) => LOCALE_URL_SEGMENT[code])),
    ];
    const derivedPublished = [
      ...new Set(CONFIG_PUBLISHED_LOCALES.map((code) => LOCALE_URL_SEGMENT[code])),
    ];
    expect([...SUPPORTED_URL_LOCALES]).toEqual(derivedSupported);
    expect([...PUBLISHED_URL_LOCALES]).toEqual(derivedPublished);
  });

  it("a rota nunca expoe o language_code regional pt-BR como segmento", () => {
    expect(SUPPORTED_LOCALES).not.toContain("pt-BR");
    expect(PUBLISHED_LOCALES).not.toContain("pt-BR");
    // pt-BR e pt compartilham o segmento de rota "pt".
    expect(LOCALE_URL_SEGMENT["pt-BR"]).toBe("pt");
    expect(LOCALE_URL_SEGMENT.pt).toBe("pt");
  });
});

describe("locale: comportamento publico preservado", () => {
  it("hoje so pt esta publicado (comportamento anterior identico)", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["pt", "en", "es"]);
    expect([...PUBLISHED_LOCALES]).toEqual(["pt"]);
    expect(DEFAULT_LOCALE).toBe("pt");
  });

  it("resolveLocale le o primeiro segmento do pathname", () => {
    expect(resolveLocale("/pt/filmes/")).toBe("pt");
    expect(resolveLocale("/en/movies/")).toBe("en");
    expect(resolveLocale("/es/")).toBe("es");
    expect(resolveLocale("/")).toBe("pt");
    expect(resolveLocale("/desconhecido/")).toBe("pt");
  });

  it("a raiz sempre redireciona para um locale PUBLICADO, hoje /pt/", () => {
    // Mesmo pedindo en/es, so pt esta publicado -> cai no default publicado.
    expect(rootRedirectPath(null)).toBe("/pt/");
    expect(rootRedirectPath("en-US,en;q=0.9")).toBe("/pt/");
    expect(rootRedirectPath("es-ES,es;q=0.9")).toBe("/pt/");
    expect(rootRedirectPath("pt-BR,pt;q=0.9")).toBe("/pt/");
    expect(resolveRootRedirectLocale("en")).toBe("pt");
  });
});
