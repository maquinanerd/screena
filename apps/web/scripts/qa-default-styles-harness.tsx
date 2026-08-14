/**
 * qa-default-styles-harness.tsx — Monta um HTML estatico com componentes REAIS
 * + o `globals.css` REAL, para que um navegador de verdade meca o ESTILO
 * COMPUTADO de cada elemento.
 *
 * Por que um harness e nao jsdom: jsdom nao tem folha de estilo de UA. Um
 * `<button>` sem reset devolve `backgroundColor: ''` la, e o defeito que foi
 * para producao — o retangulo `buttonface` atras da aba — passaria verde. So
 * Chromium (ou qualquer engine real) aplica `appearance:auto` + `buttonface`,
 * e so por isso a asercao deste arquivo tem valor.
 *
 * Por que componentes reais e nao markup copiado: markup copiado envelhece em
 * silencio. Se `PopularThisWeek` trocar a classe da aba amanha, um harness com
 * HTML colado continua medindo a classe velha e continua verde.
 *
 * Consumido por tests/e2e/browser-default-styles.spec.ts.
 * Nao e evidencia de layout: sem hidratacao e sem a fonte servida pelo app.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { PopularThisWeek, type PopularRankingPanel } from '../app/_components/popular-this-week'
import { SiteFooter } from '../app/_components/site-footer'
import { RANKING_TABS, type RankedTitle } from '../src/lib/popular-rankings'

const root = path.resolve(import.meta.dirname, '..')
const outDir = process.argv[2] ?? path.join(root, '.qa-default-styles')

const css = readFileSync(path.join(root, 'app/globals.css'), 'utf8')

function titles(count: number): RankedTitle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `movie:${String(i)}`,
    rank: i + 1,
    title: `Titulo ${String(i + 1)}`,
    href: `/pt/filmes/titulo-${String(i + 1)}/`,
    // Sem rede no harness: o poster ausente exercita a moldura neutra, que e
    // um caminho real do componente (`posterUrl: null`).
    posterUrl: null,
  }))
}

/**
 * As quatro abas da home, em DUAS instancias.
 *
 * O componente so renderiza o painel ATIVO, entao uma instancia so nunca tem os
 * dois estados no DOM ao mesmo tempo. A primeira instancia abre numa aba com
 * itens (trilha de posteres); a segunda abre numa aba VAZIA, e e a unica que
 * poe `.pop-empty` — "Nada por aqui esta semana.", texto nao-interativo sobre a
 * faixa escura — ao alcance do medidor. Sem a segunda instancia a asercao de
 * cor desse texto passaria por ausencia, nao por acerto.
 */
const panels: PopularRankingPanel[] = RANKING_TABS.home.map((tab, index) => ({
  tab,
  items: index === 0 ? titles(6) : [],
}))

const markup = renderToStaticMarkup(
  React.createElement(
    React.Fragment,
    null,
    React.createElement(PopularThisWeek, {
      headingId: 'qa-popular-cheia',
      initialSlug: RANKING_TABS.home[0]!.slug,
      panels,
    }),
    React.createElement(PopularThisWeek, {
      headingId: 'qa-popular-vazia',
      initialSlug: RANKING_TABS.home[1]!.slug,
      panels,
    }),
    React.createElement(SiteFooter),
  ),
)

/* ------------------------------------------------------------------ */
/* Sondas de lista                                                     */
/*                                                                     */
/* Renderizar so dois componentes cobre poucos <ul>. O marcador do     */
/* navegador, porem, vaza por CLASSE — e a lista de classes esta no    */
/* codigo-fonte. Entao a COBERTURA vem do fonte (varre o JSX atras de  */
/* <ul|ol className>) e a MEDICAO continua sendo estilo computado no   */
/* navegador. Classe nova entra na sonda sozinha; ninguem precisa      */
/* lembrar de atualizar uma lista aqui.                                */
/* ------------------------------------------------------------------ */

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...tsxFiles(full))
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

const listClasses = new Set<string>()
for (const file of [...tsxFiles(path.join(root, 'app')), ...tsxFiles(path.join(root, 'src'))]) {
  const source = readFileSync(file, 'utf8')
  for (const m of source.matchAll(/<(?:ul|ol)\b[^>]*className="([^"{]+)"/g)) {
    listClasses.add(m[1]!.trim())
  }
}

const probes = [...listClasses]
  .sort()
  .map((cls) => `<ul class="${cls}" data-list-probe="${cls}"><li>item</li></ul>`)
  .join('')

mkdirSync(outDir, { recursive: true })
writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA — vazamento de estilo padrao</title>
<style>${css}</style>
</head><body>${markup}<section id="list-probes">${probes}</section></body></html>`,
)
console.log(`harness em ${outDir} (${String(listClasses.size)} classes de lista sondadas)`)
