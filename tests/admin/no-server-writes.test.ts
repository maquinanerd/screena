/**
 * Guarda das superficies de ESCRITA no servidor do admin editorial (Fase 7A).
 *
 * A partir da Fase 7A o admin tem UMA superficie de escrita: Server Actions no
 * arquivo allowlisted `apps/admin/src/server/editorial-actions.ts`. Esta guarda
 * trava tudo o mais:
 *
 *  1. Route handlers de escrita: nenhum `route.*` sob `apps/admin/app` pode
 *     exportar POST/PUT/PATCH/DELETE (nao usamos route handlers — a decisao de
 *     projeto foi Server Actions; handlers GET de leitura seriam ok, verbos de
 *     mutacao nunca).
 *  2. Server Actions (`"use server"`): permitido SOMENTE no arquivo allowlisted.
 *     Qualquer outra `"use server"` em `apps/admin/app`/`apps/admin/src` e
 *     violacao (paginas e componentes nao viram canal de mutacao).
 *
 * Complementa `readonly-guard` (metodos Prisma) e `pages-no-write` (UI). Se um dia
 * falhar, remova a superficie indevida — nunca relaxe a regra.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const SRC_DIR = resolve(process.cwd(), "apps", "admin", "src");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const ROUTE_BASENAMES = new Set(CODE_EXTENSIONS.map((ext) => `route${ext}`));
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Unico arquivo autorizado a ter `"use server"` (Server Actions). Posix. */
const USE_SERVER_ALLOWLIST_FILE = "apps/admin/src/server/editorial-actions.ts";

/** Verbos HTTP de mutacao proibidos em route handlers do admin. */
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

