/**
 * Guarda de SEGURANCA do harness de seed de staging (Fase 8A).
 *
 * O harness `apps/admin/scripts/staging-seed.ts` e a UNICA superficie com escrita
 * Prisma da fase — e propositalmente FORA do runtime do admin (nao e importado
 * por nenhuma pagina/componente; os guards de runtime `readonly-guard` e
 * `pages-no-write` varrem `src`/`app`, nunca `scripts`). Por isso, a seguranca do
 * harness e travada aqui: a escrita so acontece depois da resolucao de modo
 * (dry-run/apply/cleanup/abort), nunca chama API externa e nunca loga segredo.
 *
 * O comportamento de decisao (default dry-run, confirmacao dupla, aborta em
 * producao) e testado de forma pura em `staging-seed-plan.test.ts`.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "apps", "admin", "scripts", "staging-seed.ts");

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

describe("harness de seed de staging (Fase 8A)", () => {
  let code = "";

  beforeAll(async () => {
    code = stripComments(await readFile(SCRIPT, "utf-8"));
  });

  it("existe", async () => {
    expect(await pathExists(SCRIPT)).toBe(true);
  });

  it("resolve o modo pelo lib puro antes de qualquer acesso ao banco", () => {
    expect(code).toContain("resolveSeedMode(");
    const decisionAt = code.indexOf("resolveSeedMode(");
    const dbAt = code.indexOf('import("@screena/db/server")');
    expect(decisionAt, "resolveSeedMode ausente").toBeGreaterThanOrEqual(0);
    expect(dbAt, "import do banco ausente").toBeGreaterThan(decisionAt);
  });

  it("trata dry-run e abort antes de importar o banco (fail closed)", () => {
    const dryAt = code.indexOf('"dry-run"');
    const abortAt = code.indexOf('"abort"');
    const dbAt = code.indexOf('import("@screena/db/server")');
    expect(dryAt).toBeGreaterThanOrEqual(0);
    expect(abortAt).toBeGreaterThanOrEqual(0);
    expect(dryAt).toBeLessThan(dbAt);
    expect(abortAt).toBeLessThan(dbAt);
  });

  it("e uma superficie de escrita REAL (guarda nao vacua), so no banco local", () => {
    // Escreve (idempotente) e limpa (marcado) — prova de que o harness e real.
    expect(code).toContain(".upsert(");
    expect(code).toContain(".deleteMany(");
    // Somente o acessor server-only local; nenhum outro banco.
    expect(code).toContain("@screena/db/server");
  });

  it("cleanup remove SO registros marcados (sentinela + prefixo + marcador)", () => {
    expect(code).toContain("STAGING_SEED_SLUG_PREFIX");
    expect(code).toContain("STAGING_SEED_MARKER");
    expect(code).toContain("startsWith");
    expect(code).toContain("tmdbId");
  });

  it("NAO chama nenhuma API externa (TMDB/Gemini/WordPress/RSSPRIME/etc.)", () => {
    expect(/\bfetch\s*\(/.test(code), "fetch externo").toBe(false);
    const FORBIDDEN_HOSTS = [
      "themoviedb",
      "image.tmdb.org",
      "rapidapi",
      "gemini",
      "generativelanguage",
      "googleapis",
      "rottentomatoes",
      "wordpress",
      "rssprime",
      "mn26",
      "https://",
    ];
    for (const needle of FORBIDDEN_HOSTS) {
      expect(code.toLowerCase().includes(needle.toLowerCase()), `host externo: ${needle}`).toBe(
        false,
      );
    }
  });

  it("nao loga segredo: nenhum console imprime DATABASE_URL/credencial/valor de confirmacao", () => {
    for (const line of code.split(/\r?\n/)) {
      if (!/\bconsole\s*\./.test(line)) continue;
      const lower = line.toLowerCase();
      expect(lower.includes("database_url"), `console vaza DATABASE_URL: ${line}`).toBe(false);
      expect(lower.includes("admin_basic_auth"), `console vaza credencial: ${line}`).toBe(false);
      expect(lower.includes("confirmvalue"), `console vaza confirmacao: ${line}`).toBe(false);
      expect(/\.(?:password|pass|senha)\b/i.test(line), `console vaza senha: ${line}`).toBe(false);
    }
  });

  it("exige confirmacao dupla explicita (flag + env de confirmacao)", () => {
    expect(code).toContain("STAGING_SEED_CONFIRM_ENV");
    expect(code).toContain("parseSeedFlags");
  });
});
