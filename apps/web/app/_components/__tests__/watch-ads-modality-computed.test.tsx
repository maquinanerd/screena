// @vitest-environment jsdom

/**
 * watch-ads-modality-computed.test.tsx — "Grátis com anúncios" chega a tela, e
 * a prova e ESTILO COMPUTADO, nunca string de classe.
 *
 * ============ POR QUE ESTE ARQUIVO, E POR QUE ASSIM ============
 *
 * Decisao de Pablo Eduardo, 2026-08-19: o site exibe oferta gratuita com
 * anuncio. `ads` entrou em `PROMOTABLE_OFFER_TYPES` — mas promover e uma coisa,
 * e chegar a tela e outra. A propria historia deste modulo mostra a diferenca:
 * `ads` ja era uma modalidade CONHECIDA pelo vocabulario do render e mesmo assim
 * sumia, descartada por um `continue` mudo no presenter.
 *
 * O CRITERIO DA PROVA foi imposto de proposito: estilo computado, e nao
 * `markup.includes('watch-availability__group-title')`. As razoes sao concretas
 * neste repositorio:
 *
 *  1. Uma assercao sobre a CLASSE fica verde com `display: none` na regra. A
 *     classe estar no HTML nao e o mesmo que o texto estar visivel — e a
 *     diferenca ja custou uma auditoria aqui ("o conserto fica inerte e a
 *     auditoria continua reprovando", CSS resolvendo por ordem de documento num
 *     globals.css de 9 mil linhas).
 *  2. Uma assercao sobre markup cru nao distingue conteudo de atributo. Foi
 *     assim que quatro assercoes passaram pelo motivo errado na #165.
 *
 * ============ O CSS E O DE VERDADE ============
 *
 * As regras injetadas sao EXTRAIDAS de `apps/web/app/globals.css` em tempo de
 * teste, nao transcritas. Se alguem escrever `display: none` numa regra que
 * alcance o titulo do grupo, este arquivo reprova. Transcrever o CSS aqui
 * provaria apenas que a copia do teste concorda consigo mesma.
 *
 * LIMITE HONESTO: jsdom nao faz layout. Ele resolve a cascata e devolve
 * `display`/`visibility`/`opacity`/`font-size` computados — o suficiente para
 * provar que o no nao foi escondido. Nao prova posicionamento, sobreposicao nem
 * contraste; isso e trabalho do teste visual (`test:styles`).
 *
 * PLATAFORMAS FICTICIAS: `audit:invariants` proibe literal de plataforma REAL em
 * `.tsx` sob `app/_components/`. O que este arquivo prova nao depende do nome.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { WatchAvailabilityPanel } from '../watch-availability-panel'
import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
} from '../../../src/lib/watch-availability-presenter'
import { WATCH_MODALITY_LABELS } from '../../../src/lib/watch-offer-modality'

const GLOBALS_CSS = path.join(process.cwd(), 'apps', 'web', 'app', 'globals.css')

/**
 * Extrai de `globals.css` TODA regra cujo seletor mencione a fileira de "onde
 * assistir". Corte conservador: o objetivo e alimentar o jsdom com o CSS real
 * que alcanca estes nos, sem lhe entregar 9 mil linhas (que ele nem sempre
 * consegue analisar).
 */
function watchRules(): string {
  const css = readFileSync(GLOBALS_CSS, 'utf8')
  const blocks: string[] = []
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const selector = match[1]!.trim()
    if (selector.startsWith('@')) continue
    if (!/\.watch-(availability|offer|brand)/.test(selector)) continue
    blocks.push(`${selector}{${match[2]}}`)
  }
  return blocks.join('\n')
}

function adsRow(over: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: 'Exemploflix',
    providerKey: 'exemploflix',
    providerSlug: 'exemploflix',
    offerType: 'ads',
    deepLink: 'https://exemplo.test/gratis/1',
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: '2026-08-19T00:00:00.000Z',
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Agregador Exemplo',
    attributionUrl: 'https://exemplo.test/sobre',
    ...over,
  }
}

/** Monta o painel num DOM de verdade, com o CSS de verdade. */
function mount(rows: WatchAvailabilityRow[]): HTMLElement {
  const view = buildWatchAvailabilityView(rows)
  document.body.innerHTML = ''
  const style = document.createElement('style')
  style.textContent = watchRules()
  document.head.appendChild(style)
  const host = document.createElement('div')
  host.innerHTML = renderToStaticMarkup(<WatchAvailabilityPanel view={view} />)
  document.body.appendChild(host)
  return host
}

/**
 * O no esta VISIVEL para quem enxerga?
 *
 * Sobe a cadeia inteira de ancestrais: um `display: none` tres niveis acima
 * esconde o filho com a mesma eficacia de um no proprio no, e uma assercao que
 * so olhasse o elemento passaria verde com a secao inteira apagada.
 */
function isVisible(node: Element | null): boolean {
  let current: Element | null = node
  while (current !== null && current !== document.documentElement) {
    const style = getComputedStyle(current)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (style.opacity === '0') return false
    if (style.fontSize === '0px') return false
    current = current.parentElement
  }
  return node !== null
}

/** O titulo do grupo daquela modalidade, achado pelo TEXTO — nunca pela classe. */
function groupTitleWithText(host: HTMLElement, text: string): Element | null {
  const titles = [...host.querySelectorAll('.watch-availability__group-title')]
  return titles.find((el) => el.textContent?.trim() === text) ?? null
}

