/**
 * css-route-sheets.test.ts — R2 da divisao do CSS por rota
 * (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md` §4).
 *
 * Uma folha de rota so carrega nas rotas cujo grafo de import a alcanca. Se um
 * bloco dela for escrito por um componente que outra rota tambem renderiza, essa
 * outra rota pinta o bloco SEM estilo na primeira carga — e parece certa depois de
 * visitar a rota dona, porque no App Router as folhas acumulam na navegacao. Nem a
 * paridade de estilo pega isso se o laboratorio nao renderizar a outra rota com o
 * bloco; o grafo pega.
 */

import { describe, expect, it } from 'vitest'

import { blockOf, classTokens, parseCssRules, subjectBlocks } from '../../apps/web/scripts/lab/css-rules'
import { classUsedInSource } from '../../apps/web/scripts/lab/css-usage'
import { discoverAppStylesheets, GLOBAL_STYLESHEET, readAppStylesheet } from '../support/app-css'
import {
  APP_ROUTE_ENTRY,
  buildImportGraph,
  type ImportGraph,
  importSpecifiers,
  reachable,
  ROOT_LAYOUT,
  sheetCoverageViolations,
} from '../support/import-graph'

const graph = buildImportGraph()
const layoutReach = reachable(graph, ROOT_LAYOUT)
const entries = graph.files.filter((file) => APP_ROUTE_ENTRY.test(file))
const routeReach = new Map(entries.map((entry) => [entry, new Set([...reachable(graph, entry), ...layoutReach])]))
const codeFiles = graph.files.filter((file) => !file.endsWith('.css'))

/** Bloco -> arquivos que escrevem alguma classe dele, para os blocos que uma folha estiliza. */
function blocksOf(css: string, source: ImportGraph['source']): Map<string, Set<string>> {
  const rules = parseCssRules(css).filter((rule) => rule.kind === 'style')
  const tokens = new Map<string, Set<string>>()
  for (const token of rules.flatMap((rule) => rule.selectors.flatMap(classTokens))) {
    tokens.set(blockOf(token), new Set([...(tokens.get(blockOf(token)) ?? []), token]))
  }
  const users = new Map<string, Set<string>>()
  for (const block of new Set(rules.flatMap(subjectBlocks))) {
    const blockTokens = [...(tokens.get(block) ?? [])]
    users.set(
      block,
      new Set(
        codeFiles.filter(
          (file) =>
            source(file).includes(block) && blockTokens.some((token) => classUsedInSource(token, source(file))),
        ),
      ),
    )
  }
  return users
}

describe('grafo de import do app publico', () => {
  it('CONTROLE: acha as rotas, o layout alcanca a folha global e a pagina alcanca o proprio painel', () => {
    expect(entries.length).toBeGreaterThan(40)
    expect(layoutReach.has(GLOBAL_STYLESHEET)).toBe(true)
    expect(routeReach.get('apps/web/app/pt/importar/page.tsx')?.has('apps/web/app/pt/importar/import-panel.tsx')).toBe(
      true,
    )
  })

  it('import de tipo nao carrega modulo; import de efeito e dinamico carregam', () => {
    const code = [
      "import type { A } from './a'",
      "export type { B } from './b'",
      "import { c } from './c'",
      "import './d.css'",
      "const e = await import('./e')",
      "export { f } from './f'",
    ].join('\n')
    expect(importSpecifiers(code)).toEqual(['./c', './d.css', './e', './f'])
  })
})

describe('R2: toda rota que escreve um bloco de folha de rota carrega a folha', () => {
  const routeSheets = discoverAppStylesheets().filter((file) => file !== GLOBAL_STYLESHEET)
  const sheetBlocks = new Map(routeSheets.map((sheet) => [sheet, blocksOf(readAppStylesheet(sheet), graph.source)]))

  it('CONTROLE: acha as folhas de rota, e cada uma estiliza bloco que alguma rota escreve', () => {
    expect(routeSheets.length).toBeGreaterThan(0)
    for (const [sheet, blocks] of sheetBlocks) {
      expect([...blocks.values()].some((users) => users.size > 0), sheet).toBe(true)
    }
  })

  it('nenhuma folha de rota e importada pelo layout raiz (la ela seria global)', () => {
    expect(routeSheets.filter((sheet) => layoutReach.has(sheet))).toEqual([])
  })

  it('cada bloco de cada folha de rota so aparece em rota que carrega a folha', () => {
    expect(sheetCoverageViolations(routeReach, sheetBlocks)).toEqual([])
  })

  it('CONTROLE NEGATIVO: bloco do importador numa folha que so a conta carrega e acusado', () => {
    const fake = 'apps/web/app/pt/conta/fake.css'
    const reach = new Map(
      [...routeReach].map(([entry, files]) => [
        entry,
        entry === 'apps/web/app/pt/conta/page.tsx' ? new Set([...files, fake]) : files,
      ]),
    )
    const users = blocksOf('.imp-drop { color: red }', graph.source)
    expect(users.get('imp-drop')?.size).toBeGreaterThan(0)
    const violations = sheetCoverageViolations(reach, new Map([[fake, users]]))
    expect(violations.some((line) => line.includes('.imp-drop aparece em apps/web/app/pt/importar/page.tsx'))).toBe(true)
  })

  it('CONTROLE NEGATIVO: folha que nenhuma rota importa e acusada', () => {
    const orphan = 'apps/web/app/pt/orfa.css'
    expect(sheetCoverageViolations(routeReach, new Map([[orphan, new Map()]]))).toEqual([
      `${orphan}: nenhuma rota importa esta folha`,
    ])
  })
})
