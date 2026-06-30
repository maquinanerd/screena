/**
 * Teste estrutural do adapter Prisma de content_blocks.
 *
 * `content-block-store.ts` fica fora do typecheck e nao tem integration test com
 * Postgres nesta fase. Travamos aqui as propriedades criticas do contrato novo:
 * `save` retorna o id do bloco RECEM-CRIADO (via `create` com `select: { id }`),
 * convertido para string — nunca o id de um bloco arquivado/existente.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("../persistence/content-block-store.ts", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("content-block-store adapter (estrutural)", () => {
  it("create seleciona o id do bloco recem-criado", () => {
    expect(source).toMatch(/contentBlock\.create\(\{[\s\S]*?select:\s*\{\s*id:\s*true\s*\}/);
    expect(source).toMatch(/const created = await tx\.contentBlock\.create/);
    expect(source).toMatch(/return created\.id/);
  });

  it("save retorna { blockId } como string", () => {
    expect(source).toMatch(/blockId:\s*blockId\.toString\(\)/);
  });
});
