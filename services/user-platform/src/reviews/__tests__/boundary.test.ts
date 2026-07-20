/**
 * Testes de fronteira/governanca de reviews/ (complementam os funcionais):
 * provam, por varredura da FONTE REAL, que o dominio de review e PURO e
 * determinístico, nao importa camadas proibidas nem ratings/persistence, nao
 * calcula nota numerica, nao toca ratings externos nem o Cinerie Score, e o
 * barrel nao vaza segredo.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as reviewsBarrel from "../index.js";

const DIR = path.join(process.cwd(), "services", "user-platform", "src", "reviews");

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

/** Remove comentarios (bloco e linha) preservando quebras — checa CODIGO real. */
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

describe("reviews/: pureza e camadas (codigo, sem testes)", () => {
  const files = sourceFiles(false);

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("(2) nao importa Prisma/Next.js/React/apps/persistence/ratings/tracking/stats", () => {
    const forbidden =
      /from\s+["'](@prisma\/|@?prisma|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|.*\/persistence|\.\.\/ratings|\.\.\/tracking|\.\.\/stats|\.\.\/lists|\.\.\/contracts|\.\.\/auth)/;
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
    const forbidden = /node:fs|node:net|node:http|\bfetch\s*\(|axios|console\.(log|info|debug|warn|error)/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(5) so importa de ./ (mesmo dominio), ../core/ ou ../privacy/ (gate puro)", () => {
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

describe("reviews/: separacao de nota numerica, ratings externos e Cinerie Score", () => {
  const files = sourceFiles(false);

  it("(1) nao importa o dominio ratings/ (review nunca calcula/valida nota)", () => {
    const forbidden = /from\s+["'][^"']*\.\.\/ratings/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(2) nenhum codigo referencia ratings externos ou Cinerie Score", () => {
    const forbidden =
      /services\/ratings|@screena\/ratings|external_ratings|source_licenses|rating_sources|external-intelligence|cinerie-score|CinerieScore/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nenhum campo de nota numerica ou de fonte externa vaza para o dominio", () => {
    const forbidden =
      /ratingValue|ratingScale|ratingSource|providerApi|sourceLicenseId|attributionText|scoreAllowed|licenseStatus/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("reviews/: barrel nao vaza segredo", () => {
  it("(1) barrel exporta funcoes de dominio e nenhum valor sensivel", () => {
    expect(typeof reviewsBarrel.planCreateReview).toBe("function");
    expect(typeof reviewsBarrel.planModeration).toBe("function");
    expect(typeof reviewsBarrel.planCreateReport).toBe("function");
    expect(typeof reviewsBarrel.toPublicReview).toBe("function");
    const suspicious = Object.keys(reviewsBarrel).filter((k) =>
      /password|passwordHash|token|tokenHash|rawToken|secret|email/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });
});
