/**
 * fixture.test.ts — O mapper contra a fixture SANITIZADA do payload real
 * (Titanic). Prova, num payload realista de ponta a ponta:
 *  - so `streamingOptions.br` vira oferta (o pais `us` e ignorado);
 *  - subscription/rent/buy/free sao mapeados; `addon` e DESCARTADO (unmapped);
 *  - link inseguro nunca aterrissa (aqui todos sao http(s) legitimos);
 *  - preco anda junto de currency ISO; timestamps convertem de unix;
 *  - o mapper NUNCA le `rating`/`imageSet`/`overview`/`cast`/`title` — as linhas
 *    so carregam campos de `WatchOfferRow`.
 */

import { describe, expect, it } from 'vitest'

import { mapShowPayload } from '../streaming-availability/mapping.js'
import type { SelectedEntity, WatchOfferRow } from '../streaming-availability/types.js'
import { TITANIC_SHOW_PAYLOAD } from './fixtures/titanic-show.js'

/** Entidade local que casa por IMDb id com a fixture. */
const TITANIC: SelectedEntity = {
  entityType: 'movie',
  entityId: '42',
  tmdbId: 597,
  imdbId: 'tt0120338',
}

/** As unicas chaves permitidas numa linha de `watch_availability`. */
const ALLOWED_OFFER_KEYS: ReadonlySet<string> = new Set<keyof WatchOfferRow>([
  'entityType',
  'entityId',
  'countryCode',
  'providerKey',
  'providerName',
  'offerType',
  'deepLink',
  'price',
  'currency',
  'quality',
  'availableFrom',
  'availableUntil',
] as const)

describe('mapShowPayload — fixture real (Titanic)', () => {
  const result = mapShowPayload(TITANIC_SHOW_PAYLOAD, TITANIC, 'BR')

  it('reconhece o payload e extrai SO as ofertas BR (addon descartado)', () => {
    expect(result.recognized).toBe(true)
    // 5 ofertas BR na fixture; o `addon` e descartado -> 4 linhas.
    expect(result.offers).toHaveLength(4)
    expect(result.offers.map((offer) => offer.offerType)).toEqual([
      'subscription',
      'rent',
      'buy',
      'free',
    ])
  })

  it('descarta o addon e o reporta como unmapped-offer-type mencionando addon', () => {
    const addonRejections = result.rejections.filter((rej) => rej.reason === 'unmapped-offer-type')
    expect(addonRejections).toHaveLength(1)
    expect(addonRejections[0]?.detail.toLowerCase()).toContain('addon')
    // Regra dura: nenhum addon vira subscription.
    expect(result.offers.filter((offer) => offer.providerName === 'Prime Video')).toHaveLength(0)
  })

  it('ignora o pais nao-BR (us) — nenhuma oferta internacional vira BR', () => {
    for (const offer of result.offers) {
      expect(offer.countryCode).toBe('BR')
      expect(offer.providerName).not.toBe('Max')
      expect(offer.deepLink ?? '').not.toContain('play.max.com')
    }
  })

  it('mapeia provider/preco/quality/timestamp corretamente', () => {
    const [subscription, rent, buy, free] = result.offers

    expect(subscription?.providerKey).toBe('netflix')
    expect(subscription?.providerName).toBe('Netflix')
    expect(subscription?.deepLink).toBe('https://www.netflix.com/br/title/12345678')
    expect(subscription?.quality).toBe('uhd')
    expect(subscription?.availableFrom?.getTime()).toBe(1_704_067_200_000)
    expect(subscription?.price).toBeNull()
    expect(subscription?.currency).toBeNull()

    expect(rent?.offerType).toBe('rent')
    expect(rent?.price).toBe(14.9)
    expect(rent?.currency).toBe('BRL')

    expect(buy?.offerType).toBe('buy')
    expect(buy?.price).toBe(34.9)
    expect(buy?.currency).toBe('BRL')

    expect(free?.offerType).toBe('free')
    expect(free?.price).toBeNull()
    expect(free?.currency).toBeNull()
  })

  it('as linhas NUNCA carregam rating/imageSet/overview/title — so campos de WatchOfferRow', () => {
    for (const offer of result.offers) {
      for (const key of Object.keys(offer)) {
        expect(ALLOWED_OFFER_KEYS.has(key)).toBe(true)
      }
      const asRecord = offer as unknown as Record<string, unknown>
      expect('rating' in asRecord).toBe(false)
      expect('imageSet' in asRecord).toBe(false)
      expect('overview' in asRecord).toBe(false)
      expect('title' in asRecord).toBe(false)
    }
  })
})

describe('mapShowPayload — fixture sem BR retorna vazio (country_missing:BR)', () => {
  it('quando streamingOptions nao tem BR, zero ofertas e recusa country-absent', () => {
    const noBr = {
      showType: 'movie',
      imdbId: 'tt0120338',
      tmdbId: 'movie/597',
      streamingOptions: {
        us: [{ type: 'subscription', service: { id: 'max', name: 'Max' }, link: 'https://play.max.com/x' }],
      },
    }
    const result = mapShowPayload(noBr, TITANIC, 'BR')
    expect(result.recognized).toBe(true)
    expect(result.offers).toHaveLength(0)
    expect(result.rejections[0]?.reason).toBe('country-absent')
    expect(result.rejections[0]?.detail).toContain('BR')
  })
})
