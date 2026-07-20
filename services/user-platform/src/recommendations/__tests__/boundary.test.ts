/**
 * Testes de fronteira/governanca de recommendations/ (complementam os
 * funcionais): provam por varredura da FONTE REAL que o dominio e PURO e
 * determinístico, nao importa Prisma/persistence/outros dominios, nao calcula
 * nem importa o Cinerie Score, nao usa ratings externos, IA/ML/embeddings, nem
 * PII, e o resultado nao vaza dado sensivel.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as recBarrel from "../index.js";

const DIR = path.join(process.cwd(), "services", "user-platform", "src", "recommendations");

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

describe("recommendations/: pureza e camadas (codigo, sem testes)", () => {
  const files = sourceFiles(false);

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("(2) nao importa Prisma/Next/React/apps/persistence nem outros dominios", () => {
    const forbidden =
      /from\s+["'](@prisma\/|@?prisma|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|.*\/persistence|\.\.\/ratings|\.\.\/reviews|\.\.\/tracking|\.\.\/stats|\.\.\/lists|\.\.\/contracts|\.\.\/auth|\.\.\/privacy)/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nao usa Date.now / new Date() / Math.random / process.env / PrismaClient", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      if (/Date\.now|Math\.random|process\.env|PrismaClient|new Date\(/.test(code)) offenders.push(f.file);
    }
    expect(offenders).toEqual([]);
  });

  it("(4) nao acessa rede/filesystem, nao loga, sem IA/ML/embeddings", () => {
    const forbidden =
      /node:fs|node:net|node:http|\bfetch\s*\(|axios|console\.(log|info|debug|warn|error)|embedding|openai|gemini|tensorflow|onnxruntime/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(5) so importa de ./ (mesmo dominio) ou ../core/", () => {
    const importRe = /from\s+["'](\.\.\/[^"']+)["']/g;
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(code)) !== null) {
        const spec = m[1] ?? "";
        if (!spec.startsWith("../core/")) {
          offenders.push(`${f.file}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("recommendations/: separacao de Cinerie Score e ratings externos", () => {
  const files = sourceFiles(false);

  it("(1) nenhum codigo referencia o Cinerie Score", () => {
    const forbidden = /@screena\/cinerie-score|cinerie-score|CinerieScore|cinerieScore/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(2) nenhum codigo referencia ratings externos ou Backend B", () => {
    const forbidden =
      /services\/ratings|@screena\/ratings|external_ratings|external-intelligence|source_licenses|ratingSource|providerApi|sourceLicenseId|attributionText|scoreAllowed|licenseStatus/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nenhum campo de PII vaza para o dominio", () => {
    const forbidden = /\bemail\b|\bpassword\b|\btoken\b|\bsecret\b|ipHash|ipAddress|\bsession\b|credential|reviewBody|moderationNote/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("recommendations/: barrel nao vaza segredo", () => {
  it("(1) barrel exporta funcoes de dominio e nenhum valor sensivel", () => {
    expect(typeof recBarrel.rankRecommendations).toBe("function");
    expect(typeof recBarrel.evaluateEligibility).toBe("function");
    expect(typeof recBarrel.computeScore).toBe("function");
    expect(typeof recBarrel.deriveReasons).toBe("function");
    const suspicious = Object.keys(recBarrel).filter((k) =>
      /password|passwordHash|token|tokenHash|rawToken|secret|email|cinerie/i.test(k),
    );
    expect(suspicious).toEqual([]);
  });
});

describe("recommendations/ C6B: plano/feedback sem persistencia, SQL ou transporte", () => {
  const files = sourceFiles(false);

  it("(1) nenhum arquivo contem SQL cru nem API de transacao Prisma", () => {
    // Palavras-chave SQL em maiuscula (o dominio usa ops NEUTRAS, nunca SQL) +
    // $transaction/prisma. Ancorado para nao colidir com identificadores locais
    // como `insert_snapshot`/`demote_current` (minusculos).
    const forbidden =
      /\bSELECT\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\$transaction|@prisma|PrismaClient|prisma\./;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(2) o dominio nao decide licenca/display (recebe flags ja resolvidas de C6A)", () => {
    const forbidden = /displayAllowed|scoreAllowed|licenseStatus|display_allowed|score_allowed/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nenhum byte de controle (NUL) nos arquivos de C6B", () => {
    // Deteccao por charCode (sem regex de byte cru): rejeita controles < 32
    // exceto TAB(9)/LF(10)/CR(13), e DEL(127). Guarda contra o artefato de NUL.
    const hasControlByte = (s: string): boolean => {
      for (let i = 0; i < s.length; i += 1) {
        const code = s.charCodeAt(i);
        if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
      }
      return false;
    };
    const c6bFiles = new Set([
      "time.ts",
      "canonical.ts",
      "diversity.ts",
      "snapshot.ts",
      "renewal.ts",
      "transaction-plan.ts",
      "feedback.ts",
    ]);
    const offenders = files.filter((f) => c6bFiles.has(f.file) && hasControlByte(f.content));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("recommendations/ C6B: barrel exporta o novo dominio", () => {
  it("(1) exporta diversidade/snapshot/renovacao/plano/feedback", () => {
    expect(typeof recBarrel.applyDiversity).toBe("function");
    expect(typeof recBarrel.buildRecommendationSnapshot).toBe("function");
    expect(typeof recBarrel.evaluateSnapshotState).toBe("function");
    expect(typeof recBarrel.planSnapshotPublication).toBe("function");
    expect(typeof recBarrel.planSnapshotInvalidation).toBe("function");
    expect(typeof recBarrel.planRecommendationFeedback).toBe("function");
    expect(typeof recBarrel.deriveFeedbackExclusions).toBe("function");
    expect(typeof recBarrel.epochMillisToIsoUtc).toBe("function");
    expect(typeof recBarrel.canonicalizeSnapshot).toBe("function");
  });
});
