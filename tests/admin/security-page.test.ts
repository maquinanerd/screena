/**
 * Guarda estrutural da pagina interna de SEGURANCA do admin
 * (`apps/admin/app/security/page.tsx`).
 *
 * A pagina e um diagnostico read-only: mostra o estado da protecao de acesso e o
 * checklist de env vars pelos NOMES — nunca valores, nunca segredos. Este teste
 * afirma, por leitura do fonte, que ela:
 *   - existe e tem o titulo "Segurança do Admin";
 *   - nao le env sensivel direto no JSX (`process.env.ADMIN_BASIC_AUTH_PASSWORD`);
 *   - nao le/mostra o segredo de conexao (`process.env.DATABASE_URL`);
 *   - nao tem `<form>` nem botao de escrita (publicar/salvar/excluir);
 *   - nao importa Prisma, nao chama `fetch`, nao e um route handler;
 *   - delega a leitura de ambiente ao helper server-only.
 *
 * Comentarios sao neutralizados antes das checagens de codigo para evitar falso
 * positivo (a prosa cita legitimamente Authorization/DATABASE_URL ao descrever o
 * que a pagina NAO faz).
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

const SECURITY_PAGE = resolve(process.cwd(), "apps", "admin", "app", "security", "page.tsx");
const SECURITY_DIR = resolve(process.cwd(), "apps", "admin", "app", "security");
const SECURITY_SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "security.ts");

/** Neutraliza comentarios (bloco e linha), preservando o resto. */
function stripComments(content: string): string {
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("pagina de seguranca do admin (read-only, sem segredo)", () => {
  let raw = "";
  let code = "";

  beforeAll(async () => {
    raw = await readFile(SECURITY_PAGE, "utf-8");
    code = stripComments(raw);
  });

  it("existe em apps/admin/app/security/page.tsx", async () => {
    expect(await pathExists(SECURITY_PAGE)).toBe(true);
  });

  it('tem o titulo "Segurança do Admin"', () => {
    expect(raw).toContain("Segurança do Admin");
  });

  it("nao le env sensivel direto no JSX (ADMIN_BASIC_AUTH_PASSWORD / _USER)", () => {
    expect(code).not.toContain("process.env.ADMIN_BASIC_AUTH_PASSWORD");
    expect(code).not.toContain("process.env.ADMIN_BASIC_AUTH_USER");
    // a leitura de env fica no helper server-only:
    expect(code).not.toContain("process.env");
  });

  it("nao le/mostra o segredo de conexao do banco (DATABASE_URL)", () => {
    expect(code).not.toContain("process.env.DATABASE_URL");
    expect(code).not.toContain("DATABASE_URL");
  });

  it("nao expoe cabecalho Authorization no codigo", () => {
    expect(code.toLowerCase()).not.toContain("authorization");
  });

  it("nao tem <form> nem controle de entrada nem <button>", () => {
    expect(code).not.toMatch(/<form\b/i);
    expect(code).not.toMatch(/<input\b/i);
    expect(code).not.toMatch(/<textarea\b/i);
    expect(code).not.toMatch(/<select\b/i);
    expect(code).not.toMatch(/<button\b/i);
  });

  it("nao tem botao/rotulo de escrita (Publicar/Salvar/Excluir/Deletar)", () => {
    expect(code).not.toMatch(/\bPublicar\b/i);
    expect(code).not.toMatch(/\bSalvar\b/i);
    expect(code).not.toMatch(/\bExcluir\b/i);
    expect(code).not.toMatch(/\bDeletar\b/i);
  });

  it("nao importa Prisma nem @screena/db", () => {
    expect(code).not.toMatch(/@prisma\/client/);
    expect(code).not.toMatch(/@screena\/db/);
    expect(code).not.toMatch(/PrismaClient/);
  });

  it("nao chama fetch (zero rede no render)", () => {
    expect(code).not.toMatch(/\bfetch\s*\(/);
  });

  it("nao e um route handler (sem export de verbo HTTP)", () => {
    expect(code).not.toMatch(/export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b/);
    expect(code).not.toMatch(/export\s+(?:const|let|var)\s+(?:GET|POST|PUT|PATCH|DELETE)\b/);
  });

  it("nao tem diretiva 'use server' (server action)", () => {
    expect(code).not.toMatch(/["']use server["']/);
  });

  it("delega a leitura de ambiente ao helper server-only", () => {
    expect(code).toContain("getAdminSecurityDiagnostics");
    expect(code).toContain("src/server/security");
  });

  it("nao existe route.* dentro de app/security (so page)", async () => {
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
      expect(await pathExists(resolve(SECURITY_DIR, `route${ext}`))).toBe(false);
    }
  });

  /**
   * Fase 7A: a pagina passa a mostrar o STATUS da feature flag de acoes
   * editoriais — o estado derivado (habilitadas/definida?), NUNCA o valor da env.
   */
  it("exibe o estado das acoes editoriais (Fase 7A) via diagnostico derivado", () => {
    expect(raw).toContain("Acoes editoriais");
    expect(code).toContain("editorialActions");
  });

  it("nao le a env da flag no JSX nem imprime o valor de ADMIN_EDITORIAL_ACTIONS_ENABLED", () => {
    // A leitura fica no helper server-only; a pagina consome so booleans derivados.
    expect(code).not.toContain("process.env.ADMIN_EDITORIAL_ACTIONS_ENABLED");
    expect(code).not.toContain("process.env");
    // O nome da env pode aparecer (via envKey), mas nunca uma comparacao de valor.
    expect(code).not.toContain('=== "true"');
  });
});

/**
 * Fase 7A: o helper server-only de seguranca surfaca o STATUS da flag de acoes
 * editoriais (so boolean/nome), sem devolver o valor da env.
 */
describe("helper de seguranca surfaca o status da flag de acoes editoriais", () => {
  it("importa getEditorialActionsStatus e expoe editorialActions", async () => {
    const server = await readFile(SECURITY_SERVER, "utf-8");
    expect(server).toContain("getEditorialActionsStatus");
    expect(server).toContain("editorialActions");
  });
});
