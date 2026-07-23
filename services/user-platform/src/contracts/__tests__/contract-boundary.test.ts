/**
 * Testes de FRONTEIRA dos contratos (contracts/): garantem, por varredura de
 * fonte e pelo barrel, que:
 *  - nao ha dependencia de Prisma/Next.js/React/apps;
 *  - nao ha Date.now/Math.random/process.env no dominio de contratos;
 *  - o barrel PUBLICO (public.ts/index.ts) nao reexporta a entrega sensivel;
 *  - mappers publicos nao usam spread de objeto interno nem retornam AuthDecision.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as publicBarrel from "../index.js";

const CONTRACTS_DIR = path.join(process.cwd(), "services", "user-platform", "src", "contracts");

/** Le todos os .ts de contracts/ exceto __tests__. */
function sourceFiles(): { file: string; content: string }[] {
  const out: { file: string; content: string }[] = [];
  for (const entry of readdirSync(CONTRACTS_DIR)) {
    if (entry.endsWith(".ts")) {
      out.push({ file: entry, content: readFileSync(path.join(CONTRACTS_DIR, entry), "utf8") });
    }
  }
  return out;
}

/** Remove comentarios de linha e bloco antes da varredura de codigo real. */
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

describe("contratos: sem dependencia de runtime proibido", () => {
  const files = sourceFiles();

  it("(1) ha arquivos de contrato para varrer (guarda nao vacua)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("(2) nenhum import de Prisma/@prisma/Next.js/React/apps", () => {
    const forbidden = /from\s+["'](@prisma\/|\.\.\/\.\.\/\.\.\/apps|next[/"']|react["'])/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(3) nenhum Date.now/Math.random/process.env no codigo real", () => {
    const forbidden = /Date\.now|Math\.random|process\.env|PrismaClient/;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  it("(4) mappers publicos nao usam spread nem retornam AuthDecision", () => {
    const mappers = files.find((f) => f.file === "auth-mappers.ts");
    expect(mappers).toBeDefined();
    const code = stripComments(mappers!.content);
    expect(code.includes("...")).toBe(false); // sem spread de objeto interno
    expect(code.includes("AuthDecision")).toBe(false); // nao retorna AuthDecision cru
    expect(/Object\.assign/.test(code)).toBe(false);
  });
});

describe("contratos: fronteira do barrel publico x sensivel", () => {
  it("(1) public.ts NAO reexporta auth-internal (entrega sensivel)", () => {
    const publicTs = readFileSync(path.join(CONTRACTS_DIR, "public.ts"), "utf8");
    const indexTs = readFileSync(path.join(CONTRACTS_DIR, "index.ts"), "utf8");
    expect(stripComments(publicTs).includes("auth-internal")).toBe(false);
    expect(stripComments(publicTs).includes("./internal")).toBe(false);
    expect(stripComments(indexTs).includes("auth-internal")).toBe(false);
    expect(stripComments(indexTs).includes("./internal")).toBe(false);
  });

  it("(2) a entrega sensivel so e reexportada por internal.ts (import p/ tipo de mapper e permitido)", () => {
    const files = sourceFiles().filter((f) => f.file !== "auth-internal.ts");
    // Segmenta por statement (;) e distingue RE-EXPORT (`export ... from`) de
    // IMPORT (`import ... from`); so um RE-EXPORT vaza o tipo para o barrel.
    const reexporters = files.filter((f) =>
      stripComments(f.content)
        .split(";")
        .some((stmt) => {
          const s = stmt.trim();
          return /from\s*["']\.\/auth-internal/.test(s) && s.startsWith("export");
        }),
    );
    expect(reexporters.map((f) => f.file)).toEqual(["internal.ts"]);
  });

  it("(3) o barrel publico expoe os mappers e nao expoe valor sensivel", () => {
    // mappers publicos presentes
    expect(typeof publicBarrel.toCurrentUserDto).toBe("function");
    expect(typeof publicBarrel.toPublicAuthFailureDto).toBe("function");
    // nenhum EXPORT DE VALOR sensivel (deliveries sao types; nao ha runtime aqui)
    const names = Object.keys(publicBarrel);
    for (const forbidden of [
      "SensitiveSessionDelivery",
      "SensitiveOneTimeTokenDelivery",
      "AuthTransportSecrets",
    ]) {
      expect(names.includes(forbidden), forbidden).toBe(false);
    }
  });
});
