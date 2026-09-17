/**
 * app-css.ts — as FOLHAS DE ESTILO do app publico, para os testes que leem CSS.
 *
 * Ate a divisao do CSS por rota (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md`)
 * havia uma folha so, e cada teste abria `apps/web/app/globals.css` pelo caminho.
 * Com folhas de rota, um teste preso ao caminho deixa de ver a regra que mudou de
 * arquivo — e uma trava como a de tema unico deixaria de cobrir a folha nova.
 *
 * A descoberta e por VARREDURA de `apps/web/app` e `apps/web/src`, nao por lista:
 * folha nova entra sozinha. A leitura passa pela porta unica (`source-text.ts`).
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readSourceWithoutComments, REPO_ROOT } from './source-text'

export const GLOBAL_STYLESHEET = 'apps/web/app/globals.css'

const ROOTS = ['apps/web/app', 'apps/web/src'] as const
const SKIP = new Set(['node_modules', '.next'])

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (entry.name.endsWith('.css')) out.push(rel)
  }
}

/** As folhas do app: a global primeiro, as demais em ordem alfabetica. */
export function discoverAppStylesheets(): string[] {
  const found: string[] = []
  for (const root of ROOTS) walk(root, found)
  return [GLOBAL_STYLESHEET, ...found.filter((file) => file !== GLOBAL_STYLESHEET).sort()]
}

/** Uma folha, sem comentario. */
export function readAppStylesheet(file: string): string {
  return readSourceWithoutComments(file)
}

/** Todas as folhas, sem comentario, concatenadas com a global primeiro. */
export function readAppCss(): string {
  return discoverAppStylesheets().map(readAppStylesheet).join('\n')
}
