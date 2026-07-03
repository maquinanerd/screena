/**
 * Guarda estrutural dos PREVIEWS PUBLICOS nas paginas de detalhe (Fase 7B).
 *
 * Afirma que:
 *   - article detail tem a seccao "Preview público";
 *   - content block detail tem a seccao "Preview do bloco";
 *   - NAO ha edicao de titulo/slug/corpo/conteudo (sem input/textarea/name=...);
 *   - nao ha upload, rich text, botao Excluir nem Publicar automatico;
 *   - o link publico depende SO do helper (slug/idioma), sem montar URL a mao;
 *   - nao renderiza DATABASE_URL/Authorization/segredo.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ARTICLE_DETAIL = resolve(process.cwd(), "apps", "admin", "app", "articles", "[id]", "page.tsx");
const BLOCK_DETAIL = resolve(
  process.cwd(),
  "apps",
  "admin",
  "app",
  "content-blocks",
  "[id]",
  "page.tsx",
);

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

/** Elementos/atributos de edicao livre / upload / rich text — proibidos. */
const FORBIDDEN_EDIT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/name=["'](?:title|slug|body|content)["']/i, 'name="title|slug|body|content"'],
  [/type=["']file["']/i, "upload"],
  [/\bupload\b/i, "upload"],
  [/contenteditable/i, "rich text"],
  [/\b(?:quill|tinymce|draft-js|prosemirror|ckeditor|lexical|@tiptap|slate-react)\b/i, "rich text lib"],
];

/** Rotulos de escrita proibidos. */
const FORBIDDEN_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\bExcluir\b/, "Excluir"],
  [/\bDeletar\b/, "Deletar"],
  [/\bPublicar\b/, "Publicar"],
  [/\bSalvar\b/, "Salvar"],
];

/** Substrings de segredo que nunca podem aparecer no render. */
const FORBIDDEN_SECRETS = ["process.env", "DATABASE_URL", "ADMIN_BASIC_AUTH"];

describe("preview publico nas paginas de detalhe (Fase 7B)", () => {
  it("article detail tem a seccao \"Preview público\"", async () => {
    expect(await pathExists(ARTICLE_DETAIL)).toBe(true);
    const raw = await readFile(ARTICLE_DETAIL, "utf-8");
    expect(raw).toContain("Preview público");
  });

  it("content block detail tem a seccao \"Preview do bloco\"", async () => {
    expect(await pathExists(BLOCK_DETAIL)).toBe(true);
    const raw = await readFile(BLOCK_DETAIL, "utf-8");
    expect(raw).toContain("Preview do bloco");
  });

  it("nenhuma pagina de detalhe permite edicao de texto/upload/rich text", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const [pattern, label] of FORBIDDEN_EDIT_PATTERNS) {
        expect(pattern.test(code), `${file} contem ${label}`).toBe(false);
      }
      for (const [pattern, label] of FORBIDDEN_LABELS) {
        expect(pattern.test(code), `${file} contem rotulo ${label}`).toBe(false);
      }
    }
  });

  it("o link publico vem do helper (slug/idioma), sem URL montada na pagina", async () => {
    const code = stripComments(await readFile(ARTICLE_DETAIL, "utf-8"));
    // A pagina consome readiness.publicUrl; o origin/URL vive so no helper puro.
    expect(code).toContain("readiness.publicUrl");
    expect(code).not.toContain("thescreen.media");
  });

  it("nenhuma pagina de detalhe vaza segredo no render", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL]) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code.toLowerCase()).not.toContain("authorization");
      for (const secret of FORBIDDEN_SECRETS) {
        expect(code, `${file} contem ${secret}`).not.toContain(secret);
      }
      expect(/\.(?:password|pass|senha)\b/i.test(code), `${file} render de senha`).toBe(false);
    }
  });

  /**
   * Fase 7C: o preview e o workflow continuam SEM publicacao automatica — nenhuma
   * pagina muta `publishedAt` como chave de dado nem oferece botao Publicar.
   */
  it("preview e workflow nao carimbam publishedAt nem publicam automaticamente", async () => {
    const WORKFLOW_PAGE = resolve(process.cwd(), "apps", "admin", "app", "workflow", "page.tsx");
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL, WORKFLOW_PAGE]) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(/\bpublishedAt\s*:/.test(code), `${file} muta publishedAt`).toBe(false);
      expect(/\bPublicar\b/.test(code), `${file} tem botao Publicar`).toBe(false);
    }
  });
});
