/**
 * Teste de governanca — camada de acesso a dados do app publico (invariantes 3/4).
 *
 * Trava a regra de pureza de render de @screena/web:
 *  - acesso ao PostgreSQL (`@screena/db`) e SERVER-ONLY: permitido apenas em
 *    modulos sem "use client", fora de arquivos de pagina/layout (ex.:
 *    apps/web/src/server/**);
 *  - `@screena/db` e proibido em arquivos de pagina/layout (o render le via
 *    camada de dados) e em client components ("use client");
 *  - api-clients sao proibidos em pagina/layout e em client components;
 *  - Entity Writer, SDK/client Gemini e `fetch` para host externo sao proibidos
 *    em QUALQUER arquivo de apps/web.
 *
 * As regras aqui espelham `scripts/audit/check-render-purity.mjs` (o auditor de
 * CI). Parte do teste valida a LOGICA com fixtures inline; parte varre a arvore
 * REAL de apps/web como guarda de regressao.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const WEB_DIR = resolve(process.cwd(), "apps", "web");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

const PAGE_FILE_NAMES = new Set([
  "page.tsx",
  "page.ts",
  "layout.tsx",
  "layout.ts",
  "template.tsx",
  "template.ts",
  "default.tsx",
  "default.ts",
]);

const DB_IMPORT = /\b(?:import|require)\b[^\n;]*['"`]@screena\/db(?:\/server)?['"`]/;
const API_CLIENT_IMPORT =
  /\b(?:import|require)\b[^\n;]*['"`](?:[./]*api-clients|@screena\/api-clients)[^'"`]*['"`]/;
const GEMINI_IMPORT =
  /\b(?:import|require)\b[^\n;]*['"`](?:@google\/(?:generative-ai|genai)|google-generativeai|[./]*api-clients\/gemini|@screena\/gemini-client)[^'"`]*['"`]/i;
const ENTITY_WRITER_IMPORT =
  /\b(?:import|require)\b[^\n;]*['"`](?:[./]*services\/entity-writer|@screena\/entity-writer)[^'"`]*['"`]/;
const EXTERNAL_HOSTS = [
  "tmdb",
  "themoviedb",
  "rapidapi",
  "googleapis",
  "gemini",
  "generativelanguage",
  "rottentomatoes",
  "rotten-tomatoes",
  "imdb",
];
const EXTERNAL_FETCH = new RegExp(
  String.raw`\bfetch\s*(?:<[^>]*>)?\s*\([^)\n]*(?:${EXTERNAL_HOSTS.join("|")})`,
  "i",
);

interface ScannedFile {
  /** Caminho relativo (sempre com '/') a partir da raiz do repo. */
  relPath: string;
  content: string;
}

function baseName(relPath: string): string {
  const parts = relPath.split("/");
  return (parts[parts.length - 1] ?? relPath).toLowerCase();
}

function isPageFile(relPath: string): boolean {
  return PAGE_FILE_NAMES.has(baseName(relPath));
}

/** "use client" precisa ser a primeira instrucao nao vazia/nao comentada. */
function hasUseClient(content: string): boolean {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    return /^['"]use client['"];?$/.test(line);
  }
  return false;
}

/** Remove um comentario de linha simples ('//', exceto em '://'). */
function stripLineComment(line: string): string {
  for (let i = 0; i < line.length - 1; i += 1) {
    if (line[i] === "/" && line[i + 1] === "/") {
      if (i > 0 && line[i - 1] === ":") continue;
      return line.slice(0, i);
    }
  }
  return line;
}

/** Aplica as regras de pureza de render a um arquivo; retorna nomes de violacao. */
function renderLayeringViolations(file: ScannedFile): string[] {
  const out: string[] = [];
  const page = isPageFile(file.relPath);
  const client = hasUseClient(file.content);
  const restricted = page || client;
  for (const raw of file.content.split(/\r?\n/)) {
    const line = stripLineComment(raw);
    if (line.trim() === "") continue;
    if (EXTERNAL_FETCH.test(line)) out.push("external-fetch");
    if (GEMINI_IMPORT.test(line)) out.push("gemini-import");
    if (ENTITY_WRITER_IMPORT.test(line)) out.push("entity-writer-import");
    if (restricted && DB_IMPORT.test(line)) out.push("db-in-page-or-client");
    if (restricted && API_CLIENT_IMPORT.test(line)) out.push("api-client-in-page-or-client");
  }
  return out;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...(await collectFiles(full)));
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("regra de pureza de render (fixtures)", () => {
  it("proibe @screena/db em client component", () => {
    const content = `'use client'\nimport { getPrismaClient } from "@screena/db/server";`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/components/x.tsx", content })).toContain(
      "db-in-page-or-client",
    );
  });

  it("proibe @screena/db direto em arquivo de pagina", () => {
    const content = `import { getPrismaClient } from "@screena/db/server";`;
    expect(renderLayeringViolations({ relPath: "apps/web/app/pt/filmes/[slug]/page.tsx", content })).toContain(
      "db-in-page-or-client",
    );
  });

  it("PERMITE @screena/db em modulo server-only (sem use client, fora de pagina)", () => {
    const content = `import { getPrismaClient } from "@screena/db/server";`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/server/movie-page.ts", content })).toEqual(
      [],
    );
  });

  it("proibe api-clients em client component", () => {
    const content = `"use client"\nimport { tmdb } from "../../api-clients/tmdb";`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/components/y.tsx", content })).toContain(
      "api-client-in-page-or-client",
    );
  });

  it("proibe fetch para host externo em qualquer arquivo", () => {
    const content = `const r = await fetch("https://api.themoviedb.org/3/movie/1");`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/server/movie-page.ts", content })).toContain(
      "external-fetch",
    );
  });

  it("proibe import de Gemini em qualquer arquivo", () => {
    const content = `import { GoogleGenerativeAI } from "@google/generative-ai";`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/server/movie-page.ts", content })).toContain(
      "gemini-import",
    );
  });

  it("proibe import do Entity Writer em qualquer arquivo", () => {
    const content = `import { run } from "@screena/entity-writer";`;
    expect(renderLayeringViolations({ relPath: "apps/web/src/server/movie-page.ts", content })).toContain(
      "entity-writer-import",
    );
  });
});

describe("arvore real de apps/web", () => {
  let files: ScannedFile[] = [];

  beforeAll(async () => {
    if (!(await pathExists(WEB_DIR))) return;
    const absFiles = await collectFiles(WEB_DIR);
    files = await Promise.all(
      absFiles.map(async (abs) => ({
        relPath: relative(process.cwd(), abs).split(/[\\/]/).join("/"),
        content: await readFile(abs, "utf-8"),
      })),
    );
  });

  it("nao acumula nenhuma violacao de pureza de render", () => {
    const offenders = files
      .map((file) => ({ relPath: file.relPath, rules: renderLayeringViolations(file) }))
      .filter((entry) => entry.rules.length > 0);
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("todo import de @screena/db vive em modulo server-only (src/server)", () => {
    const dbImporters = files.filter((file) =>
      file.content.split(/\r?\n/).some((line) => DB_IMPORT.test(stripLineComment(line))),
    );
    for (const file of dbImporters) {
      expect(file.relPath.includes("/src/server/"), `@screena/db fora de server-only: ${file.relPath}`).toBe(
        true,
      );
      expect(isPageFile(file.relPath)).toBe(false);
      expect(hasUseClient(file.content)).toBe(false);
    }
  });
});
