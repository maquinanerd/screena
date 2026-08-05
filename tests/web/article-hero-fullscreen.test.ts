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

  it('o hero e o header dividem a MESMA grade horizontal', () => {
    /*
     * A regressao que este teste tranca foi a causa raiz da composicao anterior:
     * o hero usava `max-width: 880px` centrado com recuo de 40px, enquanto o
     * header usa `--container-nav` com `--pad-page`. Numa tela de 1920 isso
     * punha a manchete em 552px e a wordmark em 350px — 200px fora de eixo.
     * Nao e ajuste de espacamento: sao duas grades. A unica defesa estavel e
     * exigir que os DOIS blocos citem os MESMOS tokens.
     */
    const heroInner = ruleBody('\n.art-hero__inner {')
    const headerInner = ruleBody('.site-header__inner {')
    for (const token of ['var(--container-nav)', 'var(--pad-page)']) {
      expect(heroInner, `hero fora da grade do header: ${token}`).toContain(token)
      expect(headerInner, `header fora da propria grade: ${token}`).toContain(token)
    }
    // Nada de largura literal: um numero solto aqui e o retorno do defeito.
    expect(heroInner).not.toMatch(/max-width: \d+px/)
    // E a troca para o recuo estreito acontece no MESMO ponto de quebra em que
    // o header troca — senao o desalinhamento volta so nessa faixa.
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'))
    expect(tablet).toMatch(/\.art-hero__inner \{\s*padding-inline: var\(--pad-page-mobile\)/)
  })

  it('a altura da capa e limitada em cima e embaixo, no desktop e no celular', () => {
    // Teto: hero sem teto em monitor alto vira parede. Piso: hero curto demais
    // espreme o proprio titulo. `min-height` mantem o crescimento por conteudo.
    // `svh` (viewport PEQUENO) evita que o hero pule quando a barra de URL do
    // celular recolhe; a linha `vh` antes dele e a base para quem nao tem `svh`.
    const desktop = ruleBody("\n.art-hero[data-hero-media='true'] {")
    expect(desktop).toMatch(/min-height: clamp\(560px, 88vh, 1000px\)/)
    expect(desktop).toMatch(/min-height: clamp\(560px, 88svh, 1000px\)/)
    const mobile = css.slice(css.indexOf('@media (max-width: 599px)'))
    expect(mobile).toMatch(/min-height: clamp\(420px, 78vh, 640px\)/)
    expect(mobile).toMatch(/min-height: clamp\(420px, 78svh, 640px\)/)
    expect(css).not.toMatch(/\.art-hero[^{]*\{[^}]*height: 100vh/s)
  })

  it('o scrim protege o texto SEM apagar a foto', () => {
    const scrim = ruleBody('.art-hero__scrim {')
    /*
     * Tres bandas com destino declarado — topo (barra fixa + breadcrumb, em PX),
     * rodape (bloco editorial, em %) e ESQUERDA (o lado onde o texto vive) —
     * mais uma base plana fraca.
     *
     * A banda lateral e o que permite as outras serem fracas: ela protege a
     * manchete sem escurecer a metade direita da foto. A versao anterior somava
     * duas bandas fortes e a opacidade combinada nunca caia abaixo de ~0.66 em
     * ponto nenhum do hero, inclusive onde nao havia texto para proteger — a
     * foto virava parede preta.
     */
    expect(scrim.match(/linear-gradient/g)).toHaveLength(3)
    expect(scrim, 'banda do topo em PX').toContain('110px')
    expect(scrim, 'banda lateral (90deg)').toMatch(/linear-gradient\(\s*90deg/)
    expect(scrim, 'base plana fraca').toMatch(/rgba\(0, 0, 0, 0\.2\);/)
    // Nenhuma banda pode voltar a cobrir o hero inteiro com quase-opaco: o topo
    // do gradiente de rodape (`0%` = base) e o unico ponto acima de 0.8.
    expect(scrim, 'gradiente chapado de novo').not.toMatch(/rgba\(0, 0, 0, 0\.9\)/)
    // Vinheta e proibida: escurece o quadro sem proteger linha nenhuma.
    expect(scrim).not.toContain('radial-gradient')
    // O breadcrumb fica na parte ALTA, onde o scrim e mais fraco: 0.6 media
    // 2,1:1 sobre capa clara.
    expect(ruleBody(".art-hero[data-hero-media='true'] .art-crumb {")).toContain(
      'rgba(255, 255, 255, 0.82)',
    )
  })

  it('a manchete tem escala editorial e o resumo fica ABAIXO dela na hierarquia', () => {
    const title = ruleBody(".art-hero[data-hero-media='true'] .art-title {")
    /*
     * Escala fluida com teto — e amarrada a LARGURA **e** a ALTURA.
     *
     * `min(vw, svh)` nao e refinamento: com o termo em `vw` sozinho, tela larga
     * e baixa (1760x900, 1366x768) produzia manchete de 76px que, com titulo
     * longo, empilhava quatro linhas e empurrava o bloco editorial ate 78% do
     * hero — para FORA da faixa protegida do scrim, derrubando o contraste da
     * data e do breadcrumb abaixo de AA. Os dois defeitos eram o mesmo defeito.
     * Voltar a escalar so por `vw` traz os dois de volta.
     */
    expect(title).toMatch(/font-size: clamp\(34px, min\(4\.6vw, 7\.2vh\), 76px\)/)
    expect(title).toMatch(/font-size: clamp\(34px, min\(4\.6vw, 7\.2svh\), 76px\)/)
    // O resumo cede altura pela mesma razao — senao devolve por baixo o que a
    // manchete economizou por cima.
    expect(ruleBody(".art-hero[data-hero-media='true'] .art-deck {")).toMatch(
      /font-size: clamp\(16px, min\(1\.35vw, 2\.4svh\), 21px\)/,
    )
    // Largura de quebra: sem teto a manchete correria o container inteiro e
    // viraria uma faixa fina de texto.
    expect(title).toMatch(/max-width: min\(920px, 100%\)/)
    // Quebra decidida pelo espaco, nunca por `<br>` no markup.
    expect(title).toContain('text-wrap: balance')
    expect(article).not.toMatch(/<br\s*\/?>/)

    const deck = ruleBody(".art-hero[data-hero-media='true'] .art-deck {")
    // ESTREITO que a manchete (660 < 920): resumo mais largo que o titulo
    // inverteria a leitura.
    expect(deck).toMatch(/max-width: min\(660px, 100%\)/)

    // A escala grande e SO do estado com capa: sem capa o titulo vive na coluna
    // de leitura de 720px, onde 76px seria absurdo.
    expect(ruleBody('\n.art-title {')).toMatch(/font-size: clamp\(30px, 5vw, 52px\)/)
  })

  it('o celular redeclara a especificidade certa da manchete', () => {
    /*
     * `.art-title` solto dentro de `@media` tem (0,1,0) e NAO vence a regra de
     * desktop `.art-hero[data-hero-media='true'] .art-title` (0,2,0) — estar
     * dentro de media query nao acrescenta peso. Escrito errado, o celular
     * herdaria a manchete de 76px. O teste existe porque a falha e silenciosa:
     * o CSS continua valido e nada avisa.
     */
    const mobile = css.slice(css.indexOf('@media (max-width: 599px)'))
    expect(mobile).toMatch(
      /\.art-hero\[data-hero-media='true'\] \.art-title \{[^}]*font-size: clamp\(28px, 8vw, 42px\)/s,
    )
    expect(mobile).toMatch(/\.art-hero\[data-hero-media='true'\] \.art-deck \{/)
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

describe('composicao editorial da materia', () => {
  it('o recorte da capa sai da proporcao e deixa o encaixe pronto para focal point', () => {
    // O atributo e emitido pelo SERVIDOR a partir da dimensao projetada.
    expect(article).toContain(
      'data-crop={heroCropOf(view.heroImage.width, view.heroImage.height)}',
    )
    // O CSS le por variavel, e nao com `object-position` fixo por seletor: e
    // essa variavel que o focal point real vai alimentar quando for projetado.
    expect(ruleBody('.art-hero__img img {')).toContain(
      'object-position: var(--art-hero-focus, 50% 45%)',
    )
    // Quanto mais alto o arquivo, mais alta a ancora — no `cover` de um hero
    // largo e baixo o corte come topo e base, e e la que ficam os rostos.
    expect(ruleBody(".art-hero__img[data-crop='portrait'] {")).toContain('50% 26%')
    expect(ruleBody(".art-hero__img[data-crop='standard'] {")).toContain('50% 35%')
  })

  it('o avatar mostra iniciais reais, nunca um circulo vazio', () => {
    // O contrato publico nao projeta retrato: o degrade cinza que existia aqui
    // lia como imagem quebrada. Sem iniciais, nao ha circulo.
    expect(article).toContain('{initials !== null ? (')
    expect(ruleBody('.art-byline__avatar {')).not.toContain('linear-gradient')
    expect(ruleBody('.art-byline__avatar {')).toContain('align-items: center')
  })

  it('a trilha nao repete "Noticias" em ingles no ultimo degrau', () => {
    // `articles.category` e texto livre da fonte, e feed RSS carimba a
    // categoria tecnica do proprio feed — dai o `Inicio > Noticias > news`.
    expect(article).toContain('sectionCrumbLabel(view.articleSection ?? view.category)')
    expect(article).toContain('{sectionLabel !== null ? (')
    expect(article).not.toContain('<span aria-current="page">{view.category}</span>')
  })

  it('a semantica e o SEO da materia continuam inteiros', () => {
    // Um H1 so, dentro de `<article>`, com trilha em `<nav>` rotulado.
    expect(article.match(/className="art-title"/g)).toHaveLength(1)
    expect(article).toContain('<h1 className="art-title">')
    expect(article).toContain('<article className="art-body">')
    expect(article).toMatch(/<nav aria-label="[^"]+" className="art-crumb">/)
    // Data legivel por MAQUINA ao lado do rotulo em pt-BR. O JSON-LD ja declara
    // `datePublished`, mas ele descreve a pagina inteira — nao liga aquela data
    // a ESTA linha. Sem `dateIso`, so o rotulo: `datetime` vazio e pior que
    // nenhum.
    expect(article).toContain('<time dateTime={view.dateIso}>')
    expect(article).toContain('view.dateIso !== null ?')
    // Um JSON-LD de artigo e um de trilha — nunca duplicados.
    expect(article.match(/type="application\/ld\+json"/g)).toHaveLength(2)
    expect(article).toContain('buildArticleJsonLd(')
    expect(article).toContain("'@type': 'BreadcrumbList'")
    // A decisao de robots/canonical continua DERIVADA do gate, nao do CMS.
    expect(article).toContain('gatePublicRobots(articleRobots(indexability.decision))')
    expect(article).toContain('resolveCanonical(facts)')
  })

  it('a coluna de leitura nao e justificada e tem respiro apos a capa', () => {
    const body = ruleBody('\n.art-body {')
    // Justificado abre rios de espaco numa coluna de 720px com palavra longa de
    // pt-BR, e cada linha ganha um espacamento diferente.
    expect(body).not.toContain('text-align: justify')
    expect(body).toContain('max-width: var(--container-reading)')
    // Sem respiro, o primeiro paragrafo encosta na borda do hero e a passagem
    // le como corte de template.
    expect(body).toMatch(/padding: 64px/)

    /*
     * A escala de leitura nova e ESCOPADA em `[data-vertical='news']`.
     *
     * `.art-body` NAO e exclusivo da materia: a biografia da pagina de pessoa
     * (`/pt/pessoas/{slug}`, `<main data-vertical="person">`) reusa a mesma
     * classe. Aplicar 18px/1.75 na regra base mudava o corpo da pessoa de
     * carona — fora do escopo desta tarefa. A auditoria pegou isso; o teste
     * existe para que a proxima mexida nao desfaca o escopo sem perceber.
     */
    const paragraph = ruleBody("[data-vertical='news'] .art-body > p {")
    expect(paragraph).toMatch(/font-size: 18px/)
    expect(paragraph).toMatch(/line-height: 1\.75/)
    // Token, nunca hex solto (convencao de cor do projeto).
    expect(paragraph).toContain('color: var(--c-text-body)')

    // E a regra BASE continua com os valores de antes, intocada.
    const base = ruleBody('\n.art-body > p {')
    expect(base).toMatch(/font-size: 17px/)
    expect(base).toMatch(/line-height: 1\.8/)
  })
})

describe('credito de imagem', () => {
  it('credito da capa fica no canto do hero e some quando nao existe', () => {
    expect(article).toContain('view.heroImage?.credit != null ?')
    const credit = ruleBody('.art-hero__credit {')
    expect(credit).toContain('position: absolute')
    // Mesmo recuo do container do texto: a borda direita do credito bate com a
    // borda direita da manchete. Um valor literal aqui voltaria a flutuar
    // quando a grade mudasse.
    expect(credit).toContain('right: var(--pad-page)')
    expect(credit).toContain('text-align: right')
    // No celular sai do absoluto e entra no fluxo: absoluto num hero estreito
    // encavalaria a assinatura assim que o credito passasse de uma linha.
    const mobile = css.slice(css.indexOf('@media (max-width: 599px)'))
    expect(mobile).toMatch(/\.art-hero__credit \{[^}]*position: static/s)
    // E o separador da assinatura some onde a linha quebra: "por Fulano  ·" com
    // o tempo de leitura na linha de baixo deixava a marca pendurada — o mesmo
    // residuo que a legenda de imagem ja evita.
    expect(mobile).toMatch(/\.art-byline__sep \{\s*display: none/)
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
