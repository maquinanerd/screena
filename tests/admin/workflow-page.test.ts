/**
 * Guarda estrutural da pagina de WORKFLOW (/workflow, Fase 7C).
 *
 * Afirma que a pagina existe, tem "Workflow editorial", linka para fila/detalhe,
 * renderiza o painel de acao em lote, e NAO expoe editor/upload/Excluir/Publicar
 * automatico nem segredo.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PAGE = resolve(process.cwd(), "apps", "admin", "app", "workflow", "page.tsx");

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

const FORBIDDEN_EDIT: ReadonlyArray<[RegExp, string]> = [
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/type=["']file["']/i, "upload"],
  [/\bupload\b/i, "upload"],
  [/contenteditable/i, "rich text"],
  [/\b(?:quill|tinymce|draft-js|prosemirror|ckeditor|lexical|@tiptap|slate-react)\b/i, "rich text lib"],
];

const FORBIDDEN_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\bExcluir\b/, "Excluir"],
  [/\bDeletar\b/, "Deletar"],
  [/\bPublicar\b/, "Publicar"],
  [/\bSalvar\b/, "Salvar"],
];

describe("pagina de workflow editorial (Fase 7C)", () => {
  it("existe e contem \"Workflow editorial\"", async () => {
    expect(await pathExists(WORKFLOW_PAGE)).toBe(true);
    const raw = await readFile(WORKFLOW_PAGE, "utf-8");
    expect(raw).toContain("Workflow editorial");
  });

  it("linka para a fila de revisao, o QA (Fase 7D) e o detalhe (Revisar)", async () => {
    const code = stripComments(await readFile(WORKFLOW_PAGE, "utf-8"));
    expect(code).toContain("/review-queue");
    expect(code).toContain("/qa");
    expect(code).toContain("Revisar");
  });

  it("renderiza o painel de acao em lote (BulkActionPanel)", async () => {
    const code = stripComments(await readFile(WORKFLOW_PAGE, "utf-8"));
    expect(code).toContain("BulkActionPanel");
  });

  it("nao contem editor/upload/rich-text/input cru na pagina", async () => {
    const code = stripComments(await readFile(WORKFLOW_PAGE, "utf-8"));
    for (const [pattern, label] of FORBIDDEN_EDIT) {
      expect(pattern.test(code), `workflow page contem ${label}`).toBe(false);
    }
  });

  it("nao contem rotulo Excluir/Deletar/Publicar/Salvar", async () => {
    const code = stripComments(await readFile(WORKFLOW_PAGE, "utf-8"));
    for (const [pattern, label] of FORBIDDEN_LABELS) {
      expect(pattern.test(code), `workflow page contem ${label}`).toBe(false);
    }
  });

  it("nao vaza segredo no render", async () => {
    const code = stripComments(await readFile(WORKFLOW_PAGE, "utf-8"));
    expect(code.toLowerCase()).not.toContain("authorization");
    for (const secret of ["process.env", "DATABASE_URL", "ADMIN_BASIC_AUTH"]) {
      expect(code, `workflow page contem ${secret}`).not.toContain(secret);
    }
    expect(/\.(?:password|pass|senha)\b/i.test(code)).toBe(false);
  });
});
