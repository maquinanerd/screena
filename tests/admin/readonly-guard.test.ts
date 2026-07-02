/**
 * Guarda de ESCRITA CONTROLADA do admin editorial (Fase 7A).
 *
 * Ate a Fase 6C o admin era SOMENTE LEITURA (zero escrita Prisma). A partir da
 * Fase 7A ele passa a ter ESCRITA EDITORIAL LIMITADA — porem so:
 *   - no unico arquivo allowlisted `apps/admin/src/server/editorial-actions.ts`; e
 *   - com o metodo `.update(` (nunca create/delete/upsert/*Many/raw).
 *
 * Esta guarda varre `apps/admin/src` + `apps/admin/app` e afirma:
 *   1. NENHUM arquivo usa metodo de escrita PROIBIDO (create, delete, upsert,
 *      createMany, updateMany, deleteMany, *AndReturn, SQL de escrita/cru) —
 *      em lugar nenhum, sem excecao.
 *   2. `.update(` so aparece no arquivo de acoes editoriais; qualquer outro
 *      arquivo que use `.update(` e violacao.
 *
 * Comentarios sao neutralizados antes da varredura (a prosa pode citar
 * "create/delete/update" ao descrever o que o arquivo NAO faz).
 *
 * Se um dia esta guarda falhar, a correcao e remover a escrita indevida (ou
 * mante-la dentro do allowlist com um unico `.update`), nunca relaxar a regra.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN_DIRS = [
  resolve(process.cwd(), "apps", "admin", "src"),
  resolve(process.cwd(), "apps", "admin", "app"),
];
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

/** Unico arquivo autorizado a escrever (via `.update(`). Caminho relativo (posix). */
const WRITE_ALLOWLIST_FILE = "apps/admin/src/server/editorial-actions.ts";

/** Metodos de escrita PROIBIDOS em qualquer arquivo do admin (sem excecao). */
const FORBIDDEN_WRITES: ReadonlyArray<[string, string]> = [
  [".create(", "prisma .create()"],
  [".delete(", "prisma .delete()"],
  [".upsert(", "prisma .upsert()"],
  [".createMany(", "prisma .createMany()"],
  [".updateMany(", "prisma .updateMany()"],
  [".deleteMany(", "prisma .deleteMany()"],
  [".createManyAndReturn(", "prisma .createManyAndReturn()"],
  [".updateManyAndReturn(", "prisma .updateManyAndReturn()"],
  ["$executeRaw", "prisma $executeRaw (SQL de escrita)"],
  [".$executeRawUnsafe(", "prisma $executeRawUnsafe (SQL cru de escrita)"],
  [".$queryRawUnsafe(", "prisma $queryRawUnsafe (SQL cru arbitrario)"],
];

/** Escrita CONDICIONAL: `.update(` so no arquivo de acoes editoriais. */
const CONDITIONAL_UPDATE = ".update(";

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
  if (!(await pathExists(dir))) return [];
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

/** Caminho relativo ao cwd normalizado para separador posix. */
function relPosix(file: string): string {
  return relative(process.cwd(), file).split(sep).join("/");
}

/** Neutraliza comentarios (bloco e linha) preservando o numero de linhas. */
export function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue; // parte de '://'
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const dir of ADMIN_DIRS) {
    for (const file of await collectCodeFiles(dir)) {
      const rel = relPosix(file);
      const isAllowlist = rel === WRITE_ALLOWLIST_FILE;
      const code = stripComments(await readFile(file, "utf-8"));
      code.split(/\r?\n/).forEach((line, index) => {
        for (const [needle, rule] of FORBIDDEN_WRITES) {
          if (line.includes(needle)) {
            violations.push({ file: rel, rule, line: index + 1, snippet: line.trim() });
          }
        }
        // `.update(` fora do arquivo allowlisted = violacao.
        if (!isAllowlist && line.includes(CONDITIONAL_UPDATE)) {
          violations.push({
            file: rel,
            rule: "prisma .update() fora do allowlist",
            line: index + 1,
            snippet: line.trim(),
          });
        }
      });
    }
  }
  return violations;
}

describe("admin editorial: escrita so no allowlist (Fase 7A)", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it("nao usa metodo de escrita proibido (create/delete/upsert/*Many/raw) em lugar nenhum", () => {
    const offenders = violations.filter((v) => v.rule !== "prisma .update() fora do allowlist");
    expect(
      offenders,
      `Escrita proibida no admin. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("`.update()` so aparece no arquivo de acoes editoriais (allowlist)", () => {
    const offenders = violations.filter((v) => v.rule === "prisma .update() fora do allowlist");
    expect(
      offenders,
      `.update() so pode existir em ${WRITE_ALLOWLIST_FILE}. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it("o arquivo allowlist existe e realmente exerce `.update()` (guarda nao e vacua)", async () => {
    const abs = resolve(process.cwd(), ...WRITE_ALLOWLIST_FILE.split("/"));
    expect(await pathExists(abs)).toBe(true);
    const code = stripComments(await readFile(abs, "utf-8"));
    expect(code.includes(CONDITIONAL_UPDATE)).toBe(true);
    // E so os dois updates editoriais previstos (artigo + content_block).
    const matches = code.split(CONDITIONAL_UPDATE).length - 1;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it("existe codigo de servidor real do admin para varrer (guarda nao e vacua)", async () => {
    const serverDir = resolve(process.cwd(), "apps", "admin", "src", "server");
    expect(await pathExists(serverDir)).toBe(true);
    const files = await collectCodeFiles(serverDir);
    expect(files.length).toBeGreaterThan(0);
  });
});

/**
 * Auto-teste das listas de needles: garante que a guarda NAO e vacua e que
 * leitura legitima nao e bloqueada por engano.
 */
describe("as listas de escrita cobrem variantes perigosas e poupam leitura", () => {
  const matchesForbidden = (snippet: string): boolean =>
    FORBIDDEN_WRITES.some(([needle]) => snippet.includes(needle));

  const DANGEROUS: ReadonlyArray<string> = [
    "await prisma.article.create({ data })",
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

  it("detecta toda variante de escrita/SQL cru perigoso (exceto o `.update` condicional)", () => {
    for (const snippet of DANGEROUS) {
      expect(matchesForbidden(snippet), `nao coberto: ${snippet}`).toBe(true);
    }
  });

  it("`.updateMany(` nao e confundido com o `.update(` permitido", () => {
    // O needle condicional e exatamente ".update(" — nao casa com ".updateMany(".
    expect("prisma.x.updateMany({".includes(CONDITIONAL_UPDATE)).toBe(false);
    expect("prisma.x.update({".includes(CONDITIONAL_UPDATE)).toBe(true);
  });

  it("nao bloqueia leitura legitima (findMany/count/groupBy/$queryRaw parametrizado)", () => {
    for (const snippet of SAFE_READS) {
      expect(matchesForbidden(snippet), `leitura bloqueada por engano: ${snippet}`).toBe(false);
    }
  });
});
