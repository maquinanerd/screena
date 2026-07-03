/**
 * Guarda: o helper de QA (`apps/admin/src/server/content-qa.ts`) e SOMENTE LEITURA.
 *
 * Afirma que nao contem escrita Prisma nem SQL cru, nao chama fetch, e que as
 * queries tem limite (`take`) e ordenacao determinista (`orderBy`).
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const QA_SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "content-qa.ts");

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

/** Metodos/SQL de escrita proibidos num helper read-only. */
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

describe("content-qa server helper e SOMENTE LEITURA (Fase 7D)", () => {
  let code = "";

  beforeAll(async () => {
    code = stripComments(await readFile(QA_SERVER, "utf-8"));
  });

  it("existe", async () => {
    expect(await pathExists(QA_SERVER)).toBe(true);
  });

  it("nao contem escrita Prisma nem SQL cru", () => {
    for (const needle of FORBIDDEN_WRITES) {
      expect(code.includes(needle), `helper de QA usa ${needle}`).toBe(false);
    }
    // Le de fato (guarda nao vacua).
    expect(code).toContain(".findMany(");
    expect(code).toContain(".count(");
  });

  it("nao chama fetch externo", () => {
    expect(/\bfetch\s*\(/.test(code)).toBe(false);
  });

  it("queries tem take/limite e ordenacao determinista", () => {
    expect(code).toContain("take:");
    expect(code).toContain("orderBy");
    expect(code).toContain("QA_WINDOW");
  });
});
