/**
 * Guarda textual contra VAZAMENTO DE SEGREDO nas superficies do admin.
 *
 * Duas fronteiras:
 *  1. `apps/admin/app` (render): nenhuma pagina pode ler env sensivel direto no
 *     JSX nem imprimir segredo. Proibido: `process.env.ADMIN_BASIC_AUTH_PASSWORD`
 *     (e `_USER`), `process.env.DATABASE_URL`, o cabecalho `Authorization`,
 *     qualquer `NEXT_PUBLIC_ADMIN*` (auth NUNCA via NEXT_PUBLIC) e renderizar um
 *     campo de senha (`.password`/`.pass`/`.senha`). A leitura de env sensivel
 *     deve ficar em helper/server seguro (`apps/admin/src/server`), nunca no JSX.
 *  2. `apps/admin/src/lib` (helpers puros): nenhum objeto de status/display pode
 *     carregar a senha — proibido pares `password:`/`senha:` recebendo o valor da
 *     env, ou o valor cru `env.ADMIN_BASIC_AUTH_PASSWORD/_USER` como propriedade.
 *
 * Comentarios sao neutralizados antes da varredura para nao acusar a prosa de
 * documentacao (que cita legitimamente Authorization/DATABASE_URL/senha ao
 * descrever o que o admin NAO faz). O proprio arquivo de teste nao e varrido.
 *
 * Se um dia esta guarda falhar, a correcao e remover o vazamento — nunca relaxar
 * a regra.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const LIB_DIR = resolve(process.cwd(), "apps", "admin", "src", "lib");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Substrings proibidas em qualquer arquivo de `apps/admin/app` (codigo real). */
const APP_FORBIDDEN_SUBSTRINGS: ReadonlyArray<[string, string]> = [
  ["process.env.ADMIN_BASIC_AUTH_PASSWORD", "leitura da senha no render"],
  ["process.env.ADMIN_BASIC_AUTH_USER", "leitura do usuario no render"],
  ["process.env.DATABASE_URL", "leitura do segredo de conexao no render"],
  ["NEXT_PUBLIC_ADMIN", "auth via NEXT_PUBLIC (proibido)"],
];

/** Regexes proibidas em `apps/admin/app` (codigo real). */
const APP_FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/authorization/i, "cabecalho Authorization no render"],
  [/\.(?:password|pass|senha)\b/i, "render de campo de senha"],
];

/**
 * Regexes proibidas em `apps/admin/src/lib`: objeto de status/display que
 * carrega a senha. Nao acusam presenca (`hasPassword: boolean`) nem leitura em
 * variavel local (`const expectedPass = env.ADMIN_BASIC_AUTH_PASSWORD`).
 */
const LIB_FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /:\s*(?:process\.)?env\.ADMIN_BASIC_AUTH_(?:PASSWORD|USER)\b/,
    "valor cru de credencial como propriedade de objeto",
  ],
  [/\b(?:password|senha)\s*:\s*(?:(?:process\.)?env\b|credentials?\.|expected)/i, "propriedade password/senha recebendo credencial"],
];

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

/** Neutraliza comentarios (bloco e linha) preservando o restante. Puro. */
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

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const file of await collectCodeFiles(APP_DIR)) {
    const code = stripComments(await readFile(file, "utf-8"));
    const rel = relative(process.cwd(), file);
    for (const [needle, rule] of APP_FORBIDDEN_SUBSTRINGS) {
      if (code.includes(needle)) violations.push({ file: rel, rule });
    }
    for (const [pattern, rule] of APP_FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) violations.push({ file: rel, rule });
    }
  }

  for (const file of await collectCodeFiles(LIB_DIR)) {
    const code = stripComments(await readFile(file, "utf-8"));
    const rel = relative(process.cwd(), file);
    for (const [pattern, rule] of LIB_FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) violations.push({ file: rel, rule });
    }
  }

  return violations;
}

