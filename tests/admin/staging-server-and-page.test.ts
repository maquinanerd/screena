/**
 * Guarda estrutural do server helper e da pagina de staging (Fase 8A).
 *
 * O helper `src/server/staging-readiness.ts` e a pagina `app/staging/page.tsx` e
 * o lib `src/lib/staging-readiness.ts` NAO introduzem escrita nem vazam segredo.
 * O helper de server vive fora do scan padrao de `no-secret-leak` (app + src/lib),
 * por isso e checado explicitamente aqui.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const SERVER = resolve(process.cwd(), "apps", "admin", "src", "server", "staging-readiness.ts");
const LIB = resolve(process.cwd(), "apps", "admin", "src", "lib", "staging-readiness.ts");
const SEED_LIB = resolve(process.cwd(), "apps", "admin", "src", "lib", "staging-seed-plan.ts");
const PAGE = resolve(process.cwd(), "apps", "admin", "app", "staging", "page.tsx");

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

/** Metodos/SQL de escrita proibidos num helper/lib read-only. */
const FORBIDDEN_WRITES = [
  ".create(",
  ".update(",
  ".delete(",
  ".upsert(",
  ".createMany(",
  ".updateMany(",
  ".deleteMany(",
  "$executeRaw",
  ".$executeRawUnsafe(",
  ".$queryRawUnsafe(",
  ".$queryRaw",
];

const SECRET_SUBSTRINGS = [
  "process.env.ADMIN_BASIC_AUTH_PASSWORD",
  "process.env.ADMIN_BASIC_AUTH_USER",
  "process.env.DATABASE_URL",
  "NEXT_PUBLIC_ADMIN",
];

describe("server helper de staging e SOMENTE LEITURA (Fase 8A)", () => {
  let code = "";

  beforeAll(async () => {
    code = stripComments(await readFile(SERVER, "utf-8"));
  });

  it("existe", async () => {
    expect(await pathExists(SERVER)).toBe(true);
  });

  it("nao contem escrita Prisma nem SQL cru", () => {
    for (const needle of FORBIDDEN_WRITES) {
      expect(code.includes(needle), `server de staging usa ${needle}`).toBe(false);
    }
  });

  it("nao chama fetch externo", () => {
    expect(/\bfetch\s*\(/.test(code)).toBe(false);
  });

  it("nao usa console", () => {
    expect(/\bconsole\s*\./.test(code)).toBe(false);
  });

  it("delega leitura de banco a helper agregado bounded (nao consulta cru aqui)", () => {
    // Reusa o agregado read-only ja existente; se um dia usar findMany direto,
    // deve ser bounded (take). Como delega, nao ha findMany aqui.
    expect(code).toContain("getDashboardData");
    if (code.includes(".findMany(")) {
      expect(code).toContain("take:");
    }
  });

  it("nao vaza segredo (env sensivel, Authorization, DATABASE_URL, senha)", () => {
    for (const needle of SECRET_SUBSTRINGS) {
      expect(code, `server: ${needle}`).not.toContain(needle);
    }
    expect(code.toLowerCase()).not.toContain("authorization");
    expect(code.toLowerCase()).not.toContain("bearer");
    expect(/\.(?:password|pass|senha)\b/i.test(code)).toBe(false);
  });
});

describe("libs puros de staging nao escrevem nem vazam segredo (Fase 8A)", () => {
  it("staging-readiness e staging-seed-plan nao contem escrita Prisma nem segredo", async () => {
    for (const file of [LIB, SEED_LIB]) {
      const code = stripComments(await readFile(file, "utf-8"));
      for (const needle of FORBIDDEN_WRITES) {
        expect(code.includes(needle), `${file}: ${needle}`).toBe(false);
      }
      for (const needle of SECRET_SUBSTRINGS) {
        expect(code, `${file}: ${needle}`).not.toContain(needle);
      }
      expect(code.toLowerCase()).not.toContain("authorization");
      expect(/["']use server["']/.test(code), `${file}: use server`).toBe(false);
    }
  });
});

const FORBIDDEN_WRITE_UI: ReadonlyArray<[RegExp, string]> = [
  [/<form\b/i, "<form>"],
  [/<input\b/i, "<input>"],
  [/<textarea\b/i, "<textarea>"],
  [/<button\b/i, "<button>"],
  [/<select\b/i, "<select>"],
  [/["']use server["']/, "use server"],
  [/dangerouslySetInnerHTML/i, "dangerouslySetInnerHTML"],
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

describe("pagina de staging /staging (Fase 8A)", () => {
  let raw = "";
  let code = "";

  beforeAll(async () => {
    raw = await readFile(PAGE, "utf-8");
    code = stripComments(raw);
  });

  it("existe e mostra o checklist de prontidao de staging", async () => {
    expect(await pathExists(PAGE)).toBe(true);
    expect(raw).toContain("Prontidao de staging");
    expect(raw).toContain("Modo somente leitura");
  });

  it("linka para /security, /review-queue, /workflow e /qa", () => {
    for (const href of ["/security", "/review-queue", "/workflow", "/qa"]) {
      expect(code, `link ausente: ${href}`).toContain(href);
    }
  });

  it("explica o seed: nao roda pela UI, dry-run, --apply com confirmacao", () => {
    expect(code).toContain("dry-run");
    expect(code).toContain("--apply");
    // A env de confirmacao e exibida via variavel (seed.confirmEnv), nunca literal secreto.
    expect(code).toContain("confirmEnv");
  });

  it("nao tem form/input/button/select/textarea/server action/upload/editor", () => {
    for (const [pattern, label] of FORBIDDEN_WRITE_UI) {
      expect(pattern.test(code), `staging page contem ${label}`).toBe(false);
    }
  });

  it("nao tem rotulo Excluir/Deletar/Publicar/Salvar", () => {
    for (const [pattern, label] of FORBIDDEN_LABELS) {
      expect(pattern.test(code), `staging page contem ${label}`).toBe(false);
    }
  });

  it("nao le process.env nem vaza segredo no render", () => {
    expect(code).not.toContain("process.env");
    expect(code.toLowerCase()).not.toContain("authorization");
    for (const secret of ["DATABASE_URL", "ADMIN_BASIC_AUTH"]) {
      expect(code).not.toContain(secret);
    }
    expect(/\.(?:password|pass|senha)\b/i.test(code)).toBe(false);
  });
});
