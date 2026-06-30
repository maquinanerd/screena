/**
 * inspect-store-readonly.test.ts — Teste ESTRUTURAL de read-only.
 *
 * `inspect-store.ts` (adapter Prisma) e `bin/inspect.ts` ficam fora do typecheck
 * e nao tem integration test com Postgres aqui. Travamos a propriedade critica:
 * a inspecao e SOMENTE LEITURA — nenhum metodo de escrita do Prisma
 * (create/update/delete/upsert), nenhum raw (executeRaw/queryRaw) e nenhuma
 * chamada/criacao de job, runner ou Gemini. So leitura via groupBy/findMany.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync(
  fileURLToPath(new URL("../persistence/inspect-store.ts", import.meta.url)),
  "utf8",
);
const binSource = readFileSync(
  fileURLToPath(new URL("../../bin/inspect.ts", import.meta.url)),
  "utf8",
);

/** Metodos de escrita do Prisma seguidos de chamada — proibidos na inspecao. */
const WRITE_METHODS = /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/;
/** Raw SQL — proibido (read-only nao precisa de raw). */
const RAW_SQL = /\$?(executeRaw|queryRaw)/;
/** Uso REAL de Gemini (import/identificador) — distinto de mencao em prosa. */
const GEMINI_IMPORT = /from\s+["'][^"']*gemini/i;
const GEMINI_USAGE = /Gemini(Port|Adapter)|createGemini|FakeGemini/;

describe("inspect-store.ts (estrutural, read-only)", () => {
  it("nao usa metodo de escrita do Prisma", () => {
    expect(storeSource).not.toMatch(WRITE_METHODS);
  });

  it("nao usa raw SQL (executeRaw/queryRaw)", () => {
    expect(storeSource).not.toMatch(RAW_SQL);
  });

  it("usa apenas leitura (groupBy/findMany)", () => {
    expect(storeSource).toMatch(/\.groupBy\(/);
    expect(storeSource).toMatch(/\.findMany\(/);
  });

  it("nao importa nem usa Gemini", () => {
    expect(storeSource).not.toMatch(GEMINI_IMPORT);
    expect(storeSource).not.toMatch(GEMINI_USAGE);
  });
});

describe("bin/inspect.ts (estrutural, read-only)", () => {
  it("nao escreve no banco (sem create/update/delete/upsert)", () => {
    expect(binSource).not.toMatch(WRITE_METHODS);
  });

  it("nao importa/usa Gemini, enqueue, runner nem publicacao", () => {
    expect(binSource).not.toMatch(GEMINI_IMPORT);
    expect(binSource).not.toMatch(GEMINI_USAGE);
    expect(binSource).not.toMatch(/processJobs|createJob|\.publish\(/);
  });

  it("exige DATABASE_URL antes de tocar o banco", () => {
    expect(binSource).toMatch(/requireDatabaseUrl/);
  });
});
