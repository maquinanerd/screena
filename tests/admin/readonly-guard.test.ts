/**
 * Guarda de SOMENTE LEITURA do admin editorial.
 *
 * Varre o codigo do admin (`apps/admin/src` + `apps/admin/app`) e afirma que
 * NENHUM arquivo usa metodo de escrita do Prisma. O admin desta fase so le o
 * banco; qualquer escrita e violacao de escopo e deve falhar aqui.
 *
 * Se um dia este teste falhar, a correcao e remover a escrita — nunca relaxar a
 * regra.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN_DIRS = [
  resolve(process.cwd(), "apps", "admin", "src"),
  resolve(process.cwd(), "apps", "admin", "app"),
];
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Metodos de escrita do Prisma proibidos no admin read-only. */
const FORBIDDEN_WRITES: ReadonlyArray<[string, string]> = [
  [".create(", "prisma .create()"],
  [".update(", "prisma .update()"],
  [".delete(", "prisma .delete()"],
  [".upsert(", "prisma .upsert()"],
  [".createMany(", "prisma .createMany()"],
  [".updateMany(", "prisma .updateMany()"],
  [".deleteMany(", "prisma .deleteMany()"],
  // Variantes *AndReturn (Prisma 5.14+): escrevem e retornam as linhas. O needle
  // `.createMany(` NAO casa com `.createManyAndReturn(`, entao sao listadas a parte.
  [".createManyAndReturn(", "prisma .createManyAndReturn()"],
  [".updateManyAndReturn(", "prisma .updateManyAndReturn()"],
  ["$executeRaw", "prisma $executeRaw (SQL de escrita)"],
  // SQL cru sem parametrizacao: escrita arbitraria e vetor de injecao. `$queryRaw`
  // parametrizado (ex.: SELECT 1 do health) continua permitido; so a variante
  // Unsafe e bloqueada.
  [".$executeRawUnsafe(", "prisma $executeRawUnsafe (SQL cru de escrita)"],
  [".$queryRawUnsafe(", "prisma $queryRawUnsafe (SQL cru arbitrario)"],
];

interface Violation {
  file: string;
  rule: string;
  line: number;
  snippet: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function collectCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      out.push(...(await collectCodeFiles(full)));
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const dir of ADMIN_DIRS) {
    if (!(await pathExists(dir))) continue;
    const files = await collectCodeFiles(dir);
    for (const file of files) {
      const content = await readFile(file, "utf-8");
      content.split(/\r?\n/).forEach((line, index) => {
        for (const [needle, rule] of FORBIDDEN_WRITES) {
          if (line.includes(needle)) {
            violations.push({
              file: relative(process.cwd(), file),
              rule,
              line: index + 1,
              snippet: line.trim(),
            });
          }
        }
      });
    }
  }
  return violations;
}

describe("admin editorial e SOMENTE LEITURA (sem escrita Prisma)", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao usa nenhum metodo de escrita do Prisma", () => {
    expect(
      violations,
      `Admin read-only nao pode escrever no banco. Ocorrencias: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });

  it("existe codigo de servidor real do admin para varrer (guarda nao e vacua)", async () => {
    const serverDir = resolve(process.cwd(), "apps", "admin", "src", "server");
    expect(await pathExists(serverDir)).toBe(true);
    const files = await collectCodeFiles(serverDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

/**
 * Auto-teste da propria lista de needles: garante que a guarda NAO e vacua por
 * um erro de digitacao (um needle quebrado nunca casaria e passaria despercebido)
 * e que leitura legitima nao e bloqueada por engano.
 */
describe("a lista FORBIDDEN_WRITES cobre variantes de escrita e poupa leitura", () => {
  const matchesAnyForbidden = (snippet: string): boolean =>
    FORBIDDEN_WRITES.some(([needle]) => snippet.includes(needle));

  const DANGEROUS_SNIPPETS: ReadonlyArray<string> = [
    "await prisma.article.create({ data })",
    "await prisma.article.update({ where, data })",
    "await prisma.article.delete({ where })",
    "await prisma.article.upsert({ where, create, update })",
    "await prisma.article.createMany({ data })",
    "await prisma.article.updateMany({ where, data })",
    "await prisma.article.deleteMany({ where })",
    "await prisma.article.createManyAndReturn({ data })",
    "await prisma.article.updateManyAndReturn({ where, data })",
    "await prisma.$executeRaw`DELETE FROM articles`",
    "await prisma.$executeRawUnsafe('DELETE FROM articles')",
    "await prisma.$queryRawUnsafe('SELECT * FROM articles WHERE id = ' + id)",
  ];

  const SAFE_READS: ReadonlyArray<string> = [
    "await prisma.article.findMany({ where })",
    "await prisma.article.findUnique({ where })",
    "await prisma.article.count()",
    "await prisma.article.groupBy({ by })",
    "await prisma.$queryRaw`SELECT 1`",
  ];

  it("detecta toda variante de escrita/SQL cru perigoso", () => {
    for (const snippet of DANGEROUS_SNIPPETS) {
      expect(matchesAnyForbidden(snippet), `nao coberto pela guarda: ${snippet}`).toBe(true);
    }
  });

  it("nao bloqueia leitura legitima (findMany/count/groupBy/$queryRaw parametrizado)", () => {
    for (const snippet of SAFE_READS) {
      expect(matchesAnyForbidden(snippet), `leitura bloqueada por engano: ${snippet}`).toBe(false);
    }
  });
});
