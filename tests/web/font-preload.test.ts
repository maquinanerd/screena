/**
 * font-preload.test.ts — o preload aponta para a MESMA fonte que a `@font-face`.
 *
 * O DEFEITO QUE ISTO TRAVA (medido na auditoria de SEO de 11/09/2026): sem
 * preload, a fonte so era descoberta depois de a folha global ser baixada e
 * analisada, e trocava o fallback com o texto ja na tela — CLS 0,088 na noticia.
 *
 * O QUE UM PRELOAD ERRADO CUSTA, E POR QUE ISTO NAO E TEATRO: um preload para um
 * caminho que a `@font-face` nao usa, ou sem `crossOrigin`, nao corrige nada e
 * ainda BAIXA a fonte duas vezes. O navegador nao avisa. A unica forma de pegar
 * isso sem medir rede e confrontar os dois arquivos que precisam concordar.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const layout = readSourceWithoutComments(path.join(REPO_ROOT, 'apps', 'web', 'app', 'layout.tsx'))
const css = readSourceWithoutComments(path.join(REPO_ROOT, 'apps', 'web', 'app', 'globals.css'))

/** O `src` da primeira `@font-face` da folha global. */
function fontFaceSrc(): string | null {
  const bloco = /@font-face\s*\{([^}]*)\}/.exec(css)?.[1]
  if (bloco === undefined) return null
  return /src:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(bloco)?.[1] ?? null
}

describe('preload da fonte principal', () => {
  it('(1) CONTROLE: a folha global declara uma @font-face woff2 (senao nada abaixo prova nada)', () => {
    const src = fontFaceSrc()
    expect(src).not.toBeNull()
    expect(src).toMatch(/\.woff2$/)
  })

  it('(2) o layout faz preload do MESMO arquivo que a @font-face carrega', () => {
    const src = fontFaceSrc()
    expect(layout).toContain(`const FONT_PATH = "${String(src)}"`)
  })

  it('(3) com as, type e crossOrigin: sem crossOrigin o preload nao casa e a fonte baixa duas vezes', () => {
    expect(layout).toMatch(
      /preload\(FONT_PATH, \{ as: "font", type: "font\/woff2", crossOrigin: "anonymous" \}\)/,
    )
  })

  it('(4) uma fonte so: o layout nao faz preload de outra fonte que a folha nao usa', () => {
    const preloads = layout.match(/preload\(/g) ?? []
    expect(preloads).toHaveLength(1)
  })
})