interface Violation {
  file: string;
  rule: string;
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

/** Neutraliza comentarios de bloco e de linha (a prosa pode citar os verbos). */
export function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue; // parte de '://'
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

/** Detecta exports de verbos de mutacao (as tres formas do App Router). Puro. */
export function detectWriteMethodExports(content: string): string[] {
  const code = stripComments(content);
  const found: string[] = [];
  for (const method of WRITE_METHODS) {
    const patterns = [
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+(?:const|let|var)\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ];
    if (patterns.some((re) => re.test(code))) found.push(method);
  }
  return found;
}

/** Detecta a diretiva "use server" (server actions). Puro. */
export function hasUseServerDirective(content: string): boolean {
  return /["']use server["']/.test(stripComments(content));
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];

  // 1. Route handlers de escrita sob apps/admin/app.
  for (const file of await collectCodeFiles(APP_DIR)) {
    if (!ROUTE_BASENAMES.has(basename(file))) continue;
    const methods = detectWriteMethodExports(await readFile(file, "utf-8"));
    for (const method of methods) {
      violations.push({ file: relPosix(file), rule: `route handler de escrita: export ${method}` });
    }
  }

  // 2. Diretiva "use server" fora do arquivo allowlisted.
  const scan = [...(await collectCodeFiles(APP_DIR)), ...(await collectCodeFiles(SRC_DIR))];
  for (const file of scan) {
    const rel = relPosix(file);
    if (rel === USE_SERVER_ALLOWLIST_FILE) continue;
    if (hasUseServerDirective(await readFile(file, "utf-8"))) {
      violations.push({ file: rel, rule: 'diretiva "use server" fora do allowlist' });
    }
  }

  return violations;
}

describe("admin editorial: superficie de escrita no servidor so no allowlist (Fase 7A)", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao tem route handler exportando POST/PUT/PATCH/DELETE", () => {
    const offenders = violations.filter((v) => v.rule.startsWith("route handler"));
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it('so o arquivo allowlisted tem diretiva "use server"', () => {
    const offenders = violations.filter((v) => v.rule.startsWith("diretiva"));
    expect(
      offenders,
      `"use server" so pode existir em ${USE_SERVER_ALLOWLIST_FILE}. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("o arquivo allowlisted existe e realmente tem `use server` (guarda nao e vacua)", async () => {
    const abs = resolve(process.cwd(), ...USE_SERVER_ALLOWLIST_FILE.split("/"));
    expect(await pathExists(abs)).toBe(true);
    expect(hasUseServerDirective(await readFile(abs, "utf-8"))).toBe(true);
  });

  it("ha codigo real do admin para varrer (guarda nao e vacua)", async () => {
    const files = await collectCodeFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(0);
  });
});

/**
 * Auto-teste dos detectores puros.
 */
describe("detectores de escrita no servidor funcionam (nao sao vacuos)", () => {
  it("detecta as tres formas de export de verbo de mutacao", () => {
    expect(detectWriteMethodExports("export async function POST(req) {}")).toContain("POST");
    expect(detectWriteMethodExports("export function DELETE(req) {}")).toContain("DELETE");
    expect(detectWriteMethodExports("export const PUT = handler")).toContain("PUT");
    expect(detectWriteMethodExports("export { handler as PATCH }")).toContain("PATCH");
  });

  it("nao acusa handler de leitura (GET) nem funcao interna", () => {
    expect(detectWriteMethodExports("export async function GET(req) {}")).toEqual([]);
    expect(detectWriteMethodExports("function POST() {} // nao exportado")).toEqual([]);
    expect(detectWriteMethodExports("// export async function POST removido")).toEqual([]);
  });

  it('detecta a diretiva "use server" em aspas simples e duplas', () => {
    expect(hasUseServerDirective('"use server";\nexport async function act() {}')).toBe(true);
    expect(hasUseServerDirective("'use server'")).toBe(true);
  });

  it('nao acusa "use server" em comentario nem em texto solto', () => {
    expect(hasUseServerDirective("// use server (allowlist)")).toBe(false);
    expect(hasUseServerDirective("/* use server */")).toBe(false);
    expect(hasUseServerDirective("const label = 'use server side rendering'")).toBe(false);
  });
});

/**
 * A rota `/security` continua read-only — sem route handler de escrita nem
 * server action (a escrita vive so no arquivo de acoes editoriais).
 */
describe("a rota /security nao introduz superficie de escrita", () => {
  const SECURITY_DIR = resolve(process.cwd(), "apps", "admin", "app", "security");
  const SECURITY_PAGE = resolve(SECURITY_DIR, "page.tsx");
  const SECURITY_SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "security.ts");

  it("nao ha route.* dentro de app/security", async () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(await pathExists(resolve(SECURITY_DIR, `route${ext}`))).toBe(false);
    }
  });

  it("pagina e helper de seguranca nao usam server action nem exportam verbo de escrita", async () => {
    for (const file of [SECURITY_PAGE, SECURITY_SERVER]) {
      const content = await readFile(file, "utf-8");
      expect(hasUseServerDirective(content)).toBe(false);
      expect(detectWriteMethodExports(content)).toEqual([]);
    }
  });
});

/**
 * Fase 7B: a fila de revisao (/review-queue), o helper `review-queue.ts` e o lib
 * `public-readiness.ts` NAO introduzem superficie de escrita — sem route handler,
 * sem "use server", sem verbo de mutacao.
 */
describe("Fase 7B: preview publico e fila de revisao nao escrevem", () => {
  const QUEUE_DIR = resolve(process.cwd(), "apps", "admin", "app", "review-queue");
  const QUEUE_PAGE = resolve(QUEUE_DIR, "page.tsx");
  const QUEUE_HELPER = resolve(process.cwd(), "apps", "admin", "src", "server", "review-queue.ts");
  const READINESS_LIB = resolve(process.cwd(), "apps", "admin", "src", "lib", "public-readiness.ts");

  it("nao ha route.* dentro de app/review-queue", async () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
      expect(await pathExists(resolve(QUEUE_DIR, `route${ext}`))).toBe(false);
    }
  });

  it("page, helper e lib nao usam server action nem exportam verbo de escrita", async () => {
    for (const file of [QUEUE_PAGE, QUEUE_HELPER, READINESS_LIB]) {
      const content = await readFile(file, "utf-8");
      expect(hasUseServerDirective(content)).toBe(false);
      expect(detectWriteMethodExports(content)).toEqual([]);
    }
  });
});