describe("admin nao vaza segredo no render nem em objeto de status/display", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  const LIB_RULES = new Set(LIB_FORBIDDEN_PATTERNS.map(([, rule]) => rule));

  it("nenhuma pagina de apps/admin/app le env sensivel/segredo", () => {
    const offenders = violations.filter((v) => !LIB_RULES.has(v.rule));
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("nenhum helper de apps/admin/src/lib retorna senha em objeto de status/display", () => {
    const offenders = violations.filter((v) => LIB_RULES.has(v.rule));
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("nao ha nenhuma violacao (visao geral)", () => {
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it("ha codigo real para varrer, incluindo a pagina de seguranca (guarda nao e vacua)", async () => {
    const appFiles = await collectCodeFiles(APP_DIR);
    const libFiles = await collectCodeFiles(LIB_DIR);
    expect(appFiles.length).toBeGreaterThan(0);
    expect(libFiles.length).toBeGreaterThan(0);
    expect(appFiles.some((f) => f.endsWith(join("security", "page.tsx")))).toBe(true);
  });
});

/**
 * Auto-teste dos detectores: garante que pegam de fato as formas perigosas e que
 * NAO acusam o codigo legitimo do admin (presenca booleana, leitura em local).
 */
describe("detectores de vazamento funcionam (nao sao vacuos)", () => {
  const appMatches = (snippet: string): boolean => {
    const code = stripComments(snippet);
    return (
      APP_FORBIDDEN_SUBSTRINGS.some(([n]) => code.includes(n)) ||
      APP_FORBIDDEN_PATTERNS.some(([re]) => re.test(code))
    );
  };
  const libMatches = (snippet: string): boolean => {
    const code = stripComments(snippet);
    return LIB_FORBIDDEN_PATTERNS.some(([re]) => re.test(code));
  };

  it("pega vazamentos no render", () => {
    expect(appMatches("const p = process.env.ADMIN_BASIC_AUTH_PASSWORD")).toBe(true);
    expect(appMatches("const d = process.env.DATABASE_URL")).toBe(true);
    expect(appMatches('const h = req.headers.get("authorization")')).toBe(true);
    expect(appMatches("<span>{user.password}</span>")).toBe(true);
    expect(appMatches("process.env.NEXT_PUBLIC_ADMIN_PASS")).toBe(true);
  });

  it("ignora comentario e codigo legitimo no render", () => {
    expect(appMatches("// nunca process.env.ADMIN_BASIC_AUTH_PASSWORD aqui")).toBe(false);
    expect(appMatches("<td>{row.publishedAtIso}</td>")).toBe(false);
    expect(appMatches("<div>{config.credentialsConfigured}</div>")).toBe(false);
    expect(appMatches("<span>usuario, senha nunca sao exibidos</span>")).toBe(false);
  });

  it("pega senha em objeto de status/display no lib", () => {
    expect(libMatches("return { status: env.ADMIN_BASIC_AUTH_PASSWORD }")).toBe(true);
    expect(libMatches("const display = { password: credentials.pass }")).toBe(true);
    expect(libMatches("const s = { senha: env.ADMIN_BASIC_AUTH_USER }")).toBe(true);
  });

  it("ignora presenca booleana e leitura local legitima no lib", () => {
    expect(libMatches("const hasPassword = isConfigured(env.ADMIN_BASIC_AUTH_PASSWORD)")).toBe(
      false,
    );
    expect(libMatches("const expectedPass = env.ADMIN_BASIC_AUTH_PASSWORD")).toBe(false);
    expect(libMatches("ADMIN_BASIC_AUTH_PASSWORD: presenceOf(env, key)")).toBe(false);
    expect(libMatches("readonly passwordConfigured: boolean")).toBe(false);
  });
});

/**
 * Fase 7B: as superficies novas (preview publico + fila de revisao) nao vazam
 * segredo. O helper `review-queue.ts` vive em `src/server` (fora do scan padrao
 * app+src/lib), por isso e checado explicitamente aqui: sem env sensivel, sem
 * Authorization, sem DATABASE_URL, sem render de senha.
 */
describe("Fase 7B: preview e fila de revisao nao vazam segredo", () => {
  const FILES = [
    resolve(process.cwd(), "apps", "admin", "src", "server", "review-queue.ts"),
    resolve(process.cwd(), "apps", "admin", "src", "lib", "public-readiness.ts"),
    resolve(process.cwd(), "apps", "admin", "app", "review-queue", "page.tsx"),
    resolve(process.cwd(), "apps", "admin", "app", "articles", "[id]", "page.tsx"),
    resolve(process.cwd(), "apps", "admin", "app", "content-blocks", "[id]", "page.tsx"),
  ];

  it("nao contem env sensivel, Authorization, DATABASE_URL nem render de senha", async () => {
    for (const file of FILES) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code, `${file}: senha no codigo`).not.toContain(
        "process.env.ADMIN_BASIC_AUTH_PASSWORD",
      );
      expect(code, `${file}: usuario no codigo`).not.toContain("process.env.ADMIN_BASIC_AUTH_USER");
      expect(code, `${file}: DATABASE_URL`).not.toContain("process.env.DATABASE_URL");
      expect(code.toLowerCase(), `${file}: Authorization`).not.toContain("authorization");
      expect(/\.(?:password|pass|senha)\b/i.test(code), `${file}: render de senha`).toBe(false);
    }
  });
});

/**
 * Fase 7C: workflow + acoes em lote nao vazam segredo. `editorial-workflow.ts` e
 * os componentes de lote vivem fora do scan padrao (src/server, src/components);
 * o resultado de lote so carrega contagens inteiras (sem payload).
 */
describe("Fase 7C: workflow e acoes em lote nao vazam segredo", () => {
  const FILES_7C = [
    resolve(process.cwd(), "apps", "admin", "src", "server", "editorial-workflow.ts"),
    resolve(process.cwd(), "apps", "admin", "src", "lib", "editorial-bulk-policy.ts"),
    resolve(process.cwd(), "apps", "admin", "src", "components", "bulk-action-panel.tsx"),
    resolve(process.cwd(), "apps", "admin", "src", "components", "bulk-select-table.tsx"),
    resolve(process.cwd(), "apps", "admin", "app", "workflow", "page.tsx"),
  ];

  it("nao contem env sensivel, Authorization, DATABASE_URL nem render de senha", async () => {
    for (const file of FILES_7C) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code, `${file}: senha`).not.toContain("process.env.ADMIN_BASIC_AUTH_PASSWORD");
      expect(code, `${file}: usuario`).not.toContain("process.env.ADMIN_BASIC_AUTH_USER");
      expect(code, `${file}: DATABASE_URL`).not.toContain("process.env.DATABASE_URL");
      expect(code.toLowerCase(), `${file}: Authorization`).not.toContain("authorization");
      expect(/\.(?:password|pass|senha)\b/i.test(code), `${file}: render de senha`).toBe(false);
    }
  });
});

/**
 * Fase 7D: o QA editorial nao vaza segredo. `content-qa.ts` (server) vive fora do
 * scan padrao; o QA so exibe categorias/severidades/score (sem corpo/segredo).
 */
describe("Fase 7D: QA editorial nao vaza segredo", () => {
  const FILES_7D = [
    resolve(process.cwd(), "apps", "admin", "src", "server", "content-qa.ts"),
    resolve(process.cwd(), "apps", "admin", "src", "lib", "content-qa.ts"),
    resolve(process.cwd(), "apps", "admin", "app", "qa", "page.tsx"),
  ];

  it("nao contem env sensivel, Authorization, DATABASE_URL nem render de senha", async () => {
    for (const file of FILES_7D) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code, `${file}: senha`).not.toContain("process.env.ADMIN_BASIC_AUTH_PASSWORD");
      expect(code, `${file}: usuario`).not.toContain("process.env.ADMIN_BASIC_AUTH_USER");
      expect(code, `${file}: DATABASE_URL`).not.toContain("process.env.DATABASE_URL");
      expect(code.toLowerCase(), `${file}: Authorization`).not.toContain("authorization");
      expect(/\.(?:password|pass|senha)\b/i.test(code), `${file}: render de senha`).toBe(false);
    }
  });
});
