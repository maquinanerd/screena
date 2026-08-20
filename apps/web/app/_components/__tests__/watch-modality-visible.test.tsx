/**
 * watch-modality-visible.test.tsx — A MODALIDADE aparece em TEXTO VISIVEL nos
 * QUATRO consumidores de `licensedWatchWhere`.
 *
 * O QUE ESTE ARQUIVO MEDE, E POR QUE IMPORTA. A colheita de producao mostrou
 * que compra e aluguel sao a MAIORIA do corpus (18.077 `buy` + 18.330 `rent`
 * contra 10.970 `subscription`). Uma fileira que mostra so a marca num titulo
 * que custa aluguel afirma ao leitor que ja esta incluso no que ele paga.
 *
 * COMO ELE MEDE. `visibleText()` remove as TAGS INTEIRAS, com atributos. Um
 * rotulo que morasse em `aria-label`, `title` ou `data-modality` desaparece
 * dessa string e a assercao reprova. Isto e deliberado: na #165 quatro
 * assercoes passavam pelo motivo errado porque casavam o markup CRU, onde
 * atributo e conteudo sao indistinguiveis. Mede-se TEXTO, nao markup.
 *
 * PLATAFORMAS FICTICIAS ("Exemploflix", "Fictiloja"): `audit:invariants` proibe
 * literal de plataforma REAL em `.tsx` de `app/_components/`, e o guard
 * `no-fake-streaming-in-ui` varre o TEXTO do arquivo — comentario inclusive. O
 * que este arquivo prova nao depende do nome da marca.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomeTicker } from '../home-ticker'
import { WatchAvailabilityPanel } from '../watch-availability-panel'
import { WatchPlatformLine } from '../watch-platform-line'
import { WatchPopular } from '../watch-popular'
import type { HomeTickerItem } from '../../../src/lib/home-ticker-presenter'
import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
} from '../../../src/lib/watch-availability-presenter'

/**
 * Texto que o leitor VE. Remove `<script>`/`<style>` inteiros e depois toda tag
 * COM seus atributos — o que sobra so pode ter vindo de um no de texto.
 */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/\s+/g, ' ')
    .trim()
}

function offerRow(over: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: 'Fictiloja',
    providerKey: 'fictiloja',
    providerSlug: 'fictiloja',
    offerType: 'rent',
    deepLink: 'https://exemplo.test/aluguel/1',
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: '2026-08-13T00:00:00.000Z',
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Exemplo Agregador',
    attributionUrl: 'https://exemplo.test/sobre',
    ...over,
  }
}

function tickerItem(modalityLabel: string): HomeTickerItem {
  return {
    id: 'streaming_arrival:movie:1:2026-08-13',
    kind: 'streaming_arrival',
    badge: 'NOVO',
    title: 'Titulo de Teste',
    detail: 'chegou ao streaming',
    href: '/pt/filmes/titulo-de-teste/',
    eventAtIso: '2026-08-13',
    entityType: 'movie',
    entityId: '1',
    provider: {
      name: 'Fictiloja',
      key: 'fictiloja',
      modalityLabel,
      attributionText: 'Disponibilidade fornecida por Exemplo Agregador',
      attributionUrl: 'https://exemplo.test/sobre',
    },
  }
}

describe('a precondicao do corte: visibleText realmente descarta atributo', () => {
  it('CONTROLE NEGATIVO DA FERRAMENTA: texto so em atributo nao sobrevive', () => {
    // Sem esta verificacao, todas as assercoes abaixo poderiam estar passando
    // porque a ferramenta e permissiva demais — o modo de falha exato da #165.
    expect(visibleText('<span aria-label="Aluguel" data-x="Compra"></span>')).toBe('')
    expect(visibleText('<span title="Assinatura"></span>')).toBe('')
    expect(visibleText('<span>Aluguel</span>')).toBe('Aluguel')
  })
})

