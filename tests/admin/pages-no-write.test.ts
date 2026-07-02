/**
 * Guarda de UI read-only do admin editorial.
 *
 * Varre `apps/admin/app` e afirma que as telas nao expoem NENHUMA acao de
 * escrita: sem <form>, sem controles de entrada, sem botao de Publicar/Salvar/
 * Excluir. Tambem exige o aviso "Modo somente leitura" na tela inicial.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const APP_DIR = resolve(process.cwd(), "apps", "admin", "app");
const DASHBOARD_PAGE = resolve(APP_DIR, "page.tsx");
const CODE_EXTENSIONS = [".ts", ".tsx", ".jsx", ".js"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Elementos interativos de escrita proibidos em um admin read-only. */
const FORBIDDEN_ELEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/<form\b/i, "<form>"],
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/<select\b/i, "<select>"],
  [/<button\b/i, "<button>"],
];

/** Rotulos de acao de escrita proibidos (botoes de publicar/salvar/excluir). */
const FORBIDDEN_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\bPublicar\b/i, "Publicar"],
  [/\bSalvar\b/i, "Salvar"],
  [/\bExcluir\b/i, "Excluir"],
  [/\bDeletar\b/i, "Deletar"],
];

interface Violation {
  file: string;
  rule: string;
  line: number;
  snippet: string;
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
 * Neutraliza comentarios de bloco e de linha preservando o numero de linhas,
 * para a guarda mirar apenas o codigo/JSX real — nao a prosa de documentacao
 * (que legitimamente cita "publicar/salvar/excluir").
 */
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

async function findViolations(): Promise<Violation[]> {
  if (!(await pathExists(APP_DIR))) return [];
  const files = await collectCodeFiles(APP_DIR);
  const violations: Violation[] = [];
  for (const file of files) {
    const content = stripComments(await readFile(file, "utf-8"));
    content.split(/\r?\n/).forEach((line, index) => {
      for (const [pattern, rule] of [...FORBIDDEN_ELEMENTS, ...FORBIDDEN_LABELS]) {
        if (pattern.test(line)) {
          violations.push({
            file: relative(process.cwd(), file),
            rule,
            line: index + 1,
            snippet: line.trim(),
          });
        }
      }
    });
  }
  return violations;
}

describe("admin editorial nao expoe UI de escrita/publicacao", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao contem <form> nem controles de entrada", () => {
    const offenders = violations.filter((v) => v.rule.startsWith("<"));
    expect(
      offenders,
      `Admin read-only nao pode ter UI de escrita. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('nao contem botao "Publicar", "Salvar" nem "Excluir"', () => {
    const offenders = violations.filter((v) => !v.rule.startsWith("<"));
    expect(
      offenders,
      `Admin read-only nao pode oferecer acoes de escrita. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('a tela inicial exibe "Modo somente leitura"', async () => {
    expect(await pathExists(DASHBOARD_PAGE)).toBe(true);
    const content = await readFile(DASHBOARD_PAGE, "utf-8");
    expect(content).toContain("Modo somente leitura");
  });
});

/**
 * Fase 6C: a nova pagina `/security` e diagnostico read-only — nao pode
 * introduzir `<form>`/controle de entrada/`<button>` nem rotulo de escrita.
 */
describe("Fase 6C: a pagina /security nao introduz UI de escrita", () => {
  const SECURITY_PAGE = resolve(APP_DIR, "security", "page.tsx");

  it("existe e nao contem elemento de escrita nem rotulo perigoso", async () => {
    expect(await pathExists(SECURITY_PAGE)).toBe(true);
    const code = stripComments(await readFile(SECURITY_PAGE, "utf-8"));
    for (const [pattern, rule] of [...FORBIDDEN_ELEMENTS, ...FORBIDDEN_LABELS]) {
      expect(pattern.test(code), `pagina /security nao pode conter ${rule}`).toBe(false);
    }
  });

  it('exibe o titulo "Segurança do Admin"', async () => {
    const content = await readFile(SECURITY_PAGE, "utf-8");
    expect(content).toContain("Segurança do Admin");
  });
});
