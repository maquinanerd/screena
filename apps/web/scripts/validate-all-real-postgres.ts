/**
 * validate-all-real-postgres.ts - Comando agregador dos validadores
 * DESCARTAVEIS de paginas publicas contra PostgreSQL real efemero.
 *
 * Executa, em sequencia, na mesma ordem citada pela documentacao de
 * validacao do projeto:
 *
 *   1. validate:news-pages
 *   2. validate:entity-indexes
 *   3. validate:movie-page
 *   4. validate:series-page
 *   5. validate:person-page
 *   6. validate:person-eligibility
 *
 * Cada validador sobe/derruba o seu PROPRIO PostgreSQL efemero
 * (`embedded-postgres`), em porta livre e diretorio temporario dedicado, e
 * garante a propria limpeza no bloco `finally` mesmo em caso de erro. Rodar
 * todos em sequencia aqui NAO introduz banco compartilhado nem estado
 * cruzado entre validadores.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nao roda no render, no build de
 * app, nem em producao. ZERO rede, ZERO Gemini, ZERO TMDB — cada validador so
 * le o seu PostgreSQL efemero local.
 *
 * Uso: pnpm --filter @screena/web validate:all
 *      corepack pnpm validate:all   (a partir da raiz do monorepo)
 *
 * Saida: exit code 0 somente se TODOS os validadores passarem 100% das
 * assercoes; exit code 1 caso qualquer um falhe (o script continua rodando os
 * demais validadores mesmo apos uma falha, para reportar o quadro completo).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const webDir = path.resolve(scriptDir, ".."); // apps/web
const webRequire = createRequire(path.join(webDir, "package.json"));

/** Resolve o entrypoint da CLI do tsx (para invocar com `node`, sem shell). */
function tsxBin(): string {
  const pkgPath = webRequire.resolve("tsx/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.tsx;
  return path.join(path.dirname(pkgPath), rel);
}

interface ValidatorSpec {
  readonly key: string;
  readonly label: string;
  readonly script: string;
}

const VALIDATORS: readonly ValidatorSpec[] = [
  { key: "validate:news-pages", label: "Paginas de noticias", script: "validate-news-pages-real-postgres.ts" },
  { key: "validate:entity-indexes", label: "Listagens (filmes/series/pessoas)", script: "validate-entity-indexes-real-postgres.ts" },
  { key: "validate:movie-page", label: "Pagina de filme", script: "validate-movie-page-real-postgres.ts" },
  { key: "validate:series-page", label: "Pagina de serie", script: "validate-series-page-real-postgres.ts" },
  { key: "validate:person-page", label: "Pagina de pessoa", script: "validate-person-page-real-postgres.ts" },
  {
    key: "validate:person-eligibility",
    label: "Gate de elegibilidade de pessoa (sitemap)",
    script: "validate-person-eligibility-real-postgres.ts",
  },
];

interface ValidatorOutcome {
  readonly spec: ValidatorSpec;
  readonly exitCode: number;
  readonly passed: number | null;
  readonly total: number | null;
}

/** Extrai "RESUMO: X/Y checks OK." da saida combinada do validador, se presente. */
function parseSummary(output: string): { passed: number | null; total: number | null } {
  const match = /RESUMO:\s*(\d+)\/(\d+)\s*checks OK/.exec(output);
  if (match === null) return { passed: null, total: null };
  return { passed: Number(match[1]), total: Number(match[2]) };
}

function runValidator(spec: ValidatorSpec, bin: string): ValidatorOutcome {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`=== ${spec.key} — ${spec.label} ===`);
  console.log(`${"=".repeat(72)}\n`);

  const result = spawnSync(process.execPath, [bin, path.join(scriptDir, spec.script)], {
    cwd: webDir,
    env: process.env,
    encoding: "utf8",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout.length > 0) process.stdout.write(stdout);
  if (stderr.length > 0) process.stderr.write(stderr);

  const exitCode = result.status ?? 1;
  const { passed, total } = parseSummary(stdout);
  return { spec, exitCode, passed, total };
}

function main(): void {
  const bin = tsxBin();
  const outcomes: ValidatorOutcome[] = VALIDATORS.map((spec) => runValidator(spec, bin));

  console.log(`\n${"=".repeat(72)}`);
  console.log("=== RESUMO AGREGADO ===");
  console.log(`${"=".repeat(72)}\n`);

  let anyFailed = false;
  let totalPassed = 0;
  let totalChecks = 0;
  for (const outcome of outcomes) {
    const ok = outcome.exitCode === 0;
    if (!ok) anyFailed = true;
    const countLabel =
      outcome.passed !== null && outcome.total !== null
        ? `${outcome.passed}/${outcome.total}`
        : ok
          ? "ok"
          : "falhou";
    if (outcome.passed !== null && outcome.total !== null) {
      totalPassed += outcome.passed;
      totalChecks += outcome.total;
    }
    console.log(`[${ok ? "PASS" : "FAIL"}] ${outcome.spec.key.padEnd(24)} ${countLabel}`);
  }

  console.log(`\nTotal agregado: ${totalPassed}/${totalChecks} assercoes OK em ${outcomes.length} validadores.`);

  if (anyFailed) {
    console.error("\nResultado: FALHOU. Pelo menos um validador nao passou 100% das assercoes.");
    process.exit(1);
  }
  console.log("\nResultado: PASSOU. Todos os validadores descartaveis passaram 100% das assercoes.");
}

main();
