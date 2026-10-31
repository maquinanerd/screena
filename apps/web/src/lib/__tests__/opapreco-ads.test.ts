/**
 * opapreco-ads.test.ts — quando o OpaPreço Ads liga, e o que o slot manda.
 *
 * A chave tem três estados, e o terceiro (ausente) e o que vale em producao:
 * liga so na producao oficial. Os casos negativos importam tanto quanto o
 * positivo: CI, testes e maquina local nao podem falar com o OpaPreço sem que
 * alguem peça.
 */

import { describe, expect, it } from 'vitest'

import {
  OPAPRECO_ADS_ENDPOINT,
  OPAPRECO_ADS_IMAGE_ORIGINS,
  OPAPRECO_ADS_SCRIPT_URL,
  OPAPRECO_ADS_SITE_KEY,
  OPAPRECO_ADS_SLOT_KEYS,
  OPAPRECO_ADS_STYLESHEET_URL,
  isOpaPrecoAdsEnabled,
  opaPrecoAdTags,
} from '../opapreco-ads'

const PRODUCTION = { CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com', NODE_ENV: 'production' }
const LOCAL = { CINERIE_PUBLIC_SITE_URL: 'http://localhost:3000', NODE_ENV: 'development' }

describe('isOpaPrecoAdsEnabled — liga com o codigo na producao oficial, desliga pela chave', () => {
  it('sem a chave: liga na producao oficial', () => {
    expect(isOpaPrecoAdsEnabled(PRODUCTION)).toBe(true)
  })

  it('sem a chave: desligado fora da producao oficial (local, CI, staging, ambiente vazio)', () => {
    expect(isOpaPrecoAdsEnabled({})).toBe(false)
    expect(isOpaPrecoAdsEnabled(LOCAL)).toBe(false)
    expect(isOpaPrecoAdsEnabled({ ...PRODUCTION, NODE_ENV: 'development' })).toBe(false)
    expect(isOpaPrecoAdsEnabled({ ...PRODUCTION, CINERIE_PUBLIC_SITE_URL: 'https://staging.cinerie.com' })).toBe(false)
  })

  it('`false` desliga ate na producao oficial (chave de emergencia), com grafia tolerante', () => {
    for (const value of ['false', 'FALSE', ' false ', '0', 'off', 'no']) {
      expect(isOpaPrecoAdsEnabled({ ...PRODUCTION, NEXT_PUBLIC_OPAPRECO_ADS_ENABLED: value }), value).toBe(false)
    }
  })

  it('`true` liga em qualquer ambiente (conferir posicao e colapso numa maquina local)', () => {
    expect(isOpaPrecoAdsEnabled({ ...LOCAL, NEXT_PUBLIC_OPAPRECO_ADS_ENABLED: 'true' })).toBe(true)
    expect(isOpaPrecoAdsEnabled({ ...PRODUCTION, NEXT_PUBLIC_OPAPRECO_ADS_ENABLED: 'true' })).toBe(true)
  })

  it('valor desconhecido nao decide nada: vale o padrao do ambiente', () => {
    expect(isOpaPrecoAdsEnabled({ ...PRODUCTION, NEXT_PUBLIC_OPAPRECO_ADS_ENABLED: 'talvez' })).toBe(true)
    expect(isOpaPrecoAdsEnabled({ ...LOCAL, NEXT_PUBLIC_OPAPRECO_ADS_ENABLED: 'talvez' })).toBe(false)
  })
})

describe('opaPrecoAdTags — o atributo `tags` do <op-slot>', () => {
  it('junta com virgula, sem repetir (sem diferenca de caixa) e sem vazio', () => {
    expect(opaPrecoAdTags(['Duna', 'Denis Villeneuve', 'duna', '', null, undefined, '  '])).toBe(
      'Duna,Denis Villeneuve',
    )
  })

  it('virgula DENTRO de um titulo nao vira duas tags', () => {
    expect(opaPrecoAdTags(['Eu, Robô', 'Matrix'])).toBe('Eu Robô,Matrix')
  })

  it('sem nada aproveitavel, nao ha atributo', () => {
    expect(opaPrecoAdTags([])).toBeUndefined()
    expect(opaPrecoAdTags([null, '', ','])).toBeUndefined()
  })
})

describe('os dados do site no OpaPreço', () => {
  it('endpoint, chave do site e o SDK hospedado', () => {
    expect(OPAPRECO_ADS_ENDPOINT).toBe('https://opapreco.com.br')
    expect(OPAPRECO_ADS_SITE_KEY).toBe('cinerie')
    expect(OPAPRECO_ADS_SCRIPT_URL).toBe('https://opapreco.com.br/v1/ads/sdk/opapreco-ads.js')
    expect(OPAPRECO_ADS_STYLESHEET_URL).toBe('https://opapreco.com.br/v1/ads/sdk/opapreco-ads.css')
  })

  it('os slots do contrato (v1.2.0), e a imagem so do OpaPreço ou do CDN da Shopee', () => {
    // Os cinco da materia, e desde 2026-10-31 os da home, das listagens de
    // filmes e series e das fichas. Chave fora desta lista o OpaPreço recusa.
    expect(OPAPRECO_ADS_SLOT_KEYS).toEqual([
      'article-top',
      'article-inline-01',
      'article-inline-02',
      'article-bottom',
      'sidebar',
      'home-01',
      'home-02',
      'home-03',
      'listing-01',
      'listing-02',
      'listing-03',
      'detail-01',
      'detail-02',
    ])
    expect(OPAPRECO_ADS_IMAGE_ORIGINS).toEqual(['https://opapreco.com.br', 'https://cf.shopee.com.br'])
  })
})
