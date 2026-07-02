/**
 * Trava de ESPELHAMENTO: os enums hardcoded do admin (usados como uniao de string
 * literals p/ tipar os writes/filtros SEM importar `@prisma/client`) DEVEM ser
 * identicos aos enums reais de `packages/db/prisma/schema.prisma`.
 *
 * Motivo (revisao adversarial da Fase 7A): o admin evita importar o Prisma Client
 * (resolucao pnpm nao garante o pacote no node_modules do app) e, no lugar, define
 * `REVIEW_STATUSES`/`INDEX_DECISIONS`/`ENTITY_TYPES`/`CONTENT_BLOCK_TYPES` a mao. A
 * atribuicao estrutural ao Prisma Client so garante que o admin nao usa um valor
 * INEXISTENTE — nao garante que ele conhece TODOS os valores. Se o schema ganhar
 * um valor de enum, as listas ficariam silenciosamente stale (opcao some do
 * dropdown). Este teste transforma esse drift silencioso em falha ruidosa: le o
 * schema como TEXTO (sem importar o Prisma Client) e exige igualdade exata.
 *
 * Se falhar: alinhe a constante do admin ao enum do schema — nunca o contrario.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { INDEX_DECISIONS, REVIEW_STATUSES } from "../../apps/admin/src/lib/editorial-action-policy";
import { CONTENT_BLOCK_TYPES, ENTITY_TYPES } from "../../apps/admin/src/lib/editorial-filters";

const SCHEMA_PATH = resolve(process.cwd(), "packages", "db", "prisma", "schema.prisma");

/** Extrai os valores de um `enum <name> { ... }` do schema (texto), sem comentarios. */
function enumValues(schema: string, name: string): string[] {
  const match = new RegExp(`enum\\s+${name}\\s*\\{([^}]*)\\}`).exec(schema);
  if (match === null) throw new Error(`enum ${name} nao encontrado no schema`);
  return (match[1] ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0);
}

describe("enums do admin espelham packages/db/prisma/schema.prisma (anti-drift)", () => {
  let schema = "";

  it("le o schema real", async () => {
    schema = await readFile(SCHEMA_PATH, "utf-8");
    expect(schema.length).toBeGreaterThan(0);
  });

  it("REVIEW_STATUSES == enum ReviewStatus", async () => {
    schema = schema || (await readFile(SCHEMA_PATH, "utf-8"));
    expect([...REVIEW_STATUSES]).toEqual(enumValues(schema, "ReviewStatus"));
  });

  it("INDEX_DECISIONS == enum IndexDecision", async () => {
    schema = schema || (await readFile(SCHEMA_PATH, "utf-8"));
    expect([...INDEX_DECISIONS]).toEqual(enumValues(schema, "IndexDecision"));
  });

  it("ENTITY_TYPES == enum EntityType", async () => {
    schema = schema || (await readFile(SCHEMA_PATH, "utf-8"));
    expect([...ENTITY_TYPES]).toEqual(enumValues(schema, "EntityType"));
  });

  it("CONTENT_BLOCK_TYPES == enum ContentBlockType", async () => {
    schema = schema || (await readFile(SCHEMA_PATH, "utf-8"));
    expect([...CONTENT_BLOCK_TYPES]).toEqual(enumValues(schema, "ContentBlockType"));
  });

  it("o parser de enum nao e vacuo (acha valores conhecidos)", async () => {
    schema = schema || (await readFile(SCHEMA_PATH, "utf-8"));
    expect(enumValues(schema, "ReviewStatus")).toContain("published");
    expect(enumValues(schema, "EntityType")).toContain("movie");
  });
});
