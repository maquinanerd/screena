/**
 * Guarda de SEGURANCA do harness de seed demo publico (Fase 9A).
 *
 * O runner `apps/admin/scripts/public-demo-seed.ts` e uma superficie de escrita
 * Prisma FORA do runtime do admin (nao importado por pagina/componente; os guards
 * `readonly-guard`/`pages-no-write` varrem `src`/`app`, nunca `scripts`). Sua
 * seguranca e travada aqui: escrita so depois da resolucao de modo, nunca chama
 * API externa e nunca loga segredo. A decisao pura e testada em
 * `public-demo-seed-plan.test.ts`.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "apps", "admin", "scripts", "public-demo-seed.ts");

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue;
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("harness de seed demo publico (Fase 9A)", () => {
  let code = "";

  beforeAll(async () => {
    code = stripComments(await readFile(SCRIPT, "utf-8"));
  });

  it("existe", async () => {
    expect(await pathExists(SCRIPT)).toBe(true);
  });

  it("resolve o modo pelo lib puro antes de qualquer acesso ao banco", () => {
    expect(code).toContain("resolvePublicDemoMode(");
    const decisionAt = code.indexOf("resolvePublicDemoMode(");
    const dbAt = code.indexOf('import("@screena/db/server")');
    expect(decisionAt).toBeGreaterThanOrEqual(0);
    expect(dbAt).toBeGreaterThan(decisionAt);
  });

  it("trata dry-run e abort antes de importar o banco (fail closed)", () => {
    const dryAt = code.indexOf('"dry-run"');
    const abortAt = code.indexOf('"abort"');
    const dbAt = code.indexOf('import("@screena/db/server")');
    expect(dryAt).toBeGreaterThanOrEqual(0);
    expect(abortAt).toBeGreaterThanOrEqual(0);
    expect(dryAt).toBeLessThan(dbAt);
    expect(abortAt).toBeLessThan(dbAt);
  });

  it("e uma superficie de escrita REAL (guarda nao vacua), so no banco local", () => {
    expect(code).toContain(".upsert(");
    expect(code).toContain(".deleteMany(");
    expect(code).toContain("@screena/db/server");
  });

  it("cleanup remove SO registros marcados (prefixo + marcador + sentinela)", () => {
    expect(code).toContain("PUBLIC_DEMO_SLUG_PREFIX");
    expect(code).toContain("PUBLIC_DEMO_MARKER");
    expect(code).toContain("startsWith");
    expect(code).toContain("tmdbId");
  });

  it("NAO chama nenhuma API externa (TMDB/Gemini/etc.)", () => {
    expect(/\bfetch\s*\(/.test(code)).toBe(false);
    const FORBIDDEN = [
      "themoviedb",
      "image.tmdb.org",
      "rapidapi",
      "gemini",
      "generativelanguage",
      "googleapis",
      "rottentomatoes",
      "wordpress",
      "rssprime",
      "mn26",
      "https://",
    ];
    for (const needle of FORBIDDEN) {
      expect(code.toLowerCase().includes(needle.toLowerCase()), `host externo: ${needle}`).toBe(false);
    }
  });

  it("nao loga segredo: nenhum console imprime DATABASE_URL/credencial/valor de confirmacao", () => {
    for (const line of code.split(/\r?\n/)) {
      if (!/\bconsole\s*\./.test(line)) continue;
      const lower = line.toLowerCase();
      expect(lower.includes("database_url")).toBe(false);
      expect(lower.includes("admin_basic_auth")).toBe(false);
      expect(lower.includes("confirmvalue")).toBe(false);
      expect(/\.(?:password|pass|senha)\b/i.test(line)).toBe(false);
    }
  });

  it("exige confirmacao dupla explicita (flag + env de confirmacao)", () => {
    expect(code).toContain("PUBLIC_DEMO_CONFIRM_ENV");
    expect(code).toContain("parsePublicDemoFlags");
  });
});
