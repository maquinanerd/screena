/**
 * json-ld-safe-serialization.test.ts — Enforcement estatico da Fase 3 (§14/§7):
 * TODO bloco `application/ld+json` do app publico deve ser serializado pelo
 * serializador central HTML-safe (`serializeJsonLd` de @screena/seo), NUNCA por
 * `JSON.stringify` cru injetado em `dangerouslySetInnerHTML`.
 *
 * `JSON.stringify` cru deixa passar `</script>`, `<`, `>`, `&`, U+2028 e U+2029,
 * permitindo quebrar o `<script>` ou injetar markup a partir de dados do banco
 * (titulos, nomes, descricoes). O serializador central escapa tudo isso.
 *
 * Este teste varre o codigo-fonte de `apps/web/app` (mesmo padrao estatico de
 * `home-seo-identity.test.ts`) — o app nao roda no vitest, so o fonte e lido.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "apps",
  "web",
  "app",
);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(APP_DIR);

function rel(file: string): string {
  return path.relative(APP_DIR, file).split(path.sep).join("/");
}

describe("JSON-LD serializado de forma HTML-safe (Fase 3)", () => {
  it("nenhum arquivo em apps/web/app usa JSON.stringify cru em dangerouslySetInnerHTML", () => {
    const offenders = FILES.filter((file) =>
      readFileSync(file, "utf8").includes("__html: JSON.stringify("),
    ).map(rel);
    expect(offenders, `JSON.stringify cru em: ${offenders.join(", ")}`).toEqual([]);
  });

  it("todo arquivo com application/ld+json usa serializeJsonLd", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("application/ld+json")) continue;
      if (!src.includes("serializeJsonLd(")) {
        offenders.push(`${rel(file)} nao usa serializeJsonLd`);
      }
    }
    expect(offenders, offenders.join(" | ")).toEqual([]);
  });

  it("ha pelo menos um bloco JSON-LD serializado (o teste esta cobrindo algo real)", () => {
    const withJsonLd = FILES.filter((file) =>
      readFileSync(file, "utf8").includes("application/ld+json"),
    );
    expect(withJsonLd.length).toBeGreaterThan(0);
  });
});
