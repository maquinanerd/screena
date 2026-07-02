/**
 * Guarda contra "login falso" / superficie de autenticacao no admin editorial.
 *
 * A Fase 6B adiciona SO um portao Basic Auth stateless (middleware + helper
 * puro). Ela NAO cria — e esta guarda garante que ninguem introduza por engano:
 *   - pagina ou rota de login/signin/logout/register;
 *   - import de biblioteca de auth/sessao/JWT/OAuth (next-auth, jsonwebtoken,
 *     jose, iron-session, passport, bcrypt, argon2, clerk, lucia, ...);
 *   - estado de sessao/cookie/JWT (Basic Auth e stateless).
 *
 * NOTA (Fase 7A): esta guarda NAO trava mais `<form>` nem `"use server"` — a Fase
 * 7A introduziu, de proposito, `<form>`/`<select>` no componente de acao editorial
 * e UMA `"use server"` no arquivo allowlisted. Essas superficies sao travadas
 * (com allowlist) por `pages-no-write`, `no-server-writes` e `readonly-guard`.
 * Aqui o foco permanece: NENHUM login/sessao/JWT/OAuth (Fase 6B/6C = so Basic Auth).
 *
 * Complementa (nao substitui): `readonly-guard`, `pages-no-write`,
 * `no-server-writes`, `editorial-actions-guard` e `access-protection`.
 *
 * Se um dia esta guarda falhar, a correcao e remover a superficie de login/auth
 * complexa — nunca relaxar a regra. Protecao de acesso completa (usuarios,
 * sessao, permissoes) e uma fase futura, decidida por humano, com seu proprio
 * escopo/schema/revisao.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const SRC_DIR = resolve(process.cwd(), "apps", "admin", "src");
const MIDDLEWARE_FILE = resolve(process.cwd(), "apps", "admin", "middleware.ts");
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Prefixos de modulo de auth/sessao/JWT/OAuth proibidos nesta fase. */
const FORBIDDEN_AUTH_MODULES: readonly string[] = [
  "next-auth",
  "@auth/",
  "@clerk",
  "@lucia-auth",
  "lucia",
  "jsonwebtoken",
  "jose",
  "iron-session",
  "passport",
  "bcrypt",
  "bcryptjs",
  "argon2",
  "oauth",
  "openid-client",
];

/**
 * Estado de sessao/cookie/JWT — proibido: o Basic Auth desta fase e stateless.
 * Casamos por SUBSTRING (case-insensitive) de proposito: sao termos de auth de
 * alto sinal (inclusive nas formas camelCase `getSession`/`signJwt`), com
 * colisao inocente implausivel em identificadores TS. Comentarios sao removidos
 * antes da varredura, entao a prosa que descreve o que a fase NAO faz nao conta.
 */
const STATEFUL_AUTH_TOKENS: ReadonlyArray<[RegExp, string]> = [
  [/cookie/i, "cookie"],
  [/session/i, "session"],
  [/jwt/i, "jwt"],
  [/localstorage/i, "localStorage"],
];

/** Segmento de rota/pagina de login proibido no caminho do arquivo. */
const LOGIN_ROUTE_SEGMENT = /(?:^|[\\/])(login|sign-?in|sign-?up|log-?out|register)(?:[\\/]|\.|$)/i;

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
 * Neutraliza comentarios (bloco e linha) preservando o restante, para mirar so
 * codigo real — a prosa de documentacao cita legitimamente "cookie/sessao/JWT"
 * ao descrever o que a fase NAO faz.
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

/** Modulos de auth proibidos citados em import/require/from (stripado). Puro. */
export function importsForbiddenAuthModule(content: string): string[] {
  const code = stripComments(content);
  const found: string[] = [];
  for (const mod of FORBIDDEN_AUTH_MODULES) {
    if (code.includes(`"${mod}`) || code.includes(`'${mod}`) || code.includes("`" + mod)) {
      found.push(mod);
    }
  }
  return found;
}

/** Tokens de estado de sessao/cookie/JWT (stripado). Puro. */
export function findStatefulAuthTokens(content: string): string[] {
  const code = stripComments(content);
  return STATEFUL_AUTH_TOKENS.filter(([re]) => re.test(code)).map(([, label]) => label);
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];

  const appFiles = await collectCodeFiles(APP_DIR);
  const srcFiles = await collectCodeFiles(SRC_DIR);
  const middlewareFiles = (await pathExists(MIDDLEWARE_FILE)) ? [MIDDLEWARE_FILE] : [];
  const adminCodeFiles = [...appFiles, ...srcFiles, ...middlewareFiles];

  // (1) rota/pagina de login sob apps/admin/app.
  for (const file of appFiles) {
    if (LOGIN_ROUTE_SEGMENT.test(relative(process.cwd(), file))) {
      violations.push({ file: relative(process.cwd(), file), rule: "rota/pagina de login" });
    }
  }

  for (const file of adminCodeFiles) {
    const content = await readFile(file, "utf-8");
    const rel = relative(process.cwd(), file);

    // (2) import de biblioteca de auth/sessao/JWT/OAuth.
    for (const mod of importsForbiddenAuthModule(content)) {
      violations.push({ file: rel, rule: `import de auth complexa: ${mod}` });
    }

    // (3) estado de sessao/cookie/JWT (Basic Auth deve ser stateless).
    for (const token of findStatefulAuthTokens(content)) {
      violations.push({ file: rel, rule: `estado de sessao/cookie/JWT: ${token}` });
    }
  }

  return violations;
}

