/**
 * opapreco-class-names.test.ts — o slot da home, das listagens e das fichas nao
 * pode voltar a se chamar `home-ad` nem `title-ad`.
 *
 * Em 2026-11-03 a home do dono ficou sem anuncio com tudo funcionando: o slot
 * estava `pronto`, com 4 ofertas desenhadas, e `display: none`. Uma extensao do
 * navegador esconde esses dois nomes de classe. Ate um `<div class="home-ad">`
 * vazio ficava invisivel la, e os candidatos `home-offers` e `title-offers`
 * ficavam visiveis. A classe so serve para a margem em volta do slot: o nome nao
 * tem por que dizer "ad".
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const NOME_FILTRADO = /\b(?:home|title)-ad\b/

const PAGINAS = [
  'apps/web/app/_components/home-like.tsx',
  'apps/web/app/pt/filmes/[slug]/page.tsx',
  'apps/web/app/pt/series/[slug]/page.tsx',
]
const FOLHAS = ['apps/web/app/_components/home-like.css', 'apps/web/app/_components/detail.css']

function semComentario(relativo: string): string {
  return readSourceWithoutComments(path.join(REPO_ROOT, relativo))
}

describe('classes dos slots OpaPreço', () => {
  it.each(PAGINAS)('%s nao usa o nome filtrado', (relativo) => {
    const fonte = semComentario(relativo)
    expect(fonte).toContain('<OpaPrecoAd')
    expect(fonte).not.toMatch(NOME_FILTRADO)
  })

  it.each(FOLHAS)('%s nao usa o nome filtrado', (relativo) => {
    // Sem comentario: o comentario da folha explica o nome antigo, e isso pode.
    expect(semComentario(relativo)).not.toMatch(NOME_FILTRADO)
  })

  it('a home e as fichas usam os nomes novos', () => {
    expect(semComentario(FOLHAS[0]!)).toContain('.home-offers[data-op-estado')
    expect(semComentario(FOLHAS[1]!)).toContain('.title-offers[data-op-estado')
  })
})
