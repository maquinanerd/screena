/**
 * movie-media-above-fold.test.ts — em celular, a imagem vem antes do texto.
 *
 * ============================================================================
 * O QUE FOI MEDIDO
 * ============================================================================
 * Auditoria de 2026-09-01, `/pt/filmes/a-odisseia/` em 375x812: a PRIMEIRA
 * imagem da pagina comeca em **y = 840 px**. Zero pixel de imagem na primeira
 * tela de uma pagina de filme. Nenhum dos 24 concorrentes analisados faz isso.
 *
 * E a resposta ja existia no repositorio: a ficha de SERIE recebeu a
 * reordenacao mobile (`order: -2` na banda de midia) quando a tela 08 foi
 * portada. A de FILME ficou sem. A auditoria mediu um filme e concluiu que o
 * produto inteiro nao mostrava imagem na dobra — a serie ja mostrava.
 *
 * ============================================================================
 * O QUE ESTE TESTE PROVA, E POR QUE ELE NAO E UM GREP
 * ============================================================================
 * Ele nao pergunta "a regra esta escrita?". Ele extrai os blocos
 * `@media (max-width: 767px)` por casamento de chaves e compara os VALORES de
 * `order` dos dois seletores. O que fica travado e a RELACAO — a midia vem
 * antes do heroi —, nao a grafia de uma linha.
 *
 * A diferenca importa: um guard que casasse com o texto `order: -2` ficaria
 * verde se alguem trocasse o heroi para `-3`, invertendo a ordem sem tocar na
 * linha que o guard le.
 *
 * ============================================================================
 * A LEITURA E PELA PORTA UNICA, E AQUI ISSO NAO E BUROCRACIA
 * ============================================================================
 * O bloco de CSS que este teste protege carrega um comentario que EXPLICA a
 * regra e cita os seletores. Lido cru, o comentario satisfaria o guard sozinho
 * — o quinto caso do defeito que `tests/support/source-text.ts` existe para
 * tornar impossivel. `readSourceWithoutComments` devolve o CSS sem comentario,
 * entao o que casa e a declaracao de verdade.
 */

import { describe, expect, it } from 'vitest'

import path from 'node:path'

import { readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

const css = readSourceWithoutComments(path.join(REPO_ROOT, 'apps', 'web', 'app', 'globals.css'))

/** Larguras a partir das quais o empilhamento de celular vale. */
const MOBILE_PRELUDE = /max-width:\s*767px/

/**
 * Concatena o corpo de toda `@media` cujo prelúdio casa `matcher`.
 *
 * Casamento de CHAVES, e nao regex sobre o bloco inteiro: uma `@media` contem
 * dezenas de regras aninhadas, e um `[\s\S]*?\}` pararia na primeira chave
 * fechada — devolvendo um pedaco do bloco e deixando o resto invisivel para as
 * assercoes.
 */
function mediaBodies(source: string, matcher: RegExp): string {
  const out: string[] = []
  const at = /@media([^{]*)\{/g
  let match: RegExpExecArray | null

  while ((match = at.exec(source)) !== null) {
    const prelude = match[1] ?? ''
    let depth = 1
    let i = at.lastIndex
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
      i += 1
    }
    if (matcher.test(prelude)) out.push(source.slice(at.lastIndex, i - 1))
    // Continua DEPOIS do bloco: `@media` aninhada nao e contada duas vezes.
    at.lastIndex = i
  }

  return out.join('\n')
}

/** Escapa um seletor para uso literal dentro de `RegExp`. */
function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * O valor de `order` declarado para `selector`, ou `null` se ele nao declara.
 *
 * `[^{}]*` no corpo: a regra e uma folha (sem aninhamento), entao parar na
 * primeira chave fechada e correto aqui e evita casar com a regra seguinte.
 */
function orderFor(source: string, selector: string): number | null {
  const rule = new RegExp(`${escapeSelector(selector)}\\s*\\{([^{}]*)\\}`)
  const body = rule.exec(source)?.[1]
  if (body === undefined) return null
  const value = /(?:^|[;\s])order:\s*(-?\d+)/.exec(body)?.[1]
  return value === undefined ? null : Number.parseInt(value, 10)
}

const MEDIA = '> .media-strip'
const HERO = '> .detail-hero'
const MOVIE = "main[data-vertical='movie']"
const SERIES = "main[data-vertical='series']"

describe('em celular, a ficha abre com imagem', () => {
  const mobile = mediaBodies(css, MOBILE_PRELUDE)

  it('o extrator de blocos realmente achou CSS de celular', () => {
    // CONTROLE DO PROPRIO INSTRUMENTO. Se `mediaBodies` devolvesse vazio — por
    // uma mudanca de sintaxe, por exemplo — todas as assercoes abaixo virariam
    // "null === null" e o arquivo passaria sem medir nada.
    expect(mobile.length).toBeGreaterThan(500)
    expect(mobile).toContain('.media-strip')
  })

  it.each([
    ['filme', MOVIE],
    ['serie', SERIES],
  ])('%s: a banda de midia vem ANTES do heroi', (_rotulo, vertical) => {
    const media = orderFor(mobile, `${vertical} ${MEDIA}`)
    const hero = orderFor(mobile, `${vertical} ${HERO}`)

    expect(media, `${vertical} ${MEDIA} nao declara order em celular`).not.toBeNull()
    expect(hero, `${vertical} ${HERO} nao declara order em celular`).not.toBeNull()

    // A RELACAO, e nao o numero: trocar -2/-1 por -9/-8 continua correto;
    // inverter os dois reprova, que e o ponto.
    expect(media!).toBeLessThan(hero!)
  })

  it('o filme liga o flex sob a MESMA guarda que a serie', () => {
    // Sem `display: flex` no container, `order` nao faz nada e o teste acima
    // passaria com a pagina inalterada na tela.
    for (const vertical of [MOVIE, SERIES]) {
      const container = orderFor(mobile, `${vertical}:has(${HERO})`)
      expect(container).toBeNull() // o container nao declara `order`, e sim flex
      const rule = new RegExp(
        `${escapeSelector(`${vertical}:has(${HERO})`)}\\s*\\{[^{}]*display:\\s*flex`,
      )
      expect(rule.test(mobile), `${vertical} nao liga display:flex em celular`).toBe(true)
    }
  })

  it('CONTROLE NEGATIVO: no desktop a composicao canonica NAO e reordenada', () => {
    // O desktop e o canonico: heroi de texto e, abaixo, a banda full-bleed com
    // poster sangrando a esquerda. Se a regra vazasse para fora da media query,
    // este teste continuaria verde no de cima e o desktop estaria quebrado.
    const foraDeCelular = css.split(/@media[^{]*\{/).shift() ?? ''
    expect(orderFor(foraDeCelular, `${MOVIE} ${MEDIA}`)).toBeNull()
    expect(orderFor(foraDeCelular, `${SERIES} ${MEDIA}`)).toBeNull()
  })

  it('CONTROLE NEGATIVO: o DOM continua com o heroi primeiro', async () => {
    // A correcao e de ORDEM VISUAL. Se alguem "resolvesse" movendo a banda no
    // JSX, o rastreador passaria a ler midia antes de titulo e breadcrumb — e
    // este teste avisa que a mudanca saiu do escopo combinado.
    const page = readSourceWithoutComments(
      path.join(REPO_ROOT, 'apps', 'web', 'app', 'pt', 'filmes', '[slug]', 'page.tsx'),
    )
    expect(page.indexOf('detail-hero')).toBeLessThan(page.indexOf('media-strip'))
  })
})
