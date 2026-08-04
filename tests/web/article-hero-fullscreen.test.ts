import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Hero de capa da materia (tela 05) — full-bleed sob header transparente.
 *
 * Nao ha ambiente DOM neste repositorio, entao as assercoes sao sobre o FONTE.
 * O que estes testes trancam sao as tres regressoes que o desenho permite:
 *
 *  1. materia SEM capa herdar o tema escuro do hero (texto branco no claro);
 *  2. o estado transparente do header passar a depender de JS — o que faz a
 *     materia sem capa nascer errada no HTML do servidor e so corrigir depois
 *     da hidratacao;
 *  3. o header das OUTRAS rotas ser reescrito junto (a home deixou de ser
 *     transparente porque alguem juntou os seletores).
 *
 * O comportamento vivo (altura real, contraste medido, virada no scroll) e
 * verificado no navegador; aqui fica a fiacao que nao pode se desfazer sem
 * alguem perceber.
 */

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

const css = read('apps/web/app/globals.css')
const header = read('apps/web/app/_components/site-header.tsx')
const article = read('apps/web/app/pt/noticias/[slug]/page.tsx')
const body = read('apps/web/app/_components/article-body.tsx')

/** Corpo da primeira regra CSS cujo seletor casa com `selector`. */
function ruleBody(selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `regra ausente: ${selector}`).toBeGreaterThan(-1)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open, close)
}

