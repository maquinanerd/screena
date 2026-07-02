/**
 * Guarda contra superficies de ESCRITA no servidor do admin editorial.
 *
 * Complementa as guardas existentes:
 *  - readonly-guard.test.ts  -> metodos de escrita do Prisma;
 *  - pages-no-write.test.ts  -> <form>, controles de entrada e botoes
 *    Publicar/Salvar/Excluir na UI (apps/admin/app).
 *
 * Aqui travamos as duas superficies de escrita do App Router que um admin
 * SOMENTE LEITURA nunca deve expor:
 *
 *  1. Route handlers de escrita: nenhum arquivo `route.*` sob `apps/admin/app`
 *     pode exportar POST/PUT/PATCH/DELETE (handlers GET de leitura seriam
 *     aceitos, mas os verbos de mutacao nao).
 *  2. Server Actions: nenhuma diretiva "use server" em `apps/admin/app` nem em
 *     `apps/admin/src` — server actions sao um canal de mutacao que este admin
 *     nao possui.
 *
 * NOTA DE ESCOPO: esta fase NAO cria autenticacao/login. Estas guardas travam a
 * SUPERFICIE de escrita; a protecao de ACESSO ao admin (auth/sessao/autorizacao)
 * e uma FASE SEPARADA e nao foi implementada aqui.
 *
 * Se um dia esta guarda falhar, a correcao e remover a escrita — nunca relaxar a
 * regra.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const SRC_DIR = resolve(process.cwd(), "apps", "admin", "src");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const ROUTE_BASENAMES = new Set(CODE_EXTENSIONS.map((ext) => `route${ext}`));
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Verbos HTTP de mutacao proibidos em route handlers de um admin read-only. */
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

/**
 * Neutraliza comentarios de bloco e de linha preservando o texto restante, para
 * mirar apenas codigo real — a prosa de documentacao pode citar legitimamente
 * "use server" ou os verbos HTTP.
 */
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

/**
 * Detecta exports de verbos de mutacao em um route handler. Cobre as tres formas
 * de export do App Router: `export function POST`, `export const POST =` e
 * `export { ... POST ... }`. Puro: recebe conteudo, devolve os verbos achados.
 */
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
      violations.push({
        file: relative(process.cwd(), file),
        rule: `route handler de escrita: export ${method}`,
      });
    }
  }

  // 2. Diretiva "use server" (server actions) sob app + src.
  const serverActionScan = [...(await collectCodeFiles(APP_DIR)), ...(await collectCodeFiles(SRC_DIR))];
  for (const file of serverActionScan) {
    if (hasUseServerDirective(await readFile(file, "utf-8"))) {
      violations.push({
        file: relative(process.cwd(), file),
        rule: 'diretiva "use server" (server action)',
      });
    }
  }

  return violations;
}

describe("admin editorial nao expoe superficie de escrita no servidor", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao tem route handler exportando POST/PUT/PATCH/DELETE", () => {
    const offenders = violations.filter((v) => v.rule.startsWith("route handler"));
    expect(
      offenders,
      `Admin read-only nao pode expor endpoint de escrita. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('nao tem diretiva "use server" (server actions) em app nem em src', () => {
    const offenders = violations.filter((v) => v.rule.startsWith("diretiva"));
    expect(
      offenders,
      `Admin read-only nao pode ter server actions. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("ha codigo real do admin para varrer (guarda nao e vacua)", async () => {
    expect(await pathExists(APP_DIR)).toBe(true);
    const files = await collectCodeFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(0);
  });
});

/**
 * Auto-teste dos detectores puros: garante que as regexes realmente pegam as
 * formas de export perigosas e a diretiva de server action, e que leitura
 * legitima (GET, funcao nao exportada) nao dispara falso positivo.
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
    // Comentario citando o verbo nao conta.
    expect(detectWriteMethodExports("// export async function POST removido")).toEqual([]);
  });

  it('detecta a diretiva "use server" em aspas simples e duplas', () => {
    expect(hasUseServerDirective('"use server";\nexport async function act() {}')).toBe(true);
    expect(hasUseServerDirective("'use server'")).toBe(true);
    expect(hasUseServerDirective("async function act() {\n  'use server'\n}")).toBe(true);
  });

  it('nao acusa "use server" em comentario nem em texto solto', () => {
    expect(hasUseServerDirective("// use server (proibido nesta fase)")).toBe(false);
    expect(hasUseServerDirective("/* use server */")).toBe(false);
    expect(hasUseServerDirective("const label = 'use server side rendering'")).toBe(false);
  });
});

/**
 * Fase 6C: a nova rota `/security` e read-only — nao pode criar route handler de
 * escrita nem server action. Reforca explicitamente a guarda recursiva acima.
 */
describe("Fase 6C: a rota /security nao introduz superficie de escrita", () => {
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
