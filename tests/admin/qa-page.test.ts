/**
 * Guarda estrutural da pagina de QA (/qa, Fase 7D).
 *
 * Afirma que a pagina existe, tem "QA editorial", score, severidades, links para
 * workflow/fila/detalhe, e NAO tem form/server action/upload/editor/Excluir/
 * Publicar nem segredo.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const QA_PAGE = resolve(process.cwd(), "apps", "admin", "app", "qa", "page.tsx");

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

const FORBIDDEN_WRITE_UI: ReadonlyArray<[RegExp, string]> = [
  [/<form\b/i, "<form>"],
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/<button\b/i, "<button>"],
  [/<select\b/i, "<select>"],
  [/["']use server["']/, "use server"],
  [/type=["']file["']/i, "upload"],
  [/\bupload\b/i, "upload"],
  [/contenteditable/i, "rich text"],
];

const FORBIDDEN_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\bExcluir\b/, "Excluir"],
  [/\bDeletar\b/, "Deletar"],
  [/\bPublicar\b/, "Publicar"],
  [/\bSalvar\b/, "Salvar"],
];

describe("pagina de QA editorial (Fase 7D)", () => {
  it("existe e contem \"QA editorial\"", async () => {
    expect(await pathExists(QA_PAGE)).toBe(true);
    const raw = await readFile(QA_PAGE, "utf-8");
    expect(raw).toContain("QA editorial");
  });

  it("mostra score e severidades (critical/warning/info/success)", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    expect(code).toContain("overallScore");
    expect(code.toLowerCase()).toContain("score");
    for (const sev of ["critical", "warning", "info", "success"]) {
      expect(code, `severidade ausente: ${sev}`).toContain(sev);
    }
  });

  it("linka para workflow, fila de revisao e detalhe (Revisar)", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    expect(code).toContain("/workflow");
    expect(code).toContain("/review-queue");
    expect(code).toContain("Revisar");
  });

  it("nao tem form/input/button/select/server action/upload/editor", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    for (const [pattern, label] of FORBIDDEN_WRITE_UI) {
      expect(pattern.test(code), `qa page contem ${label}`).toBe(false);
    }
  });

  it("nao tem rotulo Excluir/Deletar/Publicar/Salvar", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    for (const [pattern, label] of FORBIDDEN_LABELS) {
      expect(pattern.test(code), `qa page contem ${label}`).toBe(false);
    }
  });

  it("nao vaza segredo no render", async () => {
    const code = stripComments(await readFile(QA_PAGE, "utf-8"));
    expect(code.toLowerCase()).not.toContain("authorization");
    for (const secret of ["process.env", "DATABASE_URL", "ADMIN_BASIC_AUTH"]) {
      expect(code).not.toContain(secret);
    }
    expect(/\.(?:password|pass|senha)\b/i.test(code)).toBe(false);
  });
});
