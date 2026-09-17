/**
 * css-move-check.ts — a checagem ESTATICA da divisao do CSS por rota
 * (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md`).
 *
 * A paridade de estilo computado (`css-parity-chrome.ts`) so ve o que o
 * laboratorio renderiza. Esta checagem cobre o resto, comparando o `globals.css`
 * de uma referencia git (antes de qualquer mudanca) com as folhas de agora:
 *
 *  1. NADA SE REESCREVE: toda regra de agora existe, identica, na referencia.
 *     Mover e mover — regra nova ou alterada reprova.
 *  2. A ORDEM SE MANTEM: dentro de cada folha, as regras seguem a ordem que tinham
 *     no `globals.css` da referencia.
 *  3. QUEM FICOU NO GLOBAL NAO PASSA A PERDER: a folha de rota carrega DEPOIS de
 *     todo o `globals.css`. Uma regra que ficou no global e vinha depois da regra
 *     movida, empatando com ela (ver `lab/css-order.ts`), inverteria — reprova.
 *  4. EXCLUSIVIDADE: um bloco de classe e estilizado (como sujeito) numa folha so.
 *  5. REMOVIDA SO SE NAO USADA: regra que sumiu de todas as folhas nao pode citar
 *     classe que o codigo do app ainda usa.
 *
 * Uso: CSS_MOVE_BASE_REF=<ref git antes da mudanca> pnpm --filter @screena/web css:move-check
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { orderConflicts } from "./lab/css-order";
import { classTokens, type CssRule, parseCssRules, subjectBlocks } from "./lab/css-rules";
import { classUsedInSource } from "./lab/css-usage";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webDir, "..", "..");
const GLOBALS = "apps/web/app/globals.css";
const SKIP_DIRS = new Set(["node_modules", ".next", "__tests__"]);

function walk(relDir: string, accept: (name: string) => boolean, out: string[]): void {
  for (const entry of readdirSync(path.join(repoRoot, relDir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, accept, out);
    else if (accept(entry.name)) out.push(rel);
  }
}

/** Todas as folhas do app, com o `globals.css` primeiro. */
function discoverSheets(): string[] {
  const found: string[] = [];
  for (const root of ["apps/web/app", "apps/web/src"]) walk(root, (name) => name.endsWith(".css"), found);
  return [GLOBALS, ...found.filter((file) => file !== GLOBALS).sort()];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * O `globals.css` de ANTES da divisao: de uma referencia git (`CSS_MOVE_BASE_REF`)
 * ou de um arquivo exportado dela (`CSS_MOVE_BASE_FILE`), para copias de trabalho
 * sem `.git`.
 */
function readBase(): { label: string; css: string } {
  const file = process.env.CSS_MOVE_BASE_FILE ?? "";
  if (file !== "") return { label: file, css: readFileSync(file, "utf8") };
  const ref = process.env.CSS_MOVE_BASE_REF ?? "";
  if (ref === "") {
    throw new Error("informe CSS_MOVE_BASE_REF (ref git antes da divisao) ou CSS_MOVE_BASE_FILE (o globals.css dela)");
  }
  const css = execFileSync("git", ["show", `${ref}:${GLOBALS}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { label: ref, css };
}

function main(): void {
  const { label: baseRef, css: baseCss } = readBase();
  const baseRules = parseCssRules(baseCss);
  const pending = new Map<string, number[]>();
  for (const rule of baseRules) pending.set(rule.identity, [...(pending.get(rule.identity) ?? []), rule.index]);

  const errors: string[] = [];
  const sheets = discoverSheets().map((file) => {
    const rules = parseCssRules(readFileSync(path.join(repoRoot, file), "utf8"));
    const baseIndexes = rules.map((rule) => {
      const index = pending.get(rule.identity)?.shift();
      if (index === undefined) {
        errors.push(`[NOVA OU ALTERADA] ${file}:${rule.line} ${rule.prelude}`);
        return -1;
      }
      return index;
    });
    return { file, rules, baseIndexes };
  });

  // 2. ordem dentro de cada folha
  for (const sheet of sheets) {
    let last = -1;
    sheet.baseIndexes.forEach((index, i) => {
      if (index < 0) return;
      if (index < last) {
        const rule = sheet.rules[i] as CssRule;
        errors.push(`[ORDEM] ${sheet.file}:${rule.line} ${rule.prelude} veio antes de uma regra que a precedia`);
      }
      last = Math.max(last, index);
    });
  }

  // 3. regra movida x regra que ficou no global e vinha depois
  const globals = sheets[0] as (typeof sheets)[number];
  for (const sheet of sheets.slice(1)) {
    sheet.rules.forEach((moved, i) => {
      const movedIndex = sheet.baseIndexes[i] as number;
      if (movedIndex < 0) return;
      globals.rules.forEach((later, j) => {
        if ((globals.baseIndexes[j] as number) <= movedIndex) return;
        for (const conflict of orderConflicts(moved, later)) {
          errors.push(`[ORDEM INVERTIDA] ${sheet.file}:${moved.line} × ${GLOBALS}:${later.line} — ${conflict}`);
        }
      });
    });
  }

  // 4. exclusividade de bloco (como sujeito)
  const owners = new Map<string, Set<string>>();
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      for (const block of subjectBlocks(rule)) owners.set(block, new Set([...(owners.get(block) ?? []), sheet.file]));
    }
  }
  for (const [block, files] of owners) {
    if (files.size > 1) errors.push(`[EXCLUSIVIDADE] o bloco .${block} e estilizado em ${[...files].join(" e ")}`);
  }

  // 5. removidas de todas as folhas
  const leftover = new Set([...pending.values()].flat());
  const removed = baseRules.filter((rule) => leftover.has(rule.index));
  const sourceFiles: string[] = [];
  // `packages/ui` tambem: os componentes do pacote renderizam classe desta folha.
  for (const root of ["apps/web/app", "apps/web/src", "packages/ui/src"]) {
    walk(root, (name) => /\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\.tsx?$/.test(name), sourceFiles);
  }
  const source = sourceFiles.map((file) => readFileSync(path.join(repoRoot, file), "utf8")).join("\n");
  const remainingCss = sheets.flatMap((sheet) => sheet.rules.map((rule) => rule.identity)).join("\n");
  for (const rule of removed) {
    if (rule.kind === "at-block") {
      const keyframes = /^@keyframes\s+([\w-]+)/i.exec(rule.prelude);
      if (keyframes === null || new RegExp(`\\b${escapeRegex(keyframes[1] as string)}\\b`).test(remainingCss)) {
        errors.push(`[REMOVIDA EM USO] referencia:${rule.line} ${rule.prelude}`);
      }
      continue;
    }
    const used = [...new Set(rule.selectors.flatMap(classTokens))].filter((token) =>
      classUsedInSource(token, source),
    );
    if (used.length > 0) {
      errors.push(`[REMOVIDA EM USO] referencia:${rule.line} ${rule.prelude} — ainda usada: ${used.join(", ")}`);
    }
  }

  const totalBytes = (rules: readonly CssRule[]): number => rules.reduce((sum, rule) => sum + rule.bytes, 0);
  process.stdout.write(`\nCHECAGEM ESTATICA DA DIVISAO DO CSS — referencia ${baseRef}\n`);
  process.stdout.write(`  ${GLOBALS} na referencia: ${baseRules.length} regras, ${totalBytes(baseRules)} B\n`);
  for (const sheet of sheets) {
    process.stdout.write(`  ${sheet.file}: ${sheet.rules.length} regras, ${totalBytes(sheet.rules)} B\n`);
  }
  process.stdout.write(`  removidas de todas as folhas: ${removed.length} regras, ${totalBytes(removed)} B\n`);
  for (const error of errors.slice(0, 80)) process.stdout.write(`  ${error}\n`);
  if (errors.length > 80) process.stdout.write(`  ... e mais ${errors.length - 80}\n`);
  process.stdout.write(
    errors.length === 0 ? "\nRESULTADO: ordem e exclusividade preservadas\n" : `\nRESULTADO: ${errors.length} problema(s)\n`,
  );
  if (errors.length > 0) process.exitCode = 1;
}

main();
