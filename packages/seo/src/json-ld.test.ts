/**
 * json-ld.test.ts — Serializacao HTML-safe de JSON-LD (Prompt 3 §7).
 *
 * Garante que payloads maliciosos/perigosos nunca conseguem encerrar o
 * `<script>` nem injetar markup, e que a saida continua sendo JSON valido
 * (equivalente semantico ao original).
 *
 * Os separadores U+2028/U+2029 sao construidos por CODE POINT
 * (`String.fromCharCode`), nunca como caractere literal no fonte.
 */

import { describe, expect, it } from "vitest";

import { escapeJsonForHtml, serializeJsonLd } from "./json-ld.js";

const LINE_SEP = String.fromCharCode(0x2028);
const PARAGRAPH_SEP = String.fromCharCode(0x2029);

describe("serializeJsonLd — hardening HTML", () => {
  it("neutraliza fechamento de </script>", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
  });

  it("escapa & para evitar entidades HTML", () => {
    const out = serializeJsonLd({ q: "a & b" });
    expect(out).not.toContain("&");
    expect(out).toContain("\\u0026");
  });

  it("escapa U+2028 e U+2029 (separadores ilegais em string JS)", () => {
    const out = serializeJsonLd({ text: `linha1${LINE_SEP}linha2${PARAGRAPH_SEP}fim` });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out.includes(LINE_SEP)).toBe(false);
    expect(out.includes(PARAGRAPH_SEP)).toBe(false);
  });

  it("a saida continua JSON valido e semanticamente igual", () => {
    const value = {
      "@context": "https://schema.org",
      "@type": "Movie",
      name: "A < B & C >",
      note: `x${LINE_SEP}y`,
    };
    const out = serializeJsonLd(value);
    // Os escapes \\uXXXX sao reconvertidos pelo parser JSON -> objeto identico.
    expect(JSON.parse(out)).toEqual(value);
  });

  it("payload benigno passa inalterado exceto pelos caracteres perigosos", () => {
    const out = escapeJsonForHtml('{"a":1,"b":"ok"}');
    expect(out).toBe('{"a":1,"b":"ok"}');
  });

  it("nao deixa nenhum '<' cru mesmo em <!-- ou <![CDATA[", () => {
    const out = serializeJsonLd({ x: "<!-- <![CDATA[ ]]> -->" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });
});
