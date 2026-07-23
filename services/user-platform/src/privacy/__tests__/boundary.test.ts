/**
 * Testes de fronteira/governanca de privacy/ (complementam os funcionais):
 * garantem, por varredura de fonte, que o dominio de privacidade e PURO e
 * deterministico e que o barrel nao vaza segredo.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as privacyBarrel from "../index.js";

const PRIVACY_DIR = path.join(process.cwd(), "services", "user-platform", "src", "privacy");

function sourceFiles(includeTests: boolean): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  function walk(dir: string, rel: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        if (!includeTests && entry === "__tests__") continue;
        walk(full, relPath);
      } else if (entry.endsWith(".ts")) {
        out.push({ file: relPath, content: readFileSync(full, "utf8") });
      }
    }
  }
  walk(PRIVACY_DIR, "");
  return out;
}

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 && line[i - 1] !== ":" ? line.slice(0, i) : line;
    })
    .join("\n");
}

describe("privacy/: pureza e determinismo (codigo, sem testes)", () => {
  const files = sourceFiles(false);

  it("(1) ha modulos de dominio para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("(2) nao importa Prisma/Next.js/React/apps/persistence", () => {
    const forbidden = /from\s+["'](@prisma\/|@?prisma|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|.*\/persistence)/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nao usa Date.now / new Date() sem arg / Math.random / process.env / PrismaClient", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      if (/Date\.now|Math\.random|process\.env|PrismaClient/.test(code)) offenders.push(`${f.file}:rt`);
      if (/new Date\(\s*\)/.test(code)) offenders.push(`${f.file}:newDate`);
    }
    expect(offenders).toEqual([]);
  });

  it("(4) nao acessa rede/filesystem nem loga dados", () => {
    const forbidden = /node:fs|node:net|node:http|\bfetch\s*\(|console\.(log|info|debug|warn|error)/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("privacy/: barrel nao vaza segredo", () => {
  it("(1) o barrel exporta funcoes de dominio e nenhum valor sensivel", () => {
    expect(typeof privacyBarrel.buildExportPlan).toBe("function");
    expect(typeof privacyBarrel.buildDeletionPlan).toBe("function");
    expect(typeof privacyBarrel.isConsentActive).toBe("function");
    // nenhum export cujo nome sugira um VALOR de segredo/hash bruto
    // (funcoes validadoras como assertExportContainsNoSecrets sao legitimas).
    const suspicious = Object.keys(privacyBarrel).filter((k) =>
      /rawToken|rawSessionToken|rawCsrfToken|passwordHash|tokenHash|csrfTokenHash/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });

  it("(2) nenhum valor exportado carrega, em runtime, chave sensivel", () => {
    for (const [name, value] of Object.entries(privacyBarrel)) {
      if (value && typeof value === "object") {
        const text = JSON.stringify(value).toLowerCase();
        for (const t of ["passwordhash", "rawtoken", "csrftoken", "secret"]) {
          expect(text.includes(t), `${name} contem ${t}`).toBe(false);
        }
      }
    }
  });
});
