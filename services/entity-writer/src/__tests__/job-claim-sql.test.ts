/**
 * Teste estrutural do adapter Prisma de claim.
 *
 * `job-claim.ts` fica fora do typecheck e depende de SQL raw com Prisma; sem um
 * Postgres de integracao nesta fase, travamos aqui as propriedades criticas do
 * SQL: `--job-id` tambem filtra por idioma e os caminhos seguem usando
 * `FOR UPDATE SKIP LOCKED`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("../persistence/job-claim.ts", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

describe("job-claim SQL", () => {
  it("claim por jobId respeita languageCode e mantem lock concorrente", () => {
    expect(source).toMatch(
      /if \(jobId !== undefined\) \{[\s\S]*id = \$\{BigInt\(jobId\)\} AND language_code = \$\{language\}[\s\S]*FOR UPDATE SKIP LOCKED/,
    );
  });

  it("claim normal por idioma continua sem jobId e com SKIP LOCKED", () => {
    expect(source).toMatch(
      /if \(language !== undefined\) \{[\s\S]*WHERE status::text = 'queued' AND language_code = \$\{language\}[\s\S]*FOR UPDATE SKIP LOCKED/,
    );
  });
});
