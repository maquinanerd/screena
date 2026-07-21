/**
 * Fronteira da camada de PERSISTENCIA (C7A). Prova por varredura da FONTE REAL
 * que, nesta unidade, persistence/ tem SOMENTE contratos: nenhum PrismaClient,
 * nenhum SQL, nenhum IO/rede/HTTP, nenhum acoplamento a apps — e que a direcao
 * da dependencia continua persistence -> dominio (os dominios puros NAO
 * importam persistence/).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "services", "user-platform", "src");
const PERSISTENCE = path.join(SRC, "persistence");

/** Dominios PUROS que jamais podem depender da persistencia. */
const PURE_DOMAINS = [
  "core",
  "auth",
  "contracts",
  "privacy",
  "lists",
  "stats",
  "tracking",
  "ratings",
  "reviews",
  "recommendations",
];

function filesUnder(dir: string): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts")) {
        out.push({ file: path.relative(SRC, full), content: readFileSync(full, "utf8") });
      }
    }
  }
  walk(dir);
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

describe("persistence/: somente contratos (C7A)", () => {
  const files = filesUnder(PERSISTENCE).filter((f) => !f.file.includes("__tests__"));

  it("(1) ha modulos para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it("(2) nao importa PrismaClient / @prisma / client concreto", () => {
    const forbidden = /@prisma\/client|PrismaClient|from\s+["']@?prisma|new\s+PrismaClient/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nao contem SQL cru nem API de transacao concreta", () => {
    const forbidden =
      /\bSELECT\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\$queryRaw|\$executeRaw|\$transaction/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(4) nao importa HTTP/rede/Next/React/apps nem faz IO", () => {
    const forbidden =
      /node:fs|node:net|node:http|\bfetch\s*\(|axios|next[/"']|react["']|\.\.\/\.\.\/\.\.\/apps|express|console\.(log|info|debug|warn|error)/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(5) nao ha CRUD generico (BaseRepository / Repository<T>)", () => {
    const forbidden = /BaseRepository|interface\s+Repository\s*<|class\s+\w*Repository\b|GenericRepository/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(6) nao ha implementacao concreta (so tipos/interfaces)", () => {
    // Nenhuma classe e nenhuma funcao com corpo executavel nesta unidade.
    const forbidden = /\bclass\s+\w+|=>\s*\{|\bfunction\s+\w+\s*\(/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(7) nao vaza PII nem segredo no contrato", () => {
    const forbidden =
      /\bemail\b|\bpassword\b|\btoken_hash\b|\bsecret\b|ipHash|ipAddress|credential|reviewBody|moderationNote/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });
});

describe("direcao da dependencia: dominio puro NAO conhece persistence/", () => {
  it("(1) nenhum dominio puro importa persistence/", () => {
    const offenders: string[] = [];
    for (const domain of PURE_DOMAINS) {
      for (const f of filesUnder(path.join(SRC, domain))) {
        const code = stripComments(f.content);
        if (/from\s+["'][^"']*persistence/.test(code)) {
          offenders.push(f.file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
