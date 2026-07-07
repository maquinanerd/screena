/**
 * Testes do gate de placeholders visuais da Home v4 / newsletter do rodape.
 *
 * A decisao e feita server-side por `allowHomeVisualPlaceholders`. Para nao
 * depender de mutar `process.env` (fragil e com efeito colateral entre testes),
 * exercitamos a funcao com ENV injetado. Um teste extra confirma o modo padrao
 * (sem argumento) sob o ambiente do vitest (`NODE_ENV = "test"`).
 */

import { describe, expect, it } from "vitest";

import { allowHomeVisualPlaceholders } from "../../apps/web/src/lib/home-placeholder-governance";

describe("allowHomeVisualPlaceholders", () => {
  it("permite placeholders fora de producao (dev/preview/test)", () => {
    expect(allowHomeVisualPlaceholders({ nodeEnv: "development" })).toBe(true);
    expect(allowHomeVisualPlaceholders({ nodeEnv: "test" })).toBe(true);
    expect(allowHomeVisualPlaceholders({ nodeEnv: undefined })).toBe(true);
  });

  it("bloqueia placeholders em producao sem a flag", () => {
    expect(allowHomeVisualPlaceholders({ nodeEnv: "production" })).toBe(false);
    expect(
      allowHomeVisualPlaceholders({ nodeEnv: "production", flag: undefined }),
    ).toBe(false);
    expect(
      allowHomeVisualPlaceholders({ nodeEnv: "production", flag: "0" }),
    ).toBe(false);
    expect(
      allowHomeVisualPlaceholders({ nodeEnv: "production", flag: "true" }),
    ).toBe(false);
  });

  it("libera placeholders em producao com SCREEN_HOME_VISUAL_PLACEHOLDERS=1", () => {
    expect(
      allowHomeVisualPlaceholders({ nodeEnv: "production", flag: "1" }),
    ).toBe(true);
  });

  it("a flag nao vaza para fora de producao (dev sempre permite)", () => {
    expect(
      allowHomeVisualPlaceholders({ nodeEnv: "development", flag: "0" }),
    ).toBe(true);
  });

  it("modo padrao (sem arg) le process.env e devolve boolean (test -> true)", () => {
    const result = allowHomeVisualPlaceholders();
    expect(typeof result).toBe("boolean");
    // vitest roda com NODE_ENV = "test" (nao producao) -> placeholders liberados.
    expect(result).toBe(true);
  });
});
