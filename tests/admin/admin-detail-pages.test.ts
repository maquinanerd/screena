/**
 * Guarda estrutural das paginas de DETALHE de revisao (Fase 7A).
 *
 * Afirma, por leitura do fonte, que:
 *   - existem `articles/[id]/page.tsx` e `content-blocks/[id]/page.tsx`;
 *   - cada pagina renderiza o formulario de acao editorial (`EditorialActionForm`);
 *   - NAO ha edicao de titulo/slug/corpo/conteudo: sem `<input>`/`<textarea>` e
 *     sem `name="title|slug|body|content"` — nem nas paginas, nem no componente;
 *   - o componente de acao tem `<form>` + `<select>` (campo restrito) e nenhum
 *     campo de texto livre;
 *   - nao ha botao Excluir/Deletar, nem botao "Publicar" automatico, nem upload,
 *     nem editor rich text;
 *   - `publishedAt` e `display_allowed` NAO sao campos editaveis (so exibidos).
 *
 * Comentarios sao neutralizados antes das checagens de codigo (a prosa cita
 * legitimamente titulo/slug/corpo/`<input>` ao descrever o que a pagina NAO faz).
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
const FORM_COMPONENT = resolve(
  process.cwd(),
  "apps",
  "admin",
  "src",
  "components",
  "editorial-action-form.tsx",
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

/** Elementos/atributos de edicao de texto livre — proibidos nesta fase. */
const FREE_TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/name=["'](?:title|slug|body|content)["']/i, 'name="title|slug|body|content"'],
  [/type=["']file["']/i, 'input type="file" (upload)'],
  [/\bupload\b/i, "upload"],
  [/contenteditable/i, "contentEditable (rich text)"],
  [/\b(?:quill|tinymce|draft-js|prosemirror|ckeditor|lexical|@tiptap|slate-react)\b/i, "editor rich text"],
];

/** Rotulos de acao proibidos (excluir/publicar automatico). */
const FORBIDDEN_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/\bExcluir\b/, "Excluir"],
  [/\bDeletar\b/, "Deletar"],
  [/\bPublicar\b/, "Publicar"],
  [/\bSalvar\b/, "Salvar"],
];

describe("paginas de detalhe existem e tem form de acao (Fase 7A)", () => {
  it("article detail e content block detail existem", async () => {
    expect(await pathExists(ARTICLE_DETAIL)).toBe(true);
    expect(await pathExists(BLOCK_DETAIL)).toBe(true);
    expect(await pathExists(FORM_COMPONENT)).toBe(true);
  });

  it("cada pagina de detalhe renderiza EditorialActionForm", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL]) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code).toContain("EditorialActionForm");
    }
  });

  it("article detail expoe acoes de reviewStatus e indexStatus", async () => {
    const code = stripComments(await readFile(ARTICLE_DETAIL, "utf-8"));
    expect(code).toContain('fieldName="reviewStatus"');
    expect(code).toContain('fieldName="indexStatus"');
  });

  it("content block detail expoe acao SO de reviewStatus", async () => {
    const code = stripComments(await readFile(BLOCK_DETAIL, "utf-8"));
    expect(code).toContain('fieldName="reviewStatus"');
    expect(code).not.toContain('fieldName="indexStatus"');
  });

  it("publishedAt e display_allowed NAO sao campos editaveis (so exibidos)", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL]) {
      const code = stripComments(await readFile(file, "utf-8"));
      expect(code).not.toContain('fieldName="publishedAt"');
      expect(code).not.toContain('fieldName="displayAllowed"');
    }
  });
});

describe("nenhuma edicao de texto livre / upload / rich text", () => {
  it("as paginas de detalhe nao tem input/textarea/upload/rich-text/campo de titulo-slug-corpo", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const [pattern, label] of FREE_TEXT_PATTERNS) {
        expect(pattern.test(code), `${file} contem ${label}`).toBe(false);
      }
    }
  });

  it("o componente de acao nao tem input/textarea/upload/rich-text", async () => {
    const code = stripComments(await readFile(FORM_COMPONENT, "utf-8"));
    for (const [pattern, label] of FREE_TEXT_PATTERNS) {
      expect(pattern.test(code), `componente contem ${label}`).toBe(false);
    }
  });

  it("o componente de acao tem <form> e <select> (campo restrito)", async () => {
    const code = stripComments(await readFile(FORM_COMPONENT, "utf-8"));
    expect(/<form\b/i.test(code)).toBe(true);
    expect(/<select\b/i.test(code)).toBe(true);
  });
});

describe("sem botao Excluir/Deletar/Publicar automatico/Salvar", () => {
  it("paginas e componente nao tem rotulo de escrita perigoso", async () => {
    for (const file of [ARTICLE_DETAIL, BLOCK_DETAIL, FORM_COMPONENT]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const [pattern, label] of FORBIDDEN_LABELS) {
        expect(pattern.test(code), `${file} contem rotulo ${label}`).toBe(false);
      }
    }
  });
});
