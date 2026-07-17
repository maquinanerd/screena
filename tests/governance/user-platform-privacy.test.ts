/**
 * Testes de governanca — Backend C (user product platform), privacidade.
 *
 * Garantem tres travas:
 *  1. Defaults seguros no schema: TODA superficie de usuario nasce privada
 *     (visibility=private), review de usuario nasce pending, snapshot de
 *     recomendacao nasce is_current=false (fail-closed).
 *  2. A user platform NAO entra no caminho de render publico: nenhum arquivo
 *     de apps/web ou apps/admin importa @screena/user-platform (superficies
 *     de usuario sao fase futura, noindex por construcao — invariante 5,
 *     caso tecnico).
 *  3. Nada de usuario vaza para o sitemap: o codigo de sitemap (packages/seo
 *     + rotas de sitemap do web) nao referencia tabelas user_*.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCHEMA_PATH = path.join(ROOT, "packages", "db", "prisma", "schema.prisma");
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
  const re = new RegExp(
    `${field}\\b[^\\n]*@default\\(${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
  );
  return re.test(body);
}

function collectCodeFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (["node_modules", ".next", "dist", "build", "coverage"].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectCodeFiles(full));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("user platform: defaults seguros no schema (tudo nasce privado)", () => {
  it("(1) as tabelas user_* existem no schema", () => {
    for (const t of [
      "users",
      "user_profiles",
      "user_watch_states",
      "user_lists",
      "user_reviews",
      "user_ratings",
      "user_recommendation_snapshots",
    ]) {
      expect(modelBlock(t), `tabela ${t} ausente do schema`).not.toBe("");
    }
  });

  it("(2) perfil nasce privado", () => {
    expect(hasDefault(modelBlock("user_profiles"), "visibility", "private")).toBe(true);
  });

  it("(3) watch state nasce privado", () => {
    expect(hasDefault(modelBlock("user_watch_states"), "visibility", "private")).toBe(true);
  });

  it("(4) listas nascem privadas", () => {
    expect(hasDefault(modelBlock("user_lists"), "visibility", "private")).toBe(true);
  });

  it("(5) review de usuario nasce pending + privada (fail-closed)", () => {
    const body = modelBlock("user_reviews");
    expect(hasDefault(body, "status", "pending")).toBe(true);
    expect(hasDefault(body, "visibility", "private")).toBe(true);
  });

  it("(6) snapshot de recomendacao nasce is_current=false (servico promove)", () => {
    expect(hasDefault(modelBlock("user_recommendation_snapshots"), "isCurrent", "false")).toBe(
      true,
    );
  });

  it("(7) user_ratings nao referencia rating_sources/external_ratings (invariantes 1/2)", () => {
    const body = modelBlock("user_ratings");
    expect(body).not.toBe("");
    expect(body.includes("RatingSource")).toBe(false);
    expect(body.includes("ExternalRating")).toBe(false);
    expect(body.includes("provider_api")).toBe(false);
  });
});

describe("user platform: fora do caminho de render publico (invariante 5, caso tecnico)", () => {
  it("(8) nenhum arquivo de apps/web ou apps/admin importa @screena/user-platform", () => {
    const files = [
      ...collectCodeFiles(path.join(ROOT, "apps", "web")),
      ...collectCodeFiles(path.join(ROOT, "apps", "admin")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => {
      const content = readFileSync(file, "utf8");
      return (
        content.includes("@screena/user-platform") || content.includes("services/user-platform")
      );
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("(9) codigo de sitemap nao referencia tabela user_* (privado nunca entra em sitemap)", () => {
    const sitemapFiles = [
      ...collectCodeFiles(path.join(ROOT, "packages", "seo", "src")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "app", "sitemap.xml")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "app", "sitemaps")),
      ...collectCodeFiles(path.join(ROOT, "apps", "web", "src", "server", "seo")),
    ];
    expect(sitemapFiles.length).toBeGreaterThan(0);
    const forbidden =
      /user_lists|user_reviews|user_watch_states|user_profiles|user_ratings|userList|userReview|userWatchState|userRating/;
    const offenders = sitemapFiles.filter((file) => forbidden.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
