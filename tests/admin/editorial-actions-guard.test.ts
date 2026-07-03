/**
 * Guarda textual do arquivo de ACOES EDITORIAIS (Fase 7A).
 *
 * O admin passou a ter UMA superficie de escrita: Server Actions em
 * `apps/admin/src/server/editorial-actions.ts`. Esta guarda afirma que ESSE
 * arquivo:
 *   - existe e tem a diretiva `"use server"`;
 *   - escreve SO com `.update(` — nunca create/delete/upsert/*Many/raw;
 *   - escreve SO em `articleTranslation` e `contentBlock`;
 *   - NAO muta campo nao editorial (title/slug/body/content/publishedAt) como
 *     chave de `data:`;
 *   - le a feature flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` (gate de escrita).
 *
 * E que, por termos escolhido Server Actions (nao route handlers), NAO existe
 * nenhum `route.*` sob `apps/admin/app` exportando verbo de mutacao.
 *
 * A decisao de projeto (por que Server Actions e nao route handlers): manter tudo
 * server-only atras do middleware Basic Auth existente, sem abrir um novo endpoint
 * HTTP publico; a validacao pura fica testavel e a `"use server"` fica confinada a
 * um unico arquivo, trivial de travar.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ACTIONS_FILE = resolve(
  process.cwd(),
  "apps",
  "admin",
  "src",
  "server",
  "editorial-actions.ts",
);
const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const ROUTE_BASENAMES = new Set(CODE_EXTENSIONS.map((ext) => `route${ext}`));
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Metodos de escrita que o arquivo de acoes NAO pode conter (so `.update(`). */
const FORBIDDEN_METHODS = [
  ".create(",
  ".delete(",
  ".upsert(",
  ".createMany(",
  ".updateMany(",
  ".deleteMany(",
  ".createManyAndReturn(",
  ".updateManyAndReturn(",
  "$executeRaw",
  ".$executeRawUnsafe(",
  ".$queryRawUnsafe(",
  ".$queryRaw",
];

/** Campos NAO editoriais que nunca podem virar chave de `data:` (7A + 7C). */
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

describe("arquivo de acoes editoriais: superficie de escrita minima (Fase 7A)", () => {
  let raw = "";
  let code = "";

  beforeAll(async () => {
    raw = await readFile(ACTIONS_FILE, "utf-8");
    code = stripComments(raw);
  });

  it("existe e tem a diretiva \"use server\"", async () => {
    expect(await pathExists(ACTIONS_FILE)).toBe(true);
    expect(/["']use server["']/.test(code)).toBe(true);
  });

  it("le a feature flag ADMIN_EDITORIAL_ACTIONS_ENABLED (gate de escrita)", () => {
    expect(code).toContain("ADMIN_EDITORIAL_ACTIONS_ENABLED");
    expect(code).toContain("canRunEditorialAction");
  });

  it("escreve SO com .update( (nenhum metodo de escrita/SQL cru proibido)", () => {
    for (const method of FORBIDDEN_METHODS) {
      expect(code.includes(method), `metodo proibido encontrado: ${method}`).toBe(false);
    }
    expect(code.includes(".update("), "esperava ao menos um .update(").toBe(true);
  });

  it("escreve SO em articleTranslation e contentBlock", () => {
    expect(code).toContain("prisma.articleTranslation.update(");
    expect(code).toContain("prisma.contentBlock.update(");
    // Fase 7C: 2 tipos de alvo. `.update(` = 3 unitarios (artigo x2 + block x1) +
    // 2 em lote (artigo x1 + block x1) = 5 chamadas. Nunca updateMany.
    const updateCalls = code.split(".update(").length - 1;
    expect(updateCalls).toBe(5);
  });

  it("expoe as Server Actions de lote (Fase 7C) no mesmo arquivo allowlisted", () => {
    expect(code).toContain("export async function runBulkArticleEditorialAction");
    expect(code).toContain("export async function runBulkContentBlockEditorialAction");
  });

  it("nao muta campo nao editorial (title/slug/body/content/publishedAt) como chave de data", () => {
    for (const key of FORBIDDEN_DATA_KEYS) {
      const re = new RegExp(`\\b${key}\\s*:`);
      expect(re.test(code), `campo nao editorial mutado: ${key}:`).toBe(false);
    }
  });

  it("so muta reviewStatus e indexStatus (chaves de data permitidas)", () => {
    // As unicas chaves de data presentes sao as editoriais permitidas.
    expect(/\breviewStatus\s*:/.test(code)).toBe(true);
    expect(/\bindexStatus\s*:/.test(code)).toBe(true);
  });
});

describe("nao ha route handler de escrita (decisao: Server Actions)", () => {
  it("nenhum route.* sob apps/admin/app exporta POST/PUT/PATCH/DELETE", async () => {
    const offenders: string[] = [];
    for (const file of await collectCodeFiles(APP_DIR)) {
      if (!ROUTE_BASENAMES.has(basename(file))) continue;
      const content = stripComments(await readFile(file, "utf-8"));
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        if (new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${method}\\b`).test(content)) {
          offenders.push(`${file}: ${method}`);
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });
});
