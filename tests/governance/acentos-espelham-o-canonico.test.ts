/**
 * acentos-espelham-o-canonico.test.ts — os dois acentos tem UM valor so.
 *
 * ============================================================================
 * O QUE ACONTECEU
 * ============================================================================
 * `COLOR_TOKENS` em `@screena/config` declarava `movieRed: "#FF3B30"` e
 * `seriesGreen: "#7AA66D"`. `apps/web/app/globals.css` sempre renderizou
 * `--c-accent-movie: #f0443e` e `--c-accent-series: #7fa56f`. Os dois valores
 * do config NAO aparecem em lugar nenhum do canonico.
 *
 * A divergencia sobreviveu porque `COLOR_TOKENS` nao e consumido por NADA — nem
 * app, nem teste. Documentacao-como-codigo com valor errado e pior que
 * documentacao errada: ela parece autoridade executavel, e a proxima pessoa
 * que precisar do acento vai importar dali em vez de ler o CSS.
 *
 * Constante morta nao se conserta com disciplina. Se conserta com trava.
 *
 * ============================================================================
 * QUEM MANDA
 * ============================================================================
 * O canonico (`Screen Screens v4.dc.html`), e depois dele o `globals.css`, que
 * e o que vai ao ar. Este teste compara os DOIS lados que existem em codigo. Se
 * discordarem, o errado e `COLOR_TOKENS` — nunca o CSS.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COLOR_TOKENS } from "@screena/config";

const CSS = readFileSync(
  fileURLToPath(new URL("../../apps/web/app/globals.css", import.meta.url)),
  "utf8",
);

/** Valor declarado de um token no `:root` do globals.css. */
function tokenNoCss(nome: string): string {
  const m = new RegExp(`${nome}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`).exec(CSS);
  if (m === null) throw new Error(`token ${nome} nao encontrado no globals.css`);
  return (m[1] ?? "").toLowerCase();
}

describe("os acentos de filme e serie tem UM valor so", () => {
  it("CONTROLE POSITIVO: o CSS foi lido e declara os dois tokens", () => {
    // Sem esta ancora, um caminho errado faria `tokenNoCss` lancar e o
    // diagnostico apareceria como "token nao encontrado" em vez de "arquivo
    // errado" — que sao dois problemas bem diferentes.
    expect(CSS.length).toBeGreaterThan(100_000);
    expect(() => tokenNoCss("--c-accent-movie")).not.toThrow();
    expect(() => tokenNoCss("--c-accent-series")).not.toThrow();
  });

  it("COLOR_TOKENS.movieRed e o mesmo que --c-accent-movie", () => {
    expect(COLOR_TOKENS.movieRed.toLowerCase()).toBe(tokenNoCss("--c-accent-movie"));
  });

  it("COLOR_TOKENS.seriesGreen e o mesmo que --c-accent-series", () => {
    expect(COLOR_TOKENS.seriesGreen.toLowerCase()).toBe(tokenNoCss("--c-accent-series"));
  });

  it("NEGATIVO: os valores ERRADOS nao voltam por nenhum dos dois lados", () => {
    // Os literais que ficaram anos na documentacao. Se um deles reaparecer em
    // qualquer dos lados, e regressao — nao uma escolha nova.
    const errados = ["#ff3b30", "#7aa66d"];
    for (const errado of errados) {
      expect(COLOR_TOKENS.movieRed.toLowerCase(), errado).not.toBe(errado);
      expect(COLOR_TOKENS.seriesGreen.toLowerCase(), errado).not.toBe(errado);
      expect(tokenNoCss("--c-accent-movie"), errado).not.toBe(errado);
      expect(tokenNoCss("--c-accent-series"), errado).not.toBe(errado);
    }
  });

  it("CONTROLE NEGATIVO DA REGUA: o extrator sabe achar valor diferente", () => {
    // Um extrator que devolvesse sempre a mesma coisa faria os tres testes
    // acima passarem por acidente. Os dois acentos SAO diferentes entre si.
    expect(tokenNoCss("--c-accent-movie")).not.toBe(tokenNoCss("--c-accent-series"));
  });
});
