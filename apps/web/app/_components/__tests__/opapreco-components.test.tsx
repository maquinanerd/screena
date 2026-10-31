/**
 * Os seis componentes OpaPreco renderizados no servidor (`react-dom/server`):
 * as regras da SPEC que nao podem cair estao no MARKUP, entao e o markup que se
 * confere — um link patrocinado por oferta, nome acessivel com o disclosure,
 * CTA como `<span>`, disclosure visivel, desconto so com prova e com U+2212.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Offer } from '../../../src/lib/opapreco/types'
import { AdSkeleton } from '../opapreco/ad-skeleton'
import { AdSlotClient } from '../opapreco/ad-slot-client'
import { ContextualRecommendation } from '../opapreco/contextual-recommendation'
import { PriceDrop } from '../opapreco/price-drop'
import { ProductCard } from '../opapreco/product-card'
import { ProductCompact } from '../opapreco/product-compact'
import { ProductGrid } from '../opapreco/product-grid'
import { ProductHero } from '../opapreco/product-hero'

const NOW = Date.parse('2026-10-30T15:00:00.000Z')

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    offerId: 'ssd',
    productTitle: 'SSD NVMe Kingston Fury Renegade 1TB com Dissipador',
    productImage: '/api/opapreco/img?src=x',
    imageRatio: 'square',
    currentPrice: 549.9,
    referencePrice: 699.9,
    discountPercent: 21,
    merchant: 'Shopee',
    checkedAt: new Date(NOW - 12 * 60_000).toISOString(),
    href: 'https://example.com/aff/ssd',
    cta: null,
    ctaShort: null,
    eyebrow: null,
    affiliateDisclosure: null,
    priceDrop: null,
    lowest30d: null,
    isOfficialStore: false,
    ...overrides,
  }
}

function links(html: string): string[] {
  return html.match(/<a\b[^>]*>/g) ?? []
}

const SINGLE = [
  ['product_card_v1', (o: Offer) => <ProductCard now={NOW} offer={o} />, 'Link de afiliado'],
  ['product_compact_v1', (o: Offer) => <ProductCompact now={NOW} offer={o} />, 'Oferta afiliada'],
  ['product_hero_v1', (o: Offer) => <ProductHero now={NOW} offer={o} />, 'Link de afiliado'],
] as const

describe('um link patrocinado por oferta, CTA visual', () => {
  for (const [name, render, disclosure] of SINGLE) {
    it(`${name}: um <a> sponsored com aria-label completo e o disclosure visivel`, () => {
      const html = renderToStaticMarkup(render(offer()))
      const anchors = links(html)
      expect(anchors).toHaveLength(1)
      const anchor = anchors[0] ?? ''
      expect(anchor).toContain('rel="sponsored noopener"')
      expect(anchor).toContain('target="_blank"')
      expect(anchor).toContain('href="https://example.com/aff/ssd"')
      expect(anchor).toContain(
        `aria-label="SSD NVMe Kingston Fury Renegade 1TB com Dissipador por R$\u00a0549,90 na Shopee. ${disclosure}"`,
      )
      expect(anchor).toContain(`data-ad-component="${name}"`)
      // O CTA e um <span>: nenhum <button> nem segundo link dentro da oferta.
      expect(html).not.toContain('<button')
      expect(html).toMatch(/<span class="op-cta /)
      expect(html).toContain(`>${disclosure}`)
    })
  }

  it('grade: um link por oferta, cada um com o disclosure no nome acessivel', () => {
    const html = renderToStaticMarkup(
      <ProductGrid heading="Ofertas para o seu PS5" now={NOW} offers={[offer(), offer({ offerId: 'b', productTitle: 'Headset Sony Pulse 3D' })]} />,
    )
    const anchors = links(html)
    expect(anchors).toHaveLength(2)
    for (const anchor of anchors) {
      expect(anchor).toContain('rel="sponsored noopener"')
      expect(anchor).toMatch(/aria-label="[^"]+ na Shopee\. Link de afiliado"/)
    }
    expect(html).toContain('<section aria-label="Ofertas para o seu PS5. Links de afiliado"')
    expect(html).toContain('OpaPreço</span> · Links de afiliado')
    expect(html).toContain('Preços na Shopee, verificados há até 12 min.')
  })

  it('grade com menos de 2 ofertas nao renderiza', () => {
    expect(renderToStaticMarkup(<ProductGrid heading={null} now={NOW} offers={[offer()]} />)).toBe('')
  })

  it('contextual: <aside> com "Oferta afiliada", contexto e um unico link', () => {
    const html = renderToStaticMarkup(
      <ContextualRecommendation
        context="Se você está procurando um SSD para PS5"
        contextNote="Modelo NVMe PCIe 4.0 com dissipador."
        now={NOW}
        offer={offer()}
      />,
    )
    expect(html.startsWith('<aside aria-label="Oferta afiliada"')).toBe(true)
    expect(links(html)).toHaveLength(1)
    expect(html).toContain('Selecionada pelo <span class="op-sig__brand">OpaPreço</span>')
    expect(html).toContain('Shopee · preço verificado há 12 min')
  })
})

describe('preco, desconto e imagem', () => {
  it('desconto comprovado: preco riscado + −21% (U+2212) + texto falado', () => {
    const html = renderToStaticMarkup(<ProductCard now={NOW} offer={offer()} />)
    expect(html).toContain('−21%')
    expect(html).toContain('21% de desconto')
    expect(html).toContain('<s class="op-ref">')
    expect(html).toContain('Preço de referência')
  })

  it('sem desconto comprovado: so o preco atual', () => {
    const html = renderToStaticMarkup(
      <ProductCard now={NOW} offer={offer({ referencePrice: null, discountPercent: null })} />,
    )
    expect(html).not.toContain('−')
    expect(html).not.toContain('<s ')
    expect(html).toContain('549,90')
  })

  it('imagem: alt vazio, lazy (eager so no hero); sem imagem, icone e o quadro fica', () => {
    const card = renderToStaticMarkup(<ProductCard now={NOW} offer={offer()} />)
    expect(card).toMatch(/<img alt="" class="op-img__el"[^>]*loading="lazy"/)
    const hero = renderToStaticMarkup(<ProductHero now={NOW} offer={offer()} />)
    expect(hero).toMatch(/<img[^>]*loading="eager"/)
    const semImagem = renderToStaticMarkup(<ProductCard now={NOW} offer={offer({ productImage: null })} />)
    expect(semImagem).not.toContain('<img')
    expect(semImagem).toContain('class="op-img op-img--card"')
    expect(semImagem).toContain('op-img__empty')
  })

  it('hero: bloco "Preço monitorado" com menor preço de 30 dias e loja oficial', () => {
    const html = renderToStaticMarkup(
      <ProductHero now={NOW} offer={offer({ lowest30d: 549.9, isOfficialStore: true })} />,
    )
    expect(html).toContain('Preço monitorado pelo OpaPreço')
    expect(html).toContain('Preço verificado há 12 min · menor preço dos últimos 30 dias · loja oficial na Shopee')
    expect(html).toContain('Menor preço recente')
  })

  it('"Menor preço recente" sem prova vira "Oferta verificada"', () => {
    const html = renderToStaticMarkup(
      <ProductCard now={NOW} offer={offer({ eyebrow: 'Menor preço recente', lowest30d: 400 })} />,
    )
    expect(html).toContain('Oferta verificada')
    expect(html).not.toContain('Menor preço recente')
  })
})

describe('queda de preco', () => {
  const drop = offer({
    referencePrice: null,
    discountPercent: null,
    currentPrice: 329.9,
    priceDrop: { from: 399.9, percent: 18, since: 'nas últimas 24 h' },
  })

  it('queda comprovada: texto + seta + preco anterior riscado, CTA "Conferir preço"', () => {
    const html = renderToStaticMarkup(<PriceDrop now={NOW} offer={drop} />)
    expect(links(html)).toHaveLength(1)
    expect(html).toContain('Preço caiu 18%</span>')
    expect(html).toContain('registrou a queda nas últimas 24 h')
    expect(html).toContain('Preço anterior')
    expect(html).toContain('Conferir preço')
    expect(links(html)[0]).toContain('aria-label="Preço caiu 18%: ')
  })

  it('queda falsa (fixture fakeDrop) nao renderiza', () => {
    const fake = offer({ currentPrice: 100, priceDrop: { from: 102, percent: 2, since: null } })
    expect(renderToStaticMarkup(<PriceDrop now={NOW} offer={fake} />)).toBe('')
  })
})

describe('estado desabilitado (oferta vencida depois do render)', () => {
  it('sem href, aria-disabled, CTA "Oferta indisponível"', () => {
    const html = renderToStaticMarkup(<ProductCard disabled now={NOW} offer={offer()} />)
    const anchor = links(html)[0] ?? ''
    expect(anchor).not.toContain('href=')
    expect(anchor).toContain('aria-disabled="true"')
    expect(html).toContain('Oferta indisponível')
    expect(html).not.toContain('−21%')
  })
})

describe('raiz do slot no HTML do servidor', () => {
  it('data-op-slot, componente esperado, reserva por faixa, skeleton — e nenhum criativo', () => {
    const html = renderToStaticMarkup(<AdSlotClient className="cin-adslot--title-mid" id="title-mid" />)
    expect(html).toContain('data-op-slot="title-mid"')
    expect(html).toContain('data-ad-component="product_hero_v1"')
    expect(html).toContain('class="cin-adslot cin-adslot--loading cin-adslot--title-mid"')
    expect(html).toContain('--op-reserve-mobile:642px;--op-reserve-tablet:344px;--op-reserve-desktop:344px')
    expect(html).toContain('aria-hidden="true" class="op-skeleton op-skeleton--hero"')
    expect(html).not.toContain('<a ')
  })

  it('topo da materia: skeleton do hero e do compacto, o CSS escolhe pela faixa', () => {
    const html = renderToStaticMarkup(<AdSlotClient id="article-top" />)
    expect(html).toContain('class="op-only-wide"><span aria-hidden="true" class="op-skeleton op-skeleton--hero"')
    expect(html).toContain('class="op-only-narrow"><span aria-hidden="true" class="op-skeleton op-skeleton--compact"')
    expect(html).toContain('--op-reserve-mobile:88px')
  })

  it('lateral: classe que esconde abaixo de 1024px, sem reserva no celular', () => {
    const html = renderToStaticMarkup(<AdSlotClient id="news-sidebar" />)
    expect(html).toContain('class="cin-adslot cin-adslot--sidebar cin-adslot--loading"')
    expect(html).toContain('--op-reserve-mobile:0px;--op-reserve-tablet:0px;--op-reserve-desktop:416px')
  })
})

describe('skeleton', () => {
  it('cada componente tem skeleton decorativo (aria-hidden)', () => {
    for (const component of [
      'product_card_v1',
      'product_compact_v1',
      'product_hero_v1',
      'product_grid_v1',
      'price_drop_v1',
      'contextual_recommendation_v1',
    ] as const) {
      const html = renderToStaticMarkup(<AdSkeleton component={component} />)
      expect(html.startsWith('<span aria-hidden="true" class="op-skeleton'), component).toBe(true)
    }
  })
})
