/**
 * cast-strip.test.tsx — a faixa de elenco no DOM.
 *
 * POR QUE ESTE ARQUIVO NASCEU COM A EXTRACAO DO COMPONENTE
 * -------------------------------------------------------
 * As classes desta faixa eram cobertas de raspao pelas guardas de ordem das
 * fichas (`tests/web/{movie,series}-canonical-port.test.ts`), que casavam o
 * TEXTO `className="cast-strip"` na fonte da pagina. Ao mover a faixa para um
 * componente, esse casamento sairia do arquivo — e a cobertura evaporaria em
 * silencio junto, que e a forma mais barata de um refactor "sem regressao"
 * esconder uma.
 *
 * Aqui a prova fica mais forte, nao mais fraca: o componente e RENDERIZADO e as
 * classes sao lidas do markup, em vez de procuradas no codigo-fonte.
 *
 * O TESTE QUE JUSTIFICA A EXTRACAO. O ultimo caso — "o corpo do cartao e o mesmo
 * com e sem link" — e o motivo de o componente existir. Antes, o membro com slug
 * (`<a>`) e o sem slug (`<div>`) carregavam DUAS copias do mesmo retrato, das
 * mesmas iniciais, do mesmo nome e do mesmo personagem, em cada uma das duas
 * fichas. Quatro copias divergem no primeiro conserto que alguem faca em tres
 * delas — e divergem CALADAS, porque as duas metades so aparecem juntas num
 * titulo que misture elenco com e sem pagina propria.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CastStrip } from '../cast-strip'
import type { CastMemberView } from '../../../src/lib/cast-presenter'

function member(overrides: Partial<CastMemberView> = {}): CastMemberView {
  return {
    name: 'Ana Beatriz Costa',
    character: 'Detetive Rocha',
    href: '/pt/pessoas/ana-beatriz-costa/',
    profile: { src: '/media/demo/ana.jpg', width: 200, height: 300 },
    ...overrides,
  }
}

function render(members: CastMemberView[]): string {
  return renderToStaticMarkup(<CastStrip members={members} />)
}

/** Conteudo do cartao, sem o involucro (`<ul>`, `<li>` e a tag do tile). */
function tileBody(markup: string): string {
  return markup
    .replace(/^<ul class="cast-strip"><li>/, '')
    .replace(/<\/li><\/ul>$/, '')
    .replace(/^<a class="cast-tile" href="[^"]*">/, '')
    .replace(/^<div class="cast-tile">/, '')
    .replace(/<\/(?:a|div)>$/, '')
}

describe('CastStrip · faixa de elenco das fichas de titulo', () => {
  it('envolve a faixa em <ul class="cast-strip">, com um <li> por membro', () => {
    const markup = render([member(), member({ name: 'Caio Duarte', href: null })])
    expect(markup.startsWith('<ul class="cast-strip">')).toBe(true)
    expect(markup.match(/<li>/g)).toHaveLength(2)
  })

  it('membro COM slug vira <a class="cast-tile"> apontando para a pagina da pessoa', () => {
    const markup = render([member({ href: '/pt/pessoas/ana-beatriz-costa/' })])
    expect(markup).toContain('<a class="cast-tile" href="/pt/pessoas/ana-beatriz-costa/">')
  })

  it('membro SEM slug vira <div class="cast-tile"> — nunca um link quebrado', () => {
    const markup = render([member({ href: null })])
    expect(markup).toContain('<div class="cast-tile">')
    // Controle negativo: nenhuma ancora sobra quando nao ha destino.
    expect(markup).not.toContain('<a ')
  })

  it('com retrato mostra a <img>; sem retrato, as iniciais — nunca os dois', () => {
    const comFoto = render([
      member({ profile: { src: '/media/demo/ana.jpg', width: 200, height: 300 } }),
    ])
    expect(comFoto).toContain('<img alt="" loading="lazy" src="/media/demo/ana.jpg"/>')
    expect(comFoto).not.toContain('aria-hidden="true"')

    const semFoto = render([member({ profile: null })])
    expect(semFoto).toContain('<span aria-hidden="true">AB</span>')
    expect(semFoto).not.toContain('<img')
  })

  it('o fallback usa no maximo DUAS iniciais, mesmo em nome longo', () => {
    const markup = render([member({ name: 'Maria da Silva Ferreira Lima', profile: null })])
    expect(markup).toContain('<span aria-hidden="true">Md</span>')
  })

  it('personagem ausente nao gera a linha de papel', () => {
    expect(render([member({ character: 'Detetive Rocha' })])).toContain(
      '<p class="cast-tile__role">Detetive Rocha</p>',
    )
    expect(render([member({ character: null })])).not.toContain('cast-tile__role')
  })

  it('o nome sai sempre em <p class="cast-tile__name">, com ou sem link', () => {
    expect(render([member()])).toContain('<p class="cast-tile__name">Ana Beatriz Costa</p>')
    expect(render([member({ href: null })])).toContain(
      '<p class="cast-tile__name">Ana Beatriz Costa</p>',
    )
  })

  it('o corpo do cartao e IDENTICO com e sem link — so o involucro muda', () => {
    const comLink = render([member({ href: '/pt/pessoas/ana-beatriz-costa/' })])
    const semLink = render([member({ href: null })])

    const corpo = tileBody(comLink)
    // Guarda do proprio helper: se ele deixar de descascar o involucro, a
    // comparacao abaixo ficaria verde por vacuidade.
    expect(corpo).not.toContain('cast-tile"')
    expect(corpo).toContain('cast-tile__photo')

    expect(corpo).toBe(tileBody(semLink))
  })
})
