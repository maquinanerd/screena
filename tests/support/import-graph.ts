/**
 * import-graph.ts — o GRAFO DE IMPORT do app publico, para os testes que precisam
 * saber o que cada rota carrega.
 *
 * Existe para a regra R2 da divisao do CSS por rota
 * (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md` §4): uma folha de rota so vale nas
 * rotas cujo grafo a importa. Um bloco dela usado por um componente que OUTRA rota
 * tambem renderiza sai sem estilo nessa outra rota na primeira carga — e parece
 * certo depois de visitar a rota dona, porque as folhas acumulam na navegacao.
 *
 * O grafo e LIDO, nao executado: `import`/`export ... from`, import de efeito
 * (`import './x.css'`) e `import('...')`, relativos ou pelo alias `@screena/ui`.
 * `import type` fica de fora — nao carrega modulo. A leitura passa pela porta unica
 * (`source-text.ts`): import citado em comentario nao vira aresta.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { readSourceWithoutComments, REPO_ROOT } from './source-text'

/** As raizes que o render publico alcanca e que escrevem classe de CSS. */
export const APP_SOURCE_ROOTS = ['apps/web/app', 'apps/web/src', 'packages/ui/src'] as const

/** Arquivos de entrada de rota do App Router (o layout raiz vale para todas). */
export const APP_ROUTE_ENTRY =
  /^apps\/web\/app\/(?:.*\/)?(?:page|not-found|error|global-error|loading|template|default)\.tsx$/

export const ROOT_LAYOUT = 'apps/web/app/layout.tsx'

const CODE = /\.(?:ts|tsx|js|jsx|mjs)$/
const SKIP = new Set(['node_modules', '.next', '__tests__'])
const ALIASES: Readonly<Record<string, string>> = { '@screena/ui': 'packages/ui/src/index.ts' }
const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx']
const IMPORT =
  /\b(import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

export interface ImportGraph {
  /** Codigo e folhas (`.css`), relativos a raiz do repositorio. */
  readonly files: readonly string[]
  readonly edges: ReadonlyMap<string, readonly string[]>
  /** O codigo SEM comentario (vazio para `.css`). */
  source(file: string): string
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else if (entry.name.endsWith('.css') || (CODE.test(entry.name) && !/\.(?:test|spec)\.[jt]sx?$/.test(entry.name))) {
      out.push(rel)
    }
  }
}

/** Resolve um especificador para um arquivo conhecido, ou `null` (pacote externo). */
export function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  const alias = ALIASES[specifier]
  if (alias !== undefined) return known.has(alias) ? alias : null
  if (!specifier.startsWith('.')) return null
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  for (const extension of EXTENSIONS) {
    if (known.has(`${base}${extension}`)) return `${base}${extension}`
  }
  return null
}

/** Os especificadores que um codigo importa em tempo de execucao. */
export function importSpecifiers(code: string): string[] {
  const found: string[] = []
  for (const match of code.matchAll(IMPORT)) {
    if (match[2] !== undefined) continue
    const specifier = match[3] ?? match[4] ?? match[5]
    if (specifier !== undefined) found.push(specifier)
  }
  return found
}

export function buildImportGraph(roots: readonly string[] = APP_SOURCE_ROOTS): ImportGraph {
  const files: string[] = []
  for (const root of roots) walk(root, files)
  const known = new Set(files)
  const sources = new Map<string, string>()
  const edges = new Map<string, string[]>()
  for (const file of files) {
    if (file.endsWith('.css')) {
      sources.set(file, '')
      edges.set(file, [])
      continue
    }
    const code = readSourceWithoutComments(file)
    sources.set(file, code)
    edges.set(
      file,
      importSpecifiers(code)
        .map((specifier) => resolveImport(file, specifier, known))
        .filter((target): target is string => target !== null),
    )
  }
  return { files, edges, source: (file) => sources.get(file) ?? '' }
}

/** Tudo que `entry` alcanca pelo grafo, incluindo ela mesma. */
export function reachable(graph: ImportGraph, entry: string): Set<string> {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const file = stack.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    for (const target of graph.edges.get(file) ?? []) stack.push(target)
  }
  return seen
}

/**
 * R2, como funcao pura: toda rota que alcanca um arquivo que USA um bloco de uma
 * folha de rota tem de alcancar a folha. E folha que nenhuma rota alcanca e folha
 * que nao carrega em lugar nenhum.
 *
 * `routeReach`: entrada de rota -> arquivos alcancados (ja com o layout raiz).
 * `sheetBlocks`: folha -> bloco -> arquivos que escrevem alguma classe do bloco.
 */
export function sheetCoverageViolations(
  routeReach: ReadonlyMap<string, ReadonlySet<string>>,
  sheetBlocks: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>,
): string[] {
  const violations: string[] = []
  for (const [sheet, blocks] of sheetBlocks) {
    const loadedBy = [...routeReach].filter(([, files]) => files.has(sheet)).map(([entry]) => entry)
    if (loadedBy.length === 0) violations.push(`${sheet}: nenhuma rota importa esta folha`)
    for (const [block, users] of blocks) {
      for (const [entry, files] of routeReach) {
        if (files.has(sheet)) continue
        const user = [...users].find((file) => files.has(file))
        if (user !== undefined) {
          violations.push(`${sheet}: .${block} aparece em ${entry} (por ${user}), que nao carrega a folha`)
        }
      }
    }
  }
  return violations
}
