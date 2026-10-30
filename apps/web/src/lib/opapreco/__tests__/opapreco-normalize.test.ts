/**
 * OpaPreco — formatacao, validacao do contrato e registro de slots, contra as
 * fixtures do handoff (`__fixtures__/offers.json`, copia de
 * `docs/opapreco/fixtures/offers.json`).
 */

import { describe, expect, it } from 'vitest'

import fixtures from '../__fixtures__/offers.json'
import {
  OPAPRECO_IMAGE_PROXY_PATH,
  isAllowedImageHost,
  isOpaPrecoEnabled,
  parseImageHosts,
  readOpaPrecoConfig,
  resolveOfferImage,
} from '../config'
import { buildFixtureAdResponse } from '../fixtures'
import { checkedLabel, discountLabel, formatBRL, hasProvenDiscount, minutesSince } from '../format'
import { normalizeAdResponse, normalizeOffer, type NormalizeContext } from '../normalize'
import { OP_SLOTS, OP_SLOT_IDS, OP_VIEWPORTS, slotAccepts, viewportOf } from '../slots'

const NOW = Date.parse('2026-10-30T15:00:00.000Z')

type FixtureOffer = Record<string, unknown> & { checkedMinutesAgo?: number }

/** A fixture traz `checkedMinutesAgo`; o contrato quer `checkedAt` ISO. */
function asContract(offer: FixtureOffer): Record<string, unknown> {
  const { checkedMinutesAgo, ...rest } = offer
  return { ...rest, checkedAt: new Date(NOW - (checkedMinutesAgo ?? 0) * 60_000).toISOString() }
}

const LIVE = readOpaPrecoConfig({
  OPAPRECO_AD_SERVER_URL: 'https://ads.opapreco.example',
  OPAPRECO_PUBLISHER_ID: 'cinerie',
  OPAPRECO_IMAGE_HOSTS: 'placehold.co, *.susercontent.com',
})

function ctx(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    slot: 'article-bottom',
    viewport: 'desktop',
    now: NOW,
    resolveImage: (src) => resolveOfferImage(src, LIVE),
    ...overrides,
  }
}

const offers = fixtures.offers as unknown as Record<string, FixtureOffer>
const mustNotRender = fixtures.mustNotRender as unknown as Record<string, FixtureOffer>
const mustHideDiscount = fixtures.mustHideDiscount as unknown as Record<string, FixtureOffer>

function response(component: string, props: Record<string, unknown>, slot = 'article-bottom'): Record<string, unknown> {
  return { requestId: 'r-1', slot, component, props, tracking: { impressionUrl: 'https://ads.opapreco.example/i/1' } }
}

