/**
 * Guarda estrutural dos COMPONENTES de acao em lote (Fase 7C).
 *
 * Afirma que o `BulkSelectTable`/`BulkActionPanel`:
 *   - tem caixas de selecao (`<input type="checkbox" name="ids">`);
 *   - respeitam o limite 20 (via getBulkLimit);
 *   - tem `<fieldset disabled={...}>` (desativa quando a flag esta off);
 *   - tem `<select>` de valor restrito (nao texto livre);
 *   - NAO tem campo de texto livre para body/content, nem input de title/slug;
 *   - NAO tem upload, editor rich text, botao Excluir nem Publicar automatico.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PANEL = resolve(process.cwd(), "apps", "admin", "src", "components", "bulk-action-panel.tsx");
const TABLE = resolve(process.cwd(), "apps", "admin", "src", "components", "bulk-select-table.tsx");

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

/** Edicao livre / upload / rich text — proibidos nos componentes de lote. */
const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/<textarea\b/i, "<textarea>"],
  [/type=["']text["']/i, 'input type="text"'],
  [/type=["']file["']/i, "upload"],
  [/name=["'](?:title|slug|body|content)["']/i, 'name="title|slug|body|content"'],
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

describe("componentes de acao em lote (Fase 7C)", () => {
  it("os componentes existem", async () => {
    expect(await pathExists(PANEL)).toBe(true);
    expect(await pathExists(TABLE)).toBe(true);
  });

  it("a tabela tem caixas de selecao (checkbox name=ids), sem texto livre", async () => {
    const code = stripComments(await readFile(TABLE, "utf-8"));
    expect(/<input\b[^>]*type=["']checkbox["']/i.test(code)).toBe(true);
    expect(code).toContain('name="ids"');
  });

  it("o painel tem <form>, <select> de valor, fieldset disabled e limite via getBulkLimit", async () => {
    const code = stripComments(await readFile(PANEL, "utf-8"));
    expect(/<form\b/i.test(code)).toBe(true);
    expect(/<select\b/i.test(code)).toBe(true);
    expect(code).toContain('name="value"');
    expect(/<fieldset\b[^>]*disabled=/i.test(code)).toBe(true);
    expect(code).toContain("getBulkLimit");
    expect(code).toContain("Aplicar"); // botao "Aplicar ação"
  });

  it("nenhum componente tem texto livre/upload/rich-text nem campo title/slug/body/content", async () => {
    for (const file of [PANEL, TABLE]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const [pattern, label] of FORBIDDEN) {
        expect(pattern.test(code), `${file} contem ${label}`).toBe(false);
      }
    }
  });

  it("nenhum componente tem botao Excluir/Deletar/Publicar/Salvar", async () => {
    for (const file of [PANEL, TABLE]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const [pattern, label] of FORBIDDEN_LABELS) {
        expect(pattern.test(code), `${file} contem rotulo ${label}`).toBe(false);
      }
    }
  });
});
