/**
 * Testes de fronteira/governanca de tracking/ (complementam os funcionais):
 * garantem, por varredura de fonte, que o dominio e PURO e determinístico, nao
 * importa camadas proibidas nem ratings/reviews/persistence, e nao vaza segredo.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as trackingBarrel from "../index.js";

const DIR = path.join(process.cwd(), "services", "user-platform", "src", "tracking");

function sourceFiles(includeTests: boolean): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!includeTests && entry === "__tests__") continue;
        walk(full);
      } else if (entry.endsWith(".ts")) {
        out.push({ file: path.relative(DIR, full), content: readFileSync(full, "utf8") });
      }
    }
  }
  walk(DIR);
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

describe("tracking/: pureza e camadas (codigo, sem testes)", () => {
  const files = sourceFiles(false);

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("(2) nao importa Prisma/Next.js/React/apps/persistence/ratings/reviews", () => {
    const forbidden =
      /from\s+["'](@prisma\/|@?prisma|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|.*\/persistence|\.\.\/ratings|\.\.\/reviews)/;
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

  it("(4) nao acessa rede/filesystem nem loga", () => {
    const forbidden = /node:fs|node:net|node:http|\bfetch\s*\(|console\.(log|info|debug|warn|error)/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(5) so importa de core/ e de privacy/ (funcao pura de gate)", () => {
    // Confere que o unico import externo ao proprio dominio e core/ ou privacy/.
    const importRe = /from\s+["'](\.\.\/[^"']+)["']/g;
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(code)) !== null) {
        const spec = m[1] ?? "";
        if (!spec.startsWith("../core/") && !spec.startsWith("../privacy/")) {
          offenders.push(`${f.file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("tracking/: barrel nao vaza segredo", () => {
  it("(1) barrel exporta funcoes de dominio e nenhum valor sensivel", () => {
    expect(typeof trackingBarrel.applyWatchStateChange).toBe("function");
    expect(typeof trackingBarrel.registerViewingEvent).toBe("function");
    expect(typeof trackingBarrel.buildDiary).toBe("function");
    const suspicious = Object.keys(trackingBarrel).filter((k) =>
      /password|passwordHash|token|tokenHash|rawToken|secret|email/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });
});
