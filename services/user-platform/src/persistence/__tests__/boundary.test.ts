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

  // C7B0 substituiu a regex-cobertor por assercoes PRECISAS. A antiga proibia
  // `email` e `credential` em bloco — calibrada para uma camada que so conhecia
  // recomendacoes. Com os contratos de identidade/credencial aprovados, aquela
  // regra passaria a barrar o desenho correto; o que importa provar e mais
  // forte e mais especifico: NENHUMA senha em claro, NENHUM token/segredo, e o
  // hash confinado ao contrato de credencial (jamais na identidade).

  it("(7) nenhum contrato aceita senha em TEXTO CLARO", () => {
    // Regra: QUALQUER campo cujo nome termine em "password" (case-insensitive)
    // e senha em claro. `passwordHash`/`expectedPasswordHash`/`nextPasswordHash`
    // terminam em "Hash" e sao PERMITIDOS (hash opaco, decisao aprovada).
    //
    // A versao anterior ancorava em `\bpassword` e deixava passar exatamente os
    // nomes canonicos do repo (`currentPassword`, `newPassword` em
    // contracts/auth-commands.ts) alem de `password?: string` — justamente o
    // vocabulario da proxima unidade (C7B2, recuperacao/troca).
    const declaration = /readonly\s+(\w+)\s*\??\s*:/g;
    const offenders: string[] = [];
    for (const f of files) {
      const code = stripComments(f.content);
      let m: RegExpExecArray | null;
      while ((m = declaration.exec(code)) !== null) {
        const field = m[1] ?? "";
        if (/password$/i.test(field)) offenders.push(`${f.file}: ${field}`);
      }
      if (/\bplainPassword\b|\brawPassword\b/i.test(code)) offenders.push(`${f.file}: plain/raw`);
    }
    expect(offenders).toEqual([]);
  });

  it("(8) nenhum token/segredo de sessao, recuperacao ou verificacao nos contratos", () => {
    const forbidden =
      /\btokenHash\b|\btoken_hash\b|\brawToken\b|\bsecret\b|\bcsrf\b|sessionToken|resetToken|verificationToken|ipHash|ipAddress|reviewBody|moderationNote/i;
    const offenders = files.filter((f) => forbidden.test(stripComments(f.content)));
    expect(offenders.map((f) => f.file)).toEqual([]);
  });

  /**
   * Extrai TODA declaracao exportada de tipo — `export interface X { ... }` E
   * `export type X = ...` (uniao ou nao). A versao anterior so varria
   * `interface`, e como TODOS os resultados desta camada sao `export type`
   * uniao, um `passwordHash` dentro de `IdentityLookupResult` escapava das tres
   * guardas ao mesmo tempo.
   */
  function exportedTypeBlocks(source: string): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = [];
    for (const m of source.matchAll(/export interface (\w+)\s*\{([\s\S]*?)\n\}/g)) {
      out.push({ name: m[1] ?? "", body: m[2] ?? "" });
    }
    // `export type X = ...;` ate o `;` que fecha a declaracao.
    for (const m of source.matchAll(/export type (\w+)\s*=([\s\S]*?);\s*(?:\n|$)/g)) {
      out.push({ name: m[1] ?? "", body: m[2] ?? "" });
    }
    return out;
  }

  it("(9) o hash NUNCA aparece no registro de identidade", () => {
    const types = files.find((f) => f.file.endsWith("types.ts"));
    expect(types, "types.ts nao encontrado").toBeDefined();
    const source = stripComments(types!.content);
    const start = source.indexOf("export interface IdentityRecord");
    expect(start, "IdentityRecord nao encontrado (guarda nao vacua)").toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("}", start));
    expect(block).not.toMatch(/passwordHash|algorithm|credential/i);
  });

  it("(10) SO CredentialVerificationMaterial carrega o hash (interfaces E type aliases)", () => {
    const types = files.find((f) => f.file.endsWith("types.ts"));
    const source = stripComments(types!.content);
    const blocks = exportedTypeBlocks(source);
    // Guarda nao vacua: precisa enxergar tanto interfaces quanto type aliases.
    expect(blocks.length).toBeGreaterThan(8);
    expect(blocks.some((b) => b.name === "IdentityLookupResult")).toBe(true);

    // Detecta o hash como CAMPO declarado (`readonly ...PasswordHash:`), nao
    // como mencao textual — senao o proprio rotulo de alvo
    // ("credential.passwordHash") seria falso positivo.
    const carriesHashField = (body: string): boolean =>
      /readonly\s+\w*passwordHash\s*\??\s*:/i.test(body);

    // Autorizacao por PAPEL (portador declarado), nao por prefixo de nome:
    // entradas de escrita precisam do hash; qualquer OUTRO tipo, nao.
    const allowed = new Set([
      "CredentialVerificationMaterial",
      "CredentialCreateInput",
      "CredentialReplaceInput",
    ]);
    const leaking = blocks
      .filter((b) => carriesHashField(b.body))
      .map((b) => b.name)
      .filter((name) => !allowed.has(name));
    expect(leaking).toEqual([]);
  });

  it("(11) nenhum campo de TEXTO LIVRE nos contratos de conflito", () => {
    // `detail?: string` seria um canal de vazamento de hash/e-mail em runtime,
    // fora do alcance de qualquer varredura de fonte.
    const types = files.find((f) => f.file.endsWith("types.ts"));
    const source = stripComments(types!.content);
    const conflictBlocks = exportedTypeBlocks(source).filter((b) =>
      /Conflict/.test(b.name),
    );
    expect(conflictBlocks.length).toBeGreaterThan(0);
    for (const block of conflictBlocks) {
      expect(block.body, `${block.name} nao pode ter campo livre`).not.toMatch(
        /\bdetail\b|\bmessage\b|\bnote\b|\bdescription\b/i,
      );
    }
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
