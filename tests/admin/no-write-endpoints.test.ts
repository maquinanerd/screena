/**
 * Guarda de endpoints/server actions do admin editorial.
 *
 * A fatia atual do admin tem uma unica superficie de escrita allowlisted:
 * `apps/admin/src/server/editorial-actions.ts`, travada por feature flag e por
 * testes especificos de allowlist. Todo o resto continua proibido: nenhuma
 * outra Server Action e nenhum route handler de escrita.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN_DIRS = [
  resolve(process.cwd(), "apps", "admin", "app"),
  resolve(process.cwd(), "apps", "admin", "src"),
];
const CODE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "coverage"]);

const FORBIDDEN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/^\s*["']use server["'];?\s*$/m, '"use server" server action'],
  [/\bexport\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/, "route handler de escrita"],
  [/\bexport\s+const\s+(?:POST|PUT|PATCH|DELETE)\b/, "route handler de escrita"],
];
const ALLOWED_SERVER_ACTION_FILES = new Set([
  join("apps", "admin", "src", "server", "editorial-actions.ts"),
]);

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

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue;
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
    if (!(await pathExists(dir))) continue;
    const files = await collectCodeFiles(dir);
    for (const file of files) {
      const content = stripComments(await readFile(file, "utf-8"));
      const lines = content.split(/\r?\n/);
      const relativeFile = relative(process.cwd(), file);
      lines.forEach((line, index) => {
        for (const [pattern, rule] of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            if (rule === '"use server" server action' && ALLOWED_SERVER_ACTION_FILES.has(relativeFile)) {
              continue;
            }
            violations.push({
              file: relativeFile,
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

describe("admin editorial nao expoe endpoints ou server actions de escrita", () => {
  let violations: Violation[] = [];

  beforeAll(async () => {
    violations = await findViolations();
  });

  it('nao contem "use server" fora do allowlist nem handlers POST/PUT/PATCH/DELETE', () => {
    expect(
      violations,
      `Admin read-only nao pode expor mutacoes. Ocorrencias: ${JSON.stringify(violations, null, 2)}`,
    ).toEqual([]);
  });

  it("existe app admin real para varrer (guarda nao e vacua)", async () => {
    const appDir = resolve(process.cwd(), "apps", "admin", "app");
    expect(await pathExists(appDir)).toBe(true);
    const files = await collectCodeFiles(appDir);
    expect(files.length).toBeGreaterThan(0);
  });
});
