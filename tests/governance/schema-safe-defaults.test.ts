/**
 * Teste de governanca (Fase 1, itens 3 e 7) — defaults seguros no schema.
 *
 * - Item 7: external_ratings.display_allowed e watch_availability.display_allowed
 *   nascem false (nada exibivel ate licenca confirmada — invariante 6).
 * - Item 3: en/es nascem draft/noindex e nao podem ser indexaveis por padrao
 *   (languages.is_published/index_default=false; entity_translations
 *   status=draft/index_status=noindex; page_indexability_decisions
 *   decision=noindex) — invariantes 7/9.
 *
 * Le packages/db/prisma/schema.prisma (relativo a process.cwd()) e valida os
 * @default por modelo, alem da seed de idiomas. Falha se algum default seguro
 * for relaxado.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGE_SEED } from "@screena/db";

const SCHEMA_PATH = path.join(process.cwd(), "packages", "db", "prisma", "schema.prisma");
const schema = readFileSync(SCHEMA_PATH, "utf8");

/** Extrai o corpo de um modelo (da declaracao ate seu @@map("<table>")). */
function modelBlock(tableName: string): string {
  const idx = schema.indexOf(`@@map("${tableName}")`);
  if (idx < 0) {
    return "";
  }
  const start = schema.lastIndexOf("\nmodel ", idx);
  return schema.slice(start, idx);
}

/** Verdadeiro se o corpo contem `<field> ... @default(<value>)`. */
function hasDefault(body: string, field: string, value: string): boolean {
  const re = new RegExp(`${field}\\b[^\\n]*@default\\(${value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\)`);
  return re.test(body);
}

describe("schema: defaults seguros (itens 3 e 7)", () => {
  it("schema.prisma foi encontrado e tem as tabelas-chave", () => {
    expect(schema.length).toBeGreaterThan(0);
    for (const t of [
      "external_ratings",
      "watch_availability",
      "source_licenses",
      "entity_translations",
      "page_indexability_decisions",
      "content_blocks",
      "languages",
    ]) {
      expect(modelBlock(t)).not.toBe("");
    }
  });

  it("external_ratings.display_allowed default false (item 7)", () => {
    expect(hasDefault(modelBlock("external_ratings"), "displayAllowed", "false")).toBe(true);
  });

  it("watch_availability.display_allowed default false (item 7)", () => {
    expect(hasDefault(modelBlock("watch_availability"), "displayAllowed", "false")).toBe(true);
  });

  it("source_licenses nasce no estado mais restritivo (invariante 6)", () => {
    const body = modelBlock("source_licenses");
    expect(hasDefault(body, "licenseStatus", "unknown")).toBe(true);
    expect(hasDefault(body, "displayAllowed", "false")).toBe(true);
    expect(hasDefault(body, "scoreAllowed", "false")).toBe(true);
  });

  it("entity_translations nasce draft/noindex (item 3)", () => {
    const body = modelBlock("entity_translations");
    expect(hasDefault(body, "status", "draft")).toBe(true);
    expect(hasDefault(body, "indexStatus", "noindex")).toBe(true);
  });

  it("page_indexability_decisions nasce noindex (invariante 5)", () => {
    expect(hasDefault(modelBlock("page_indexability_decisions"), "decision", "noindex")).toBe(true);
  });

  it("content_blocks nasce draft (invariante 8/13)", () => {
    expect(hasDefault(modelBlock("content_blocks"), "reviewStatus", "draft")).toBe(true);
  });

  it("movies/tv_shows: screen_score_display nasce false (nota editorial oculta ate liberacao)", () => {
    // A nota editorial PROPRIA do Screen so aparece quando explicitamente
    // liberada; nasce oculta (default seguro), como os demais gates de exibicao.
    expect(hasDefault(modelBlock("movies"), "screenScoreDisplay", "false")).toBe(true);
    expect(hasDefault(modelBlock("tv_shows"), "screenScoreDisplay", "false")).toBe(true);
  });

  it("languages: defaults de publicacao/indexacao sao false (seguro)", () => {
    const body = modelBlock("languages");
    expect(hasDefault(body, "isPublished", "false")).toBe(true);
    expect(hasDefault(body, "indexDefault", "false")).toBe(true);
  });
});

describe("seed de idiomas: pt-BR primeiro; en/es draft/noindex (item 3)", () => {
  const byCode = Object.fromEntries(LANGUAGE_SEED.map((l) => [l.code, l]));

  it("pt-BR publica e indexa por padrao", () => {
    expect(byCode["pt-BR"]?.isPublished).toBe(true);
    expect(byCode["pt-BR"]?.indexDefault).toBe(true);
  });

  it("en e es nascem nao-publicados e nao-indexaveis", () => {
    for (const code of ["en", "es"]) {
      expect(byCode[code]?.isPublished).toBe(false);
      expect(byCode[code]?.indexDefault).toBe(false);
    }
  });
});
