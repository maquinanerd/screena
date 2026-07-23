/**
 * Testes de fronteira/governanca de ratings/ (complementam os funcionais):
 * provam, por varredura da FONTE REAL, que o dominio de avaliacao de usuario e
 * PURO e determinístico, nao importa camadas proibidas nem
 * persistence/reviews/ratings-externos, nao toca o Cinerie Score e nao vaza
 * conceito de fonte externa nem de review. Sao asserts sobre o codigo, nao
 * apenas "a funcao existe".
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ratingsBarrel from "../index.js";

const DIR = path.join(process.cwd(), "services", "user-platform", "src", "ratings");

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

describe("ratings/: pureza e camadas (codigo, sem testes)", () => {
  const files = sourceFiles(false);

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it("(2) nao importa Prisma/Next.js/React/apps/persistence/reviews/tracking/stats", () => {
    const forbidden =
      /from\s+["'](@prisma\/|@?prisma|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|.*\/persistence|\.\.\/reviews|\.\.\/tracking|\.\.\/stats|\.\.\/lists|\.\.\/contracts|\.\.\/auth)/;
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

describe("ratings/: separacao de ratings externos e Cinerie Score", () => {
  const files = sourceFiles(false);

  it("(1) nenhum codigo referencia servico/tabela/pacote de ratings externos", () => {
    const forbidden =
      /services\/ratings|@screena\/ratings|external_ratings|source_licenses|rating_sources|external-intelligence/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(2) nenhum codigo referencia o Cinerie Score", () => {
    const forbidden = /cinerie-score|CinerieScore|cinerieScore/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nenhum campo de fonte externa vaza para o dominio", () => {
    const forbidden =
      /ratingSource|providerApi|sourceLicenseId|attributionText|attributionUrl|logoAllowed|scoreAllowed|licenseStatus|sourceKey/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("ratings/: separacao de reviews (C5B)", () => {
  const files = sourceFiles(false);

  it("(1) nenhum campo de review vaza para o dominio de nota", () => {
    const forbidden = /spoiler|reviewBody|moderationStatus|moderation|likeCount|reportReason/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("ratings/: barrel nao vaza segredo", () => {
  it("(1) barrel exporta funcoes de dominio e nenhum valor sensivel", () => {
    expect(typeof ratingsBarrel.planRatingSet).toBe("function");
    expect(typeof ratingsBarrel.planRatingRemoval).toBe("function");
    expect(typeof ratingsBarrel.validateUserRatingValue).toBe("function");
    expect(typeof ratingsBarrel.computeUserRatingProjection).toBe("function");
    const suspicious = Object.keys(ratingsBarrel).filter((k) =>
      /password|passwordHash|token|tokenHash|rawToken|secret|email/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });
});