describe('formatacao (SPEC §4, §10, §12)', () => {
  it('preco em BRL pelo Intl pt-BR', () => {
    expect(formatBRL(299.9)).toBe(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(299.9))
    expect(formatBRL(299.9).replace(/\s/g, ' ')).toBe('R$ 299,90')
  })

  it('desconto com o sinal de menos U+2212, nunca hifen', () => {
    expect(discountLabel(17)).toBe('−17%')
    expect(discountLabel(17)).not.toContain('-')
  })

  it('verificacao: agora / ha X min / ha X h', () => {
    expect(checkedLabel(0)).toBe('Preço verificado agora')
    expect(checkedLabel(12)).toBe('Preço verificado há 12 min')
    expect(checkedLabel(59)).toBe('Preço verificado há 59 min')
    expect(checkedLabel(120)).toBe('Preço verificado há 2 h')
    expect(checkedLabel(5, false)).toBe('preço verificado há 5 min')
    expect(minutesSince(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe(12)
  })
})

describe('oferta: regras de exibicao', () => {
  it('as ofertas validas do handoff passam', () => {
    for (const [nome, offer] of Object.entries(offers)) {
      expect(normalizeOffer(asContract(offer), ctx()), nome).not.toBeNull()
    }
  })

  it('mustNotRender: verificada ha > 6 h e sem titulo nunca sao servidas', () => {
    expect(normalizeOffer(asContract(mustNotRender.stale as FixtureOffer), ctx())).toBeNull()
    expect(normalizeOffer(asContract(mustNotRender.noTitle as FixtureOffer), ctx())).toBeNull()
  })

  it('mustNotRender: queda falsa nao vira price_drop — o slot colapsa', () => {
    const fake = asContract(mustNotRender.fakeDrop as FixtureOffer)
    expect(normalizeOffer(fake, ctx())?.priceDrop).toBeNull()
    const decision = normalizeAdResponse(
      response('price_drop_v1', { offer: fake }, 'article-inline-02'),
      ctx({ slot: 'article-inline-02' }),
    )
    expect(decision).toBeNull()
  })

  it('mustHideDiscount: renderiza, mas so com o preco atual', () => {
    for (const [nome, offer] of Object.entries(mustHideDiscount)) {
      if (nome.startsWith('_')) continue
      const normalized = normalizeOffer(asContract(offer), ctx())
      expect(normalized, nome).not.toBeNull()
      expect(normalized?.referencePrice, nome).toBeNull()
      expect(normalized?.discountPercent, nome).toBeNull()
      expect(normalized !== null && hasProvenDiscount(normalized), nome).toBe(false)
    }
  })

  it('titulo acima de 120 caracteres e cortado na palavra, nao recusado', () => {
    const title = normalizeOffer(asContract(offers.longTitle as FixtureOffer), ctx())?.productTitle ?? ''
    expect(title.length).toBeLessThanOrEqual(120)
    expect(title.endsWith('…')).toBe(true)
    expect(title.startsWith('Controle sem Fio Sony DualSense Edge')).toBe(true)
  })

  it('desconto comprovado fica (referencia acima do preco e >= 5%)', () => {
    const normalized = normalizeOffer(asContract(offers.withDiscount as FixtureOffer), ctx())
    expect(normalized?.referencePrice).toBe(699.9)
    expect(normalized?.discountPercent).toBe(21)
  })

  it('link que nao e https e recusado; oferta "no futuro" alem da tolerancia tambem', () => {
    const base = asContract(offers.noDiscount as FixtureOffer)
    expect(normalizeOffer({ ...base, href: 'http://example.com/aff' }, ctx())).toBeNull()
    expect(normalizeOffer({ ...base, href: '#' }, ctx())).toBeNull()
    expect(normalizeOffer({ ...base, href: 'javascript:alert(1)' }, ctx())).toBeNull()
    expect(normalizeOffer({ ...base, checkedAt: new Date(NOW + 60 * 60_000).toISOString() }, ctx())).toBeNull()
    expect(normalizeOffer({ ...base, merchant: 'Amazon' }, ctx())).toBeNull()
  })

  it('imagem: host da lista vira o proxy de mesma origem; fora dela, icone neutro', () => {
    const base = asContract(offers.withDiscount as FixtureOffer)
    expect(normalizeOffer(base, ctx())?.productImage).toBe(
      `${OPAPRECO_IMAGE_PROXY_PATH}?src=${encodeURIComponent('https://placehold.co/600x600/png')}`,
    )
    expect(normalizeOffer({ ...base, productImage: 'https://evil.example/x.png' }, ctx())?.productImage).toBeNull()
    expect(normalizeOffer(asContract(offers.noImage as FixtureOffer), ctx())?.productImage).toBeNull()
  })
})

describe('resposta do ad server', () => {
  it('grade com menos de 2 ofertas validas nao renderiza', () => {
    const one = [asContract(offers.noDiscount as FixtureOffer), asContract(mustNotRender.stale as FixtureOffer)]
    expect(normalizeAdResponse(response('product_grid_v1', { offers: one }), ctx())).toBeNull()
  })

  it('grade do handoff: 4 ofertas, no maximo 4; no celular, 3 viram 2', () => {
    const four = ['longTitle', 'noDiscount', 'verticalImage', 'horizontalImage'].map((k) =>
      asContract(offers[k] as FixtureOffer),
    )
    const decision = normalizeAdResponse(
      response('product_grid_v1', { heading: 'Ofertas para o seu PS5', offers: [...four, four[0]] }),
      ctx(),
    )
    expect(decision?.component).toBe('product_grid_v1')
    expect(decision && 'offers' in decision ? decision.offers.length : 0).toBe(4)
    const mobile = normalizeAdResponse(
      response('product_grid_v1', { offers: four.slice(0, 3) }),
      ctx({ viewport: 'mobile' }),
    )
    expect(mobile && 'offers' in mobile ? mobile.offers.length : 0).toBe(2)
  })

  it('componente que o slot nao aceita, slot trocado e sem tracking colapsam', () => {
    const offer = asContract(offers.hero as FixtureOffer)
    expect(normalizeAdResponse(response('product_hero_v1', { offer }), ctx())).toBeNull()
    expect(normalizeAdResponse(response('product_hero_v1', { offer }, 'title-mid'), ctx({ slot: 'title-bottom' }))).toBeNull()
    const semTracking = { ...response('product_hero_v1', { offer }, 'title-mid'), tracking: {} }
    expect(normalizeAdResponse(semTracking, ctx({ slot: 'title-mid' }))).toBeNull()
    expect(normalizeAdResponse(response('product_hero_v1', { offer }, 'title-mid'), ctx({ slot: 'title-mid' }))).not.toBeNull()
  })

  it('topo da materia: hero no desktop, compacto no celular', () => {
    const offer = asContract(offers.hero as FixtureOffer)
    expect(normalizeAdResponse(response('product_hero_v1', { offer }, 'article-top'), ctx({ slot: 'article-top' }))).not.toBeNull()
    expect(
      normalizeAdResponse(response('product_hero_v1', { offer }, 'article-top'), ctx({ slot: 'article-top', viewport: 'mobile' })),
    ).toBeNull()
    expect(
      normalizeAdResponse(response('product_compact_v1', { offer }, 'article-top'), ctx({ slot: 'article-top', viewport: 'mobile' })),
    ).not.toBeNull()
  })

  it('contextual exige contexto <= 90; nota > 140 cai, a oferta fica', () => {
    const slot = fixtures.slots.contextual
    const offer = asContract(offers.withDiscount as FixtureOffer)
    const ok = normalizeAdResponse(
      response('contextual_recommendation_v1', { offer, context: slot.props.context, contextNote: slot.props.contextNote }, 'article-inline-01'),
      ctx({ slot: 'article-inline-01' }),
    )
    expect(ok?.component).toBe('contextual_recommendation_v1')
    const semContexto = normalizeAdResponse(
      response('contextual_recommendation_v1', { offer, context: 'x'.repeat(91) }, 'article-inline-01'),
      ctx({ slot: 'article-inline-01' }),
    )
    expect(semContexto).toBeNull()
    const notaLonga = normalizeAdResponse(
      response('contextual_recommendation_v1', { offer, context: 'Para quem joga no PS5', contextNote: 'y'.repeat(141) }, 'article-inline-01'),
      ctx({ slot: 'article-inline-01' }),
    )
    expect(notaLonga && 'contextNote' in notaLonga ? notaLonga.contextNote : 'erro').toBeNull()
  })

  it('price_drop comprovado passa no article-inline-02', () => {
    const decision = normalizeAdResponse(
      response('price_drop_v1', { offer: asContract(offers.priceDrop as FixtureOffer) }, 'article-inline-02'),
      ctx({ slot: 'article-inline-02' }),
    )
    expect(decision?.component).toBe('price_drop_v1')
  })
})

describe('registro de slots e ambiente', () => {
  it('todo slot tem componente e reserva por faixa; lateral so no desktop', () => {
    expect(OP_SLOT_IDS.length).toBe(26)
    for (const id of OP_SLOT_IDS) {
      const slot = OP_SLOTS[id]
      for (const viewport of OP_VIEWPORTS) {
        expect(slot.components[viewport].length, `${id}/${viewport}`).toBeGreaterThan(0)
        if (!slot.sidebar) expect(slot.reserve[viewport], `${id}/${viewport}`).not.toBeNull()
      }
      if (slot.sidebar) {
        expect(slot.reserve.mobile).toBeNull()
        expect(slot.reserve.tablet).toBeNull()
        expect(slot.components.desktop).toEqual(['product_card_v1'])
      }
    }
    // So article-inline-02 aceita price_drop: no maximo 1 por pagina.
    const comDrop = OP_SLOT_IDS.filter((id) => slotAccepts(id, 'desktop', 'price_drop_v1'))
    expect(comDrop).toEqual(['article-inline-02'])
    expect(OP_SLOTS['news-top'].components.desktop).toEqual(['product_compact_v1'])
  })

  it('faixas de viewport da SPEC', () => {
    expect(viewportOf(375)).toBe('mobile')
    expect(viewportOf(767)).toBe('mobile')
    expect(viewportOf(768)).toBe('tablet')
    expect(viewportOf(1023)).toBe('tablet')
    expect(viewportOf(1024)).toBe('desktop')
  })

  it('desligado por padrao; live exige https + publisher; off desliga tudo', () => {
    expect(isOpaPrecoEnabled({})).toBe(false)
    expect(isOpaPrecoEnabled({ OPAPRECO_AD_SERVER_URL: 'http://ads.example', OPAPRECO_PUBLISHER_ID: 'c' })).toBe(false)
    expect(isOpaPrecoEnabled({ OPAPRECO_AD_SERVER_URL: 'https://ads.example' })).toBe(false)
    expect(isOpaPrecoEnabled({ OPAPRECO_AD_SERVER_URL: 'https://ads.example', OPAPRECO_PUBLISHER_ID: 'c' })).toBe(true)
    expect(
      isOpaPrecoEnabled({ OPAPRECO_AD_SERVER_URL: 'https://ads.example', OPAPRECO_PUBLISHER_ID: 'c', OPAPRECO_MODE: 'off' }),
    ).toBe(false)
  })

  it('fixtures: so fora da origem oficial (oferta ficticia nunca no site publico)', () => {
    expect(readOpaPrecoConfig({ OPAPRECO_MODE: 'fixtures', CINERIE_PUBLIC_SITE_URL: 'http://localhost:3000' }).mode).toBe('fixtures')
    expect(readOpaPrecoConfig({ OPAPRECO_MODE: 'fixtures', CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com' }).mode).toBe('off')
  })

  it('lista de hosts de imagem: exato ou *.subdominio, nunca sufixo solto', () => {
    const hosts = parseImageHosts('cf.shopee.com.br, *.susercontent.com, http://x, lixo')
    expect(hosts).toEqual(['cf.shopee.com.br', '*.susercontent.com'])
    expect(isAllowedImageHost('down-br.img.susercontent.com', hosts)).toBe(true)
    expect(isAllowedImageHost('susercontent.com', hosts)).toBe(false)
    expect(isAllowedImageHost('evilsusercontent.com', hosts)).toBe(false)
    expect(isAllowedImageHost('cf.shopee.com.br.evil.com', hosts)).toBe(false)
  })

  it('as fixtures de QA passam pela MESMA validacao em todo slot e faixa', () => {
    const fixturesConfig = readOpaPrecoConfig({ OPAPRECO_MODE: 'fixtures' })
    for (const id of OP_SLOT_IDS) {
      for (const viewport of OP_VIEWPORTS) {
        if (OP_SLOTS[id].reserve[viewport] === null) continue
        const raw = buildFixtureAdResponse(id, viewport, { vertical: 'movie' }, NOW)
        const decision = normalizeAdResponse(raw, {
          slot: id,
          viewport,
          now: NOW,
          resolveImage: (src) => resolveOfferImage(src, fixturesConfig),
        })
        expect(decision, `${id}/${viewport}`).not.toBeNull()
      }
    }
  })
})
