/**
 * Formatacao inline no render publico: o que vira <strong>/<em>/<a> e o que nao.
 *
 * `body_blocks` e uma coluna Json — o presenter le dado que o TypeScript nao
 * valida em runtime. Aqui, a marcacao torta nunca pode derrubar a pagina nem
 * produzir um `<a>` para destino nao revisado: o pior desfecho aceitavel e a
 * materia sair SEM negrito, com o texto inteiro no lugar.
 */

import { describe, expect, it } from "vitest";

import {
  buildArticleBodyBlocks,
  toTextSegments,
  EMPTY_ARTICLE_BODY_HYDRATION,
  type ArticleBodyTextSegment,
} from "../article-body-presenter";

const TEXT = "O filme Duna e otimo.";
const BOLD_DUNA = [{ start: 8, end: 12, type: "bold" }];

function paragraphOf(marks: unknown) {
  const [block] = buildArticleBodyBlocks(
    [{ type: "paragraph", id: "p1", text: TEXT, marks }],
    EMPTY_ARTICLE_BODY_HYDRATION,
  );
  if (block === undefined || block.kind !== "paragraph") {
    throw new Error("bloco de paragrafo ausente");
  }
  return block;
}

/** So o texto de cada trecho, para asserts legiveis. */
const shape = (segments: readonly ArticleBodyTextSegment[]) =>
  segments.map((segment) => [
    segment.text,
    segment.bold ? "b" : "",
    segment.italic ? "i" : "",
    segment.href ?? "",
  ]);

describe("paragrafo com formatacao", () => {
  it("corta o texto no intervalo exato da marcacao", () => {
    expect(shape(paragraphOf(BOLD_DUNA).segments)).toEqual([
      ["O filme ", "", "", ""],
      ["Duna", "b", "", ""],
      [" e otimo.", "", "", ""],
    ]);
  });

  it("mantem `text` intacto ao lado dos trechos", () => {
    const block = paragraphOf(BOLD_DUNA);
    expect(block.text).toBe(TEXT);
    expect(block.segments.map((segment) => segment.text).join("")).toBe(TEXT);
  });

  it("resolve negrito e link sobrepostos num trecho so", () => {
    const segments = toTextSegments("abcdef", [
      { start: 0, end: 4, type: "bold" },
      { start: 2, end: 6, type: "link", href: "https://cinerie.com/x" },
    ]);
    expect(shape(segments)).toEqual([
      ["ab", "b", "", ""],
      ["cd", "b", "", "https://cinerie.com/x"],
      ["ef", "", "", "https://cinerie.com/x"],
    ]);
  });
});

describe("artigo antigo (sem marcacao) nao muda", () => {
  it.each([
    ["campo ausente", undefined],
    ["nulo", null],
    ["lista vazia", []],
  ])("%s: um unico trecho, sem formatacao", (_label, marks) => {
    expect(paragraphOf(marks).segments).toEqual([
      { text: TEXT, bold: false, italic: false, href: null },
    ]);
  });
});

describe("degrada para texto puro, nunca quebra", () => {
  it.each([
    ["fim alem do texto", [{ start: 0, end: 999, type: "bold" }]],
    ["inicio negativo", [{ start: -3, end: 4, type: "bold" }]],
    ["intervalo invertido", [{ start: 9, end: 2, type: "bold" }]],
    ["intervalo vazio", [{ start: 4, end: 4, type: "bold" }]],
    ["offset fracionario", [{ start: 0, end: 2.5, type: "bold" }]],
    ["offset em texto", [{ start: "0", end: "4", type: "bold" }]],
    ["tipo desconhecido", [{ start: 0, end: 4, type: "sublinhado" }]],
    ["marcacao nao e objeto", ["bold"]],
    ["marcacao nula", [null]],
    ["nao e lista", { start: 0, end: 4, type: "bold" }],
  ])("%s", (_label, marks) => {
    const block = paragraphOf(marks);
    // O TEXTO nunca se perde: e a diferenca entre uma materia sem negrito e uma
    // materia sem paragrafo.
    expect(block.segments.map((segment) => segment.text).join("")).toBe(TEXT);
    expect(block.segments.every((segment) => !segment.bold)).toBe(true);
  });
});

describe("link: destino sempre revisado", () => {
  it("aceita http(s) e normaliza", () => {
    const [segment] = toTextSegments("abc", [
      { start: 0, end: 3, type: "link", href: "https://cinerie.com" },
    ]);
    expect(segment?.href).toBe("https://cinerie.com/");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data: de HTML", "data:text/html,<script>x</script>"],
    ["relativo", "/interno"],
    ["sem esquema", "cinerie.com"],
    ["vazio", ""],
    ["ausente", undefined],
  ])("recusa %s e degrada o paragrafo inteiro", (_label, href) => {
    const segments = toTextSegments(TEXT, [
      { start: 0, end: 4, type: "link", href },
    ]);
    expect(segments).toEqual([
      { text: TEXT, bold: false, italic: false, href: null },
    ]);
  });

  it("um link ruim derruba a formatacao do paragrafo, nao so a dele", () => {
    // FAIL-CLOSED: descartar so a marcacao ruim deixaria as vizinhas visiveis, e
    // formatacao parcial e mais dificil de notar que formatacao ausente.
    const segments = toTextSegments(TEXT, [
      { start: 0, end: 4, type: "bold" },
      { start: 5, end: 9, type: "link", href: "javascript:x" },
    ]);
    expect(segments).toEqual([
      { text: TEXT, bold: false, italic: false, href: null },
    ]);
  });
});

describe("emoji", () => {
  it("recusa corte no meio de um par surrogado", () => {
    expect(toTextSegments("🎬ab", [{ start: 1, end: 3, type: "bold" }])).toEqual([
      { text: "🎬ab", bold: false, italic: false, href: null },
    ]);
  });

  it("aceita corte na borda do emoji", () => {
    expect(shape(toTextSegments("🎬ab", [{ start: 0, end: 2, type: "bold" }]))).toEqual([
      ["🎬", "b", "", ""],
      ["ab", "", "", ""],
    ]);
  });
});
