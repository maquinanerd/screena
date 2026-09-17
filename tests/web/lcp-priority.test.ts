/**
 * lcp-priority.test.ts — a imagem que decide o LCP da ficha tem a prioridade.
 *
 * O DEFEITO QUE ISTO TRAVA (medido na auditoria de SEO de 11/09/2026): na faixa
 * de midia das fichas, o destaque (backdrop) e o maior elemento visivel em TODA
 * largura — a celula dele e 3/6 da faixa no desktop e 2/3 no tablet e no celular
 * (`globals.css`, `.media-strip__grid`). Ele carregava com `loading="lazy"`,
 * enquanto o poster ao lado, 1/6 ou 1/3 da faixa, recebia `fetchPriority="high"`
 * — e com ele o preload de alta prioridade que o SSR do React 19 emite.
 *
 * O teste le a fonte porque a suite roda em `node`, sem motor de layout: medir
 * LCP aqui seria teatro. O que se afirma e o atributo que decide a prioridade.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const FICHAS = [
  ['filme', path.join(REPO_ROOT, 'apps', 'web', 'app', 'pt', 'filmes', '[slug]', 'page.tsx')],
  ['serie', path.join(REPO_ROOT, 'apps', 'web', 'app', 'pt', 'series', '[slug]', 'page.tsx')],
] as const

/** O primeiro `<img ... />` depois de um marcador UNICO na fonte. */
function imgDepoisDe(fonte: string, marcador: string): string {
  const inicio = fonte.indexOf(marcador)
  if (inicio === -1) return ''
  const img = fonte.indexOf('<img', inicio)
  if (img === -1) return ''
  const fim = fonte.indexOf('/>', img)
  return fim === -1 ? '' : fonte.slice(img, fim)
}

describe.each(FICHAS)('LCP da faixa de midia — ficha de %s', (_rotulo, arquivo) => {
  const fonte = readSourceWithoutComments(arquivo)
  // `{view.media.backdrop` com a chave na frente: sem ela o marcador casaria com
  // a condicao da faixa inteira (`poster !== null || backdrop !== null ? (`), e o
  // primeiro <img> depois dela e o do POSTER — o teste mediria a imagem errada.
  const poster = imgDepoisDe(fonte, '{view.media.poster !== null ? (')
  const destaque = imgDepoisDe(fonte, '{view.media.backdrop !== null ? (')

  it('(1) CONTROLE: cada extracao achou a SUA imagem', () => {
    expect(poster).toContain('view.media.poster.src')
    expect(destaque).toContain('view.media.backdrop.src')
  })

  it('(2) o destaque — o LCP em toda largura — tem prioridade alta e NAO e lazy', () => {
    expect(destaque).toContain('fetchPriority="high"')
    expect(destaque).not.toContain('loading="lazy"')
  })

  it('(3) o poster so disputa prioridade quando e a maior imagem (sem destaque), e nunca e lazy', () => {
    expect(poster).toContain("fetchPriority={view.media.backdrop === null ? 'high' : 'low'}")
    expect(poster).not.toContain('loading="lazy"')
  })
})