describe('1/4 — painel de detalhe', () => {
  it('CONTROLE POSITIVO: a modalidade da oferta esta no texto visivel', () => {
    const view = buildWatchAvailabilityView([offerRow()])
    const text = visibleText(renderToStaticMarkup(<WatchAvailabilityPanel view={view} />))
    expect(text).toContain('Aluguel')
    expect(text).toContain('Fictiloja')
  })

  it('as cinco modalidades aparecem, na ordem "incluso antes do que custa"', () => {
    const view = buildWatchAvailabilityView([
      offerRow({ offerType: 'buy', deepLink: 'https://exemplo.test/compra/1' }),
      offerRow({ offerType: 'ads', deepLink: 'https://exemplo.test/ads/1' }),
      offerRow({ offerType: 'subscription', deepLink: 'https://exemplo.test/assin/1' }),
      offerRow({ offerType: 'rent', deepLink: 'https://exemplo.test/aluguel/1' }),
      offerRow({ offerType: 'free', deepLink: 'https://exemplo.test/gratis/1' }),
    ])
    const text = visibleText(renderToStaticMarkup(<WatchAvailabilityPanel view={view} />))
    const posicoes = ['Assinatura', 'Grátis', 'Grátis com anúncios', 'Aluguel', 'Compra'].map(
      (label) => text.indexOf(label),
    )
    for (const posicao of posicoes) expect(posicao).toBeGreaterThanOrEqual(0)
    // Ordem declarada, nao emergente: o que nao custa nada vem primeiro.
    const assinatura = text.indexOf('Assinatura')
    expect(assinatura).toBeLessThan(text.indexOf('Aluguel'))
    expect(text.indexOf('Aluguel')).toBeLessThan(text.indexOf('Compra'))
  })

  it('UMA modalidade, TRES e CINCO — todas visiveis, nenhuma engolida', () => {
    const link = (n: number): string => `https://exemplo.test/o/${n}`
    const uma = buildWatchAvailabilityView([offerRow({ offerType: 'subscription', deepLink: link(1) })])
    expect(visibleText(renderToStaticMarkup(<WatchAvailabilityPanel view={uma} />))).toContain(
      'Assinatura',
    )

    const tres = buildWatchAvailabilityView([
      offerRow({ offerType: 'subscription', deepLink: link(2) }),
      offerRow({ offerType: 'rent', deepLink: link(3) }),
      offerRow({ offerType: 'buy', deepLink: link(4) }),
    ])
    const textoTres = visibleText(renderToStaticMarkup(<WatchAvailabilityPanel view={tres} />))
    for (const label of ['Assinatura', 'Aluguel', 'Compra']) {
      expect(textoTres).toContain(label)
    }

    const cinco = buildWatchAvailabilityView([
      offerRow({ offerType: 'subscription', deepLink: link(5) }),
      offerRow({ offerType: 'free', deepLink: link(6) }),
      offerRow({ offerType: 'ads', deepLink: link(7) }),
      offerRow({ offerType: 'rent', deepLink: link(8) }),
      offerRow({ offerType: 'buy', deepLink: link(9) }),
    ])
    expect(cinco?.groups).toHaveLength(5)
  })

  it('CONTROLE NEGATIVO: modalidade desconhecida nao vira rotulo na tela', () => {
    const vistos: string[] = []
    const view = buildWatchAvailabilityView([offerRow({ offerType: 'addon' })], {
      onUnsupportedOfferType: (_message, raw) => vistos.push(raw ?? ''),
    })
    const text = visibleText(renderToStaticMarkup(<WatchAvailabilityPanel view={view} />))
    // Nem rotulo inventado, nem o valor CRU na cara do leitor...
    expect(text).not.toContain('addon')
    expect(text).toBe('')
    // ...e o descarte foi CONTADO, com o valor bruto.
    expect(vistos).toEqual(['addon'])
  })
})

describe('2/4 — faixa da home', () => {
  it('CONTROLE POSITIVO: a modalidade acompanha o nome no texto visivel', () => {
    const text = visibleText(renderToStaticMarkup(<HomeTicker items={[tickerItem('Aluguel')]} />))
    expect(text).toContain('Fictiloja')
    expect(text).toContain('Aluguel')
  })

  it('assinatura e aluguel produzem textos DIFERENTES na faixa', () => {
    const assinatura = visibleText(
      renderToStaticMarkup(<HomeTicker items={[tickerItem('Assinatura')]} />),
    )
    const aluguel = visibleText(renderToStaticMarkup(<HomeTicker items={[tickerItem('Aluguel')]} />))
    // Se a faixa ignorasse a modalidade, as duas strings seriam identicas — e o
    // leitor nao teria como saber se paga de novo.
    expect(assinatura).not.toBe(aluguel)
    expect(assinatura).toContain('Assinatura')
    expect(aluguel).toContain('Aluguel')
  })
})

describe('3/4 — destaque do explorar', () => {
  it('CONTROLE POSITIVO: uma linha por plataforma, com as modalidades ao lado', () => {
    const text = visibleText(
      renderToStaticMarkup(
        <WatchPlatformLine modalityLabels={['Assinatura', 'Aluguel']} name="Exemploflix" />,
      ),
    )
    expect(text).toContain('Exemploflix')
    expect(text).toContain('Assinatura')
    expect(text).toContain('Aluguel')
    // UMA entrada da marca, nao duas: o nome aparece uma vez so.
    expect(text.split('Exemploflix')).toHaveLength(2)
  })

  it('plataforma sem modalidade conhecida nao ganha rotulo inventado', () => {
    const text = visibleText(
      renderToStaticMarkup(<WatchPlatformLine modalityLabels={[]} name="Exemploflix" />),
    )
    expect(text).toBe('Exemploflix')
  })
})

describe('4/4 — hub onde assistir', () => {
  // O hub passou a agrupar por MARCA (uma entrada por marca, rotas embaixo).
  // O que este bloco prova nao muda: o ROTULO de modalidade chega ao card.
  const brand = (labels: string[]): Parameters<typeof WatchPopular>[0]['brands'] => [
    {
      key: 'solo:fictiloja',
      name: 'Fictiloja',
      routes: [{ providerName: 'Fictiloja', label: null }],
      titles: [
        {
          entityType: 'movie',
          title: 'Titulo de Teste',
          href: '/pt/filmes/titulo-de-teste/',
          posterUrl: null,
          offerTypeLabels: labels,
        },
      ],
    },
  ]

  it('CONTROLE POSITIVO: os rotulos chegam ao texto visivel do card', () => {
    const text = visibleText(
      renderToStaticMarkup(<WatchPopular brands={brand(['Assinatura', 'Compra'])} />),
    )
    expect(text).toContain('Assinatura')
    expect(text).toContain('Compra')
  })

  it('CONTROLE NEGATIVO: valor cru do enum nunca chega a tela', () => {
    // O componente tinha um mapa proprio com `?? offer`: um valor novo do
    // upstream ia para a tela em jargao de API. Agora ele so recebe ROTULO.
    const text = visibleText(renderToStaticMarkup(<WatchPopular brands={brand([])} />))
    for (const cru of ['subscription', 'rent', 'buy', 'ads', 'addon']) {
      expect(text).not.toContain(cru)
    }
  })
})
