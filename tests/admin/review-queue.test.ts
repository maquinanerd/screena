/**
 * Guarda da fila de revisao (/review-queue, Fase 7B).
 *
 * Afirma que:
 *   - a rota /review-queue existe (page.tsx);
 *   - o helper `review-queue.ts` e SOMENTE LEITURA (sem write Prisma / SQL cru);
 *   - as queries tem limite (`take`) e ordenacao determinista (`orderBy`);
 *   - existem as 5 seccoes da fila;
 *   - ha link "Revisar" para o detalhe;
 *   - nao ha fetch externo.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const QUEUE_PAGE = resolve(process.cwd(), "apps", "admin", "app", "review-queue", "page.tsx");
const QUEUE_HELPER = resolve(process.cwd(), "apps", "admin", "src", "server", "review-queue.ts");

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

/** Metodos de escrita / SQL cru proibidos no helper read-only. */
const FORBIDDEN_WRITES = [
  ".create(",
  ".update(",
  ".delete(",
  ".upsert(",
  ".createMany(",
  ".updateMany(",
  ".deleteMany(",
  "$executeRaw",
  ".$executeRawUnsafe(",
  ".$queryRawUnsafe(",
  ".$queryRaw",
];

/** As 5 seccoes esperadas da fila. */
const SECTION_KEYS = [
  "articles_blocked",
  "articles_pending",
  "articles_index_ready",
  "blocks_pending",
  "blocks_approved",
];

describe("fila de revisao: rota e helper read-only (Fase 7B)", () => {
  let pageRaw = "";
  let helperCode = "";

  beforeAll(async () => {
    pageRaw = await readFile(QUEUE_PAGE, "utf-8");
    helperCode = stripComments(await readFile(QUEUE_HELPER, "utf-8"));
  });

  it("a rota /review-queue existe (page.tsx) e nao ha route.*", async () => {
    expect(await pathExists(QUEUE_PAGE)).toBe(true);
    const dir = resolve(process.cwd(), "apps", "admin", "app", "review-queue");
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
      expect(await pathExists(resolve(dir, `route${ext}`))).toBe(false);
    }
  });

  it("o helper e SOMENTE LEITURA (sem write Prisma / SQL cru)", () => {
    for (const needle of FORBIDDEN_WRITES) {
      expect(helperCode.includes(needle), `helper usa ${needle}`).toBe(false);
    }
    // Le de fato o banco (guarda nao e vacua).
    expect(helperCode).toContain(".count(");
    expect(helperCode).toContain(".findMany(");
  });

  it("as queries tem limite (take) e ordenacao determinista (orderBy)", () => {
    expect(helperCode).toContain("take:");
    expect(helperCode).toContain("orderBy");
    expect(helperCode).toContain("REVIEW_QUEUE_SECTION_LIMIT");
  });

  it("existem as 5 seccoes da fila", () => {
    for (const key of SECTION_KEYS) {
      expect(helperCode, `seccao ausente: ${key}`).toContain(key);
    }
  });

  it("ha link Revisar para o detalhe e nao ha fetch externo", () => {
    expect(pageRaw).toContain("Revisar");
    expect(helperCode).toContain("/articles/");
    expect(helperCode).toContain("/content-blocks/");
    expect(/\bfetch\s*\(/.test(stripComments(pageRaw))).toBe(false);
    expect(/\bfetch\s*\(/.test(helperCode)).toBe(false);
  });

  it("o helper nao usa server action nem exporta verbo de escrita", () => {
    expect(/["']use server["']/.test(helperCode)).toBe(false);
    expect(/export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(helperCode)).toBe(false);
  });
});
