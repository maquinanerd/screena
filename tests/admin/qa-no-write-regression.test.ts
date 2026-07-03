/**
 * Regressao: a rota /qa e o helper de QA NAO introduzem escrita (Fase 7D).
 *
 * Afirma que /qa nao cria route handler, nao usa `"use server"`, nao chama as
 * editorial actions (write), nao tem input/form de mutacao e nao chama `.update`.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const QA_DIR = resolve(process.cwd(), "apps", "admin", "app", "qa");
const QA_PAGE = resolve(QA_DIR, "page.tsx");
const QA_SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "content-qa.ts");
const QA_LIB = resolve(process.cwd(), "apps", "admin", "src", "lib", "content-qa.ts");

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

describe("/qa nao introduz superficie de escrita (Fase 7D)", () => {
  it("nao ha route.* dentro de app/qa", async () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(await pathExists(resolve(QA_DIR, `route${ext}`))).toBe(false);
    }
  });

  it("page/helper/lib nao usam \"use server\" nem .update(", async () => {
    for (const file of [QA_PAGE, QA_SERVER, QA_LIB]) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(/["']use server["']/.test(code), `${file}: use server`).toBe(false);
      expect(code.includes(".update("), `${file}: .update(`).toBe(false);
      expect(/export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(code)).toBe(false);
    }
  });

  it("a pagina de QA nao importa as editorial actions (write)", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    expect(code).not.toContain("editorial-actions");
    expect(code).not.toContain("runBulk");
    expect(code).not.toContain("updateArticle");
    expect(code).not.toContain("updateContentBlock");
  });

  it("a pagina de QA nao tem form/input de mutacao", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    expect(/<form\b/i.test(code)).toBe(false);
    expect(/<input\b/i.test(code)).toBe(false);
    expect(/<button\b/i.test(code)).toBe(false);
  });
});