describe("admin nao introduz login/sessao/auth complexa (Fase 6B e so Basic Auth)", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao tem rota/pagina de login, signin, logout ou register", () => {
    const offenders = violations.filter((v) => v.rule === "rota/pagina de login");
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("nao importa biblioteca de auth/sessao/JWT/OAuth", () => {
    const offenders = violations.filter((v) => v.rule.startsWith("import de auth"));
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("nao mantem estado de sessao/cookie/JWT (Basic Auth e stateless)", () => {
    const offenders = violations.filter((v) => v.rule.startsWith("estado de sessao"));
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("ha codigo real do admin para varrer (guarda nao e vacua) e o middleware existe", async () => {
    const appFiles = await collectCodeFiles(APP_DIR);
    expect(appFiles.length).toBeGreaterThan(0);
    expect(await pathExists(MIDDLEWARE_FILE)).toBe(true);
  });
});

/**
 * Auto-teste dos detectores puros: garante que nao sao vacuos (pegam de fato as
 * formas perigosas) e que nao acusam o proprio codigo legitimo do admin.
 */
describe("detectores de login/auth funcionam (nao sao vacuos)", () => {
  it("detecta imports de auth complexa e ignora comentario", () => {
    expect(importsForbiddenAuthModule('import NextAuth from "next-auth";')).toContain("next-auth");
    expect(importsForbiddenAuthModule("import { sign } from 'jsonwebtoken'")).toContain(
      "jsonwebtoken",
    );
    expect(importsForbiddenAuthModule('const j = require("jose")')).toContain("jose");
    expect(importsForbiddenAuthModule('// import NextAuth from "next-auth"')).toEqual([]);
  });

  it("detecta estado de sessao/cookie/JWT e ignora comentario", () => {
    expect(findStatefulAuthTokens('cookies().set("sid", value)')).toContain("cookie");
    expect(findStatefulAuthTokens("const s = getSession()")).toContain("session");
    expect(findStatefulAuthTokens("const t = signJwt(payload)")).toContain("jwt");
    expect(findStatefulAuthTokens("// sem cookie, sem session, sem jwt")).toEqual([]);
  });

  it("nao acusa o vocabulario legitimo do Basic Auth (authorization/Basic)", () => {
    const sample = 'request.headers.get("authorization"); // Basic Auth stateless';
    expect(importsForbiddenAuthModule(sample)).toEqual([]);
    expect(findStatefulAuthTokens(sample)).toEqual([]);
  });
});

/**
 * Fase 6C (production-readiness): a nova superficie de seguranca (pagina interna
 * de diagnostico + helper server-only) NAO pode introduzir login/sessao/auth
 * complexa. Reforca a guarda recursiva acima mirando explicitamente os arquivos
 * novos.
 */
describe("Fase 6C: superficie de seguranca continua stateless (sem login/sessao)", () => {
  const SECURITY_PAGE = resolve(process.cwd(), "apps", "admin", "app", "security", "page.tsx");
  const SECURITY_SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "security.ts");
  const SECURITY_DIR = resolve(process.cwd(), "apps", "admin", "app", "security");

  it("pagina e helper de seguranca existem", async () => {
    expect(await pathExists(SECURITY_PAGE)).toBe(true);
    expect(await pathExists(SECURITY_SERVER)).toBe(true);
  });

  it("nao importam auth complexa nem mantem estado de sessao/cookie/JWT", async () => {
    for (const file of [SECURITY_PAGE, SECURITY_SERVER]) {
      const content = await readFile(file, "utf-8");
      expect(importsForbiddenAuthModule(content)).toEqual([]);
      expect(findStatefulAuthTokens(content)).toEqual([]);
    }
  });

  it("nao ha rota de login nem route handler dentro de app/security", async () => {
    expect(LOGIN_ROUTE_SEGMENT.test("apps/admin/app/security/page.tsx")).toBe(false);
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
      expect(await pathExists(join(SECURITY_DIR, `route${ext}`))).toBe(false);
    }
  });
});
