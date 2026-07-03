/**
 * Guarda textual das ACOES EM LOTE (Fase 7C).
 *
 * A escrita em lote fica no MESMO arquivo allowlisted da Fase 7A
 * (`apps/admin/src/server/editorial-actions.ts`). Esta guarda afirma que:
 *   - as Server Actions de lote existem so nesse arquivo;
 *   - a escrita em lote usa `.update(` por item — NUNCA `updateMany`/create/
 *     delete/upsert/raw (em lugar nenhum do admin);
 *   - o arquivo chama `canRunEditorialAction` (gate da flag) antes de escrever;
 *   - nenhum campo NAO editorial vira chave de `data:` (title/slug/body/content/
 *     publishedAt/licenseStatus/displayAllowed).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ACTIONS_FILE = resolve(
  process.cwd(),
  "apps",
  "admin",
  "src",
  "server",
  "editorial-actions.ts",
);
const ADMIN_DIRS = [
  resolve(process.cwd(), "apps", "admin", "src"),
  resolve(process.cwd(), "apps", "admin", "app"),
];
const ACTIONS_REL = "apps/admin/src/server/editorial-actions.ts";
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Metodos que NUNCA podem aparecer no admin (nem em lote): so `.update(` e permitido. */
const BULK_FORBIDDEN_METHODS = [
  ".updateMany(",
  ".createMany(",
  ".deleteMany(",
  ".create(",
  ".delete(",
  ".upsert(",
  ".updateManyAndReturn(",
  ".createManyAndReturn(",
  "$executeRaw",
  ".$executeRawUnsafe(",
  ".$queryRawUnsafe(",
];

/** Campos NAO editoriais proibidos como chave de `data:` (7A + 7C). */
const FORBIDDEN_DATA_KEYS = [
  "title",
  "slug",
  "body",
  "content",
  "publishedAt",
  "licenseStatus",
  "displayAllowed",
];

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

async function collectCodeFiles(dir: string): Promise<string[]> {
  if (!(await pathExists(dir))) return [];
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...(await collectCodeFiles(full)));
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function relPosix(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/");
}

describe("acoes em lote: superficie minima no arquivo allowlisted (Fase 7C)", () => {
  let code = "";

  beforeAll(async () => {
    code = stripComments(await readFile(ACTIONS_FILE, "utf-8"));
  });

  it("as Server Actions de lote existem no arquivo allowlisted", () => {
    expect(code).toContain("export async function runBulkArticleEditorialAction");
    expect(code).toContain("export async function runBulkContentBlockEditorialAction");
  });

  it("chama canRunEditorialAction (gate da flag) e nunca updateMany", () => {
    expect(code).toContain("canRunEditorialAction");
    for (const method of BULK_FORBIDDEN_METHODS) {
      expect(code.includes(method), `metodo proibido no arquivo de acoes: ${method}`).toBe(false);
    }
    expect(code.includes(".update("), "esperava .update( (escrita por item)").toBe(true);
  });

  it("escreve so em articleTranslation e contentBlock", () => {
    expect(code).toContain("prisma.articleTranslation.update(");
    expect(code).toContain("prisma.contentBlock.update(");
  });

  it("nao muta campo nao editorial como chave de data (incl. licenseStatus/displayAllowed)", () => {
    for (const key of FORBIDDEN_DATA_KEYS) {
      expect(new RegExp(`\\b${key}\\s*:`).test(code), `campo proibido mutado: ${key}:`).toBe(false);
    }
    // Os unicos campos mutados sao os editoriais.
    expect(/\breviewStatus\s*:/.test(code)).toBe(true);
    expect(/\bindexStatus\s*:/.test(code)).toBe(true);
  });
});

describe("nenhum updateMany/createMany/deleteMany em todo o admin", () => {
  it("apenas .update( por item; nenhuma escrita em massa fora do allowlist", async () => {
    const offenders: string[] = [];
    for (const dir of ADMIN_DIRS) {
      for (const file of await collectCodeFiles(dir)) {
        const rel = relPosix(file);
        const content = stripComments(await readFile(file, "utf-8"));
        for (const method of BULK_FORBIDDEN_METHODS) {
          if (content.includes(method)) offenders.push(`${rel}: ${method}`);
        }
        // `.update(` so no arquivo de acoes.
        if (rel !== ACTIONS_REL && content.includes(".update(")) {
          offenders.push(`${rel}: .update( fora do allowlist`);
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