describe('hero de capa da materia', () => {
  it('o estado do hero nasce no HTML do SERVIDOR, nunca de JS', () => {
    // `data-hero-media` e o unico sinal, e ele e emitido pela PAGINA. Se essa
    // decisao migrar para um `useEffect`, materia sem capa pisca branco no
    // claro entre o primeiro paint e a hidratacao.
    expect(article).toContain("data-hero-media={view.heroImage !== null ? 'true' : undefined}")
    // O componente do header NAO decide: ele so consulta o atributo que ja
    // esta no documento para saber quando o hero PASSOU.
    expect(header).toContain('.art-hero[data-hero-media="true"]')
    expect(header).not.toMatch(/setPastHero\(true\)\s*;?\s*\/\/\s*inicial/)
  })

  it('a materia SEM capa nao herda nada do tema escuro', () => {
    // Todo estilo escuro do hero e escopado em `[data-hero-media='true']`.
    // Sem escopo, a materia sem capa recebia fundo `--c-bg-hero` e texto #fff.
    for (const rule of [
      '.art-hero[data-hero-media=\'true\'] .art-title',
      '.art-hero[data-hero-media=\'true\'] .art-deck',
      '.art-hero[data-hero-media=\'true\'] .art-crumb',
      '.art-hero[data-hero-media=\'true\'] .art-byline',
      '.art-hero[data-hero-media=\'true\'] .art-hero__date',
    ]) {
      expect(css, `estilo escuro sem escopo: ${rule}`).toContain(rule)
    }
    // A base e CLARA: os mesmos elementos, sem o atributo, usam token de texto.
    expect(ruleBody('\n.art-title {')).toContain('color: var(--c-text-primary)')
    expect(ruleBody('\n.art-deck {')).toContain('color: var(--c-text-secondary)')
    expect(ruleBody('\n.art-byline {')).toContain('color: var(--c-text-secondary)')
    expect(ruleBody('\n.art-hero__date {')).toContain('color: var(--c-text-secondary)')
    // Fundo escuro so com capa.
    expect(ruleBody("\n.art-hero[data-hero-media='true'] {")).toContain(
      'background: var(--c-bg-hero)',
    )
    expect(ruleBody('\n.art-hero {')).not.toContain('background')
    // E o scrim so existe quando ha imagem por baixo: sobre a base clara ele
    // seria um gradiente preto no meio do nada.
    const scrimAt = article.indexOf('art-hero__scrim')
    const guardAt = article.indexOf('view.heroImage !== null ?')
    expect(guardAt).toBeGreaterThan(-1)
    expect(scrimAt).toBeGreaterThan(guardAt)
    // Sem capa, o cabecalho da materia volta para a coluna de leitura.
    expect(ruleBody(".art-hero:not([data-hero-media='true']) .art-hero__inner {")).toContain(
      'max-width: var(--container-reading)',
    )
  })

  it('o header transparente da materia NAO reescreve o das outras rotas', () => {
    // Blocos separados: seletor invalido invalida a LISTA inteira, entao
    // juntar `:has()` as regras da home derrubaria a home em browser antigo.
    expect(css).toMatch(
      /body:has\(\.art-hero\[data-hero-media='true'\]\) \.site-header:not\(\[data-past-hero='true'\]\) \{/,
    )
    expect(css).not.toMatch(/\.site-header\[data-overlay='true'\][^{]*:has\(/)
    // A regra da home continua intacta e sem gradiente proprio.
    expect(css).toMatch(/\.site-header\[data-overlay='true'\] \{[^}]*background: transparent/s)
    expect(css).not.toMatch(/\.site-header\[data-overlay='true'\] \{[^}]*linear-gradient/s)
    // E a rota da materia continua FORA de `HERO_ROUTES` — quem decide la e o
    // CSS, e incluir a materia aqui reintroduziria o pisca-pisca.
    expect(header).toContain("const HERO_ROUTES = ['/pt', '/pt/filmes', '/pt/series']")
    expect(header).toContain("document.querySelector('#main-content .hero')")
  })

  it('o header vira solido quando o TEXTO do hero encosta na barra', () => {
    /*
     * Nao e "quando o hero inteiro passar". Com a barra transparente ate o fim
     * do hero, a manchete de 52px sobe POR CIMA do menu: os dois lados
     * legiveis, ilegiveis juntos — defeito que medicao de contraste nao pega.
     * O limite honesto do estado transparente e o ponto em que ele deixaria de
     * flutuar sobre imagem, e esse ponto e MEDIDO no layout.
     */
    expect(header).toContain('.art-crumb')
    expect(header).toMatch(/getBoundingClientRect\(\)\.top \+ window\.scrollY - NAV_HEIGHT_PX/)
    expect(header).toContain('window.scrollY >= flipAt')
    // Medido uma vez e no `resize` — nunca dentro do handler de scroll, que
    // forcaria reflow a cada quadro.
    expect(header).toMatch(/addEventListener\('resize', onResize/)
    expect(header).not.toMatch(/onScroll = \(\) => \{[^}]*getBoundingClientRect/s)
  })

  it('a wordmark tem as duas versoes no HTML e quem escolhe e o CSS', () => {
    // Trocar `src` em JS custaria um quadro com a wordmark preta sobre a capa
    // escura, porque o overlay da materia nasce do HTML e nao espera hidratacao.
    expect(header).toContain('site-header__logo--solid')
    expect(header).toContain('site-header__logo--inverse')
    expect(ruleBody('.site-header__logo--inverse {')).toContain('display: none')
    expect(css).toMatch(
      /body:has\(\.art-hero\[data-hero-media='true'\]\)[\s\S]{0,200}?\.site-header__logo--inverse \{\s*display: block/,
    )
  })

  it('a capa full-bleed suprime o spacer da barra fixa', () => {
    // Sem isso a imagem nasce 72px abaixo do topo e o header transparente
    // flutua sobre uma faixa clara.
    expect(css).toMatch(
      /body:has\(\.art-hero\[data-hero-media='true'\]\) \.site-header__spacer \{\s*display: none/,
    )
  })

  it('a altura da capa e limitada em cima e embaixo, no desktop e no celular', () => {
    // Teto: `100vh` (ou um hero sem teto em monitor alto) empurra todo o texto
    // para fora da primeira dobra. Piso: hero curto demais espreme o proprio
    // titulo. `min-height` mantem o crescimento por conteudo.
    expect(ruleBody("\n.art-hero[data-hero-media='true'] {")).toMatch(
      /min-height: clamp\(520px, 68vh, 720px\)/,
    )
    const mobile = css.slice(css.indexOf('@media (max-width: 599px)'))
    expect(mobile).toMatch(/min-height: clamp\(400px, 62vh, 520px\)/)
    expect(css).not.toMatch(/\.art-hero[^{]*\{[^}]*height: 100vh/s)
  })

  it('o scrim cobre a faixa do header E o canto do credito', () => {
    const scrim = ruleBody('.art-hero__scrim {')
    // Duas camadas: banda superior em PX (independe da altura do hero, cobre a
    // barra de 72px e o breadcrumb) + banda inferior em % (texto e credito).
    expect(scrim.match(/linear-gradient/g)).toHaveLength(2)
    expect(scrim).toContain('190px')
    expect(scrim).toMatch(/rgba\(0, 0, 0, 0\.9\) 0%/)
    // O breadcrumb fica na parte ALTA, onde o scrim e mais fraco: 0.6 media
    // 2,1:1 sobre capa clara.
    expect(ruleBody(".art-hero[data-hero-media='true'] .art-crumb {")).toContain(
      'rgba(255, 255, 255, 0.82)',
    )
  })

  it('a ordem do hero e breadcrumb -> data -> titulo -> resumo -> assinatura', () => {
    const order = [
      'className="art-crumb"',
      'className="art-hero__date"',
      'className="art-title"',
      'className="art-deck"',
      'className="art-byline"',
      'className="art-hero__credit"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = article.indexOf(marker)
      expect(at, `fora de ordem no hero: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
    // A secao editorial vive so na trilha; o chip repetia a mesma palavra dois
    // centimetros abaixo, sem sinal novo.
    expect(article).not.toContain('art-chip')
    expect(css).not.toContain('.art-chip')
  })
})

describe('credito de imagem', () => {
  it('credito da capa fica no canto do hero e some quando nao existe', () => {
    expect(article).toContain('view.heroImage?.credit != null ?')
    const credit = ruleBody('.art-hero__credit {')
    expect(credit).toContain('position: absolute')
    expect(credit).toContain('right: 40px')
    expect(credit).toContain('text-align: right')
    // No celular sai do absoluto e entra no fluxo: absoluto num hero estreito
    // encavalaria a assinatura assim que o credito passasse de uma linha.
    const mobile = css.slice(css.indexOf('@media (max-width: 599px)'))
    expect(mobile).toMatch(/\.art-hero__credit \{[^}]*position: static/s)
  })

  it('legenda e credito de imagem de corpo tratam os QUATRO casos', () => {
    // 1+2. nenhum dos dois -> `figcaption` nao existe (nada de caixa vazia).
    expect(body).toContain(
      'block.image.caption !== null || block.image.credit !== null ?',
    )
    // 3. so legenda -> sem rotulo "Credito:" orfao; so credito -> sem separador
    //    pendurado. O separador so aparece quando ha os DOIS.
    expect(body).toContain(
      "block.image.caption !== null && block.image.credit !== null ? ' ' : null",
    )
    // 4. os dois -> legenda primeiro, credito depois, no mesmo bloco.
    const captionAt = body.indexOf('{block.image.caption}')
    const creditAt = body.indexOf('art-figure__credit')
    expect(captionAt).toBeGreaterThan(-1)
    expect(creditAt).toBeGreaterThan(captionAt)
    // Mesmo bloco, nao linha separada.
    expect(ruleBody('.art-figure__credit {')).toContain('display: inline')
  })

  it('a legenda de corpo e legivel: `--c-text-muted` reprova AA', () => {
    // #9a958c sobre #fdfdfd mede 2,9:1. Este bloco carrega a ATRIBUICAO da
    // imagem — apagar abaixo do legivel nao e hierarquia, e omissao.
    const caption = ruleBody('.art-figure figcaption {')
    expect(caption).toContain('color: var(--c-text-muted-aa)')
    expect(caption).not.toMatch(/color: var\(--c-text-muted\)/)
  })
})