beforeAll(() => {
  // Se o corte do CSS nao pegar nada, todo o resto viraria uma prova vazia.
  expect(watchRules().length).toBeGreaterThan(0)
})

describe('`ads` chega a tela, rotulado, e VISIVEL', () => {
  it('CONTROLE POSITIVO: o titulo do grupo diz "Grátis com anúncios"', () => {
    const host = mount([adsRow()])
    const titulo = groupTitleWithText(host, WATCH_MODALITY_LABELS.ads)
    expect(titulo).not.toBeNull()
    expect(titulo!.textContent!.trim()).toBe('Grátis com anúncios')
  })

  it('o titulo NAO esta escondido — medido por estilo computado', () => {
    const host = mount([adsRow()])
    const titulo = groupTitleWithText(host, 'Grátis com anúncios')!
    const style = getComputedStyle(titulo)
    expect(style.display).not.toBe('none')
    expect(style.visibility).not.toBe('hidden')
    expect(style.fontSize).not.toBe('0px')
    // E nenhum ancestral o esconde (a secao inteira, o grupo, o host).
    expect(isVisible(titulo)).toBe(true)
  })

  it('CONTROLE NEGATIVO DA PROPRIA MEDIDA: `display:none` faz a assercao cair', () => {
    // Sem isto, `isVisible` poderia estar sempre devolvendo `true` e o teste
    // acima seria decorativo. Aqui a regra e injetada DEPOIS das de producao,
    // entao vence por ordem de documento — o mesmo mecanismo que ja deixou um
    // conserto inerte neste repositorio.
    const host = mount([adsRow()])
    const kill = document.createElement('style')
    kill.textContent = '.watch-availability__group-title{display:none}'
    document.head.appendChild(kill)

    const titulo = groupTitleWithText(host, 'Grátis com anúncios')!
    expect(getComputedStyle(titulo).display).toBe('none')
    expect(isVisible(titulo)).toBe(false)

    kill.remove()
    expect(isVisible(groupTitleWithText(host, 'Grátis com anúncios'))).toBe(true)
  })

  it('a oferta em si tambem chega visivel, com destino http(s)', () => {
    const host = mount([adsRow()])
    const link = host.querySelector<HTMLAnchorElement>('a.watch-offer__link')
    expect(link).not.toBeNull()
    expect(isVisible(link)).toBe(true)
    expect(link!.getAttribute('href')).toMatch(/^https:\/\//)
    expect(link!.getAttribute('rel')).toContain('nofollow')
  })
})

describe('`free` e `ads` continuam DISTINGUIVEIS na tela', () => {
  it('sao dois grupos, com dois rotulos diferentes, ambos visiveis', () => {
    const host = mount([
      adsRow(),
      adsRow({
        offerType: 'free',
        providerName: 'Fictifilmes',
        providerKey: 'fictifilmes',
        providerSlug: 'fictifilmes',
        deepLink: 'https://exemplo.test/livre/1',
      }),
    ])

    const gratis = groupTitleWithText(host, WATCH_MODALITY_LABELS.free)
    const comAnuncio = groupTitleWithText(host, WATCH_MODALITY_LABELS.ads)
    expect(gratis).not.toBeNull()
    expect(comAnuncio).not.toBeNull()
    expect(gratis).not.toBe(comAnuncio)
    expect(isVisible(gratis)).toBe(true)
    expect(isVisible(comAnuncio)).toBe(true)

    // Os rotulos sao textos DIFERENTES — colapsa-los diria ao leitor que a
    // oferta com publicidade e igual a sem.
    expect(WATCH_MODALITY_LABELS.free).not.toBe(WATCH_MODALITY_LABELS.ads)
    expect(gratis!.textContent!.trim()).toBe('Grátis')
    expect(comAnuncio!.textContent!.trim()).toBe('Grátis com anúncios')
  })

  it('cada grupo carrega a PROPRIA oferta — nenhuma migra de modalidade', () => {
    const host = mount([
      adsRow(),
      adsRow({
        offerType: 'free',
        providerName: 'Fictifilmes',
        providerKey: 'fictifilmes',
        providerSlug: 'fictifilmes',
        deepLink: 'https://exemplo.test/livre/1',
      }),
    ])
    const grupos = [...host.querySelectorAll('.watch-availability__group')]
    const porModalidade = new Map(
      grupos.map((g) => [g.getAttribute('data-offer-type'), g.querySelectorAll('a.watch-offer__link').length]),
    )
    expect(porModalidade.get('free')).toBe(1)
    expect(porModalidade.get('ads')).toBe(1)
  })

  it('a ordem canonica poe `free` ANTES de `ads` — gratis puro vem primeiro', () => {
    const host = mount([
      adsRow(),
      adsRow({
        offerType: 'free',
        providerName: 'Fictifilmes',
        providerKey: 'fictifilmes',
        providerSlug: 'fictifilmes',
        deepLink: 'https://exemplo.test/livre/1',
      }),
    ])
    const ordem = [...host.querySelectorAll('.watch-availability__group')].map((g) =>
      g.getAttribute('data-offer-type'),
    )
    expect(ordem.indexOf('free')).toBeLessThan(ordem.indexOf('ads'))
  })
})
