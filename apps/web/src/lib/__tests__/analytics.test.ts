/**
 * analytics.test.ts — o que liga a medicao de audiencia, e como a escolha do
 * visitante e guardada.
 *
 * Os dois modulos sao FAIL-CLOSED, e por isso a maior parte dos casos aqui e
 * negativa: identificador torto, ambiente que nao e a producao oficial, escolha
 * vencida, malformada ou de outra versao — tudo isso tem de ler como "desligado"
 * ou "sem escolha", nunca como "aceitou".
 */

import { describe, expect, it } from 'vitest'

import {
  ANALYTICS_OFF,
  CLOUDFLARE_BEACON_SRC,
  GA4_COOKIE_MAX_AGE_SECONDS,
  analyticsConfig,
  cloudflareBeaconConfig,
  ga4ScriptUrl,
  parseCloudflareToken,
  parseGa4MeasurementId,
} from '../analytics-config'
import {
  CONSENT_MAX_AGE_DAYS,
  CONSENT_SCHEMA_VERSION,
  CONSENT_STORAGE_KEY,
  cookieDeletionAssignments,
  ga4CookieNames,
  parseStoredConsent,
  readConsent,
  serializeConsent,
  writeConsent,
} from '../analytics-consent'

const GA_ID = 'G-AB12CD34EF'
const CF_TOKEN = '0123456789abcdef0123456789abcdef'
const PRODUCTION = {
  CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com',
  NODE_ENV: 'production',
  CINERIE_GA4_MEASUREMENT_ID: GA_ID,
  CINERIE_CF_WEB_ANALYTICS_TOKEN: CF_TOKEN,
}

describe('analyticsConfig — so na producao oficial, so com identificador valido', () => {
  it('liga as duas ferramentas na producao oficial', () => {
    expect(analyticsConfig(PRODUCTION)).toEqual({ ga4MeasurementId: GA_ID, cloudflareToken: CF_TOKEN })
  })

  it('NAO liga fora da origem oficial, nem em NODE_ENV que nao e producao', () => {
    expect(analyticsConfig({ ...PRODUCTION, CINERIE_PUBLIC_SITE_URL: 'https://staging.cinerie.com' })).toEqual(
      ANALYTICS_OFF,
    )
    expect(analyticsConfig({ ...PRODUCTION, CINERIE_PUBLIC_SITE_URL: undefined })).toEqual(ANALYTICS_OFF)
    expect(analyticsConfig({ ...PRODUCTION, NODE_ENV: 'test' })).toEqual(ANALYTICS_OFF)
    expect(analyticsConfig({ ...PRODUCTION, VERCEL_ENV: 'preview' })).toEqual(ANALYTICS_OFF)
  })

  it('cada ferramenta liga sozinha: faltar uma nao derruba a outra', () => {
    expect(analyticsConfig({ ...PRODUCTION, CINERIE_GA4_MEASUREMENT_ID: undefined })).toEqual({
      ga4MeasurementId: null,
      cloudflareToken: CF_TOKEN,
    })
    expect(analyticsConfig({ ...PRODUCTION, CINERIE_CF_WEB_ANALYTICS_TOKEN: '' })).toEqual({
      ga4MeasurementId: GA_ID,
      cloudflareToken: null,
    })
  })

  it('identificador do GA4: aceita o formato do fluxo web, normaliza caixa e espaco', () => {
    expect(parseGa4MeasurementId(GA_ID)).toBe(GA_ID)
    expect(parseGa4MeasurementId('  g-ab12cd34ef ')).toBe(GA_ID)
  })

  it('CONTROLE NEGATIVO: identificador do GA4 malformado desliga', () => {
    for (const raw of [undefined, '', '   ', 'UA-12345-1', 'G-', 'G-ABC', 'AW-123456789', 'G-AB12CD34EF"><script>']) {
      expect(parseGa4MeasurementId(raw), String(raw)).toBeNull()
    }
  })

  it('token da Cloudflare: 32 hexadecimais; qualquer outra coisa desliga', () => {
    expect(parseCloudflareToken(CF_TOKEN.toUpperCase())).toBe(CF_TOKEN)
    for (const raw of [undefined, '', 'abc', `${CF_TOKEN}0`, 'g'.repeat(32), `${CF_TOKEN.slice(1)}"`]) {
      expect(parseCloudflareToken(raw), String(raw)).toBeNull()
    }
  })

  it('URLs e configuracoes dos scripts', () => {
    expect(CLOUDFLARE_BEACON_SRC).toBe('https://static.cloudflareinsights.com/beacon.min.js')
    expect(JSON.parse(cloudflareBeaconConfig(CF_TOKEN))).toEqual({ token: CF_TOKEN, spa: true })
    expect(ga4ScriptUrl(GA_ID)).toBe(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`)
  })

  it('cookie do GA4 vale 13 meses — o numero que a Politica de Privacidade declara', () => {
    expect(GA4_COOKIE_MAX_AGE_SECONDS).toBe(395 * 86_400)
  })
})

describe('a escolha do visitante — guardada no navegador, lida fail-closed', () => {
  const NOW = new Date('2026-10-30T12:00:00Z')
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

  it('ida e volta: o que se grava e o que se le', () => {
    expect(parseStoredConsent(serializeConsent('granted', NOW), NOW)).toBe('granted')
    expect(parseStoredConsent(serializeConsent('denied', NOW), NOW)).toBe('denied')
  })

  it(`vence em ${CONSENT_MAX_AGE_DAYS} dias — a Politica diz 6 meses`, () => {
    expect(CONSENT_MAX_AGE_DAYS).toBe(180)
    expect(parseStoredConsent(serializeConsent('granted', daysAgo(179)), NOW)).toBe('granted')
    expect(parseStoredConsent(serializeConsent('granted', daysAgo(181)), NOW)).toBeNull()
  })

  it('CONTROLE NEGATIVO: ausente, malformado, de outra versao ou do futuro = sem escolha', () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000)
    const casos: Array<string | null> = [
      null,
      '',
      'granted',
      '{',
      'null',
      JSON.stringify({ v: CONSENT_SCHEMA_VERSION + 1, choice: 'granted', at: NOW.toISOString() }),
      JSON.stringify({ v: CONSENT_SCHEMA_VERSION, choice: 'yes', at: NOW.toISOString() }),
      JSON.stringify({ v: CONSENT_SCHEMA_VERSION, choice: 'granted', at: 'ontem' }),
      JSON.stringify({ v: CONSENT_SCHEMA_VERSION, choice: 'granted' }),
      serializeConsent('granted', future),
    ]
    for (const raw of casos) expect(parseStoredConsent(raw, NOW), String(raw)).toBeNull()
  })

  it('armazenamento indisponivel nao vira "aceitou", e gravar falhando avisa', () => {
    const explode = () => {
      throw new Error('SecurityError')
    }
    expect(readConsent(null, NOW)).toBeNull()
    expect(readConsent({ getItem: explode }, NOW)).toBeNull()
    expect(writeConsent(null, 'granted', NOW)).toBe(false)
    expect(writeConsent({ setItem: explode }, 'granted', NOW)).toBe(false)
  })

  it('grava na chave declarada na Politica de Privacidade', () => {
    const memoria = new Map<string, string>()
    const storage = {
      getItem: (key: string) => memoria.get(key) ?? null,
      setItem: (key: string, value: string) => void memoria.set(key, value),
    }
    expect(writeConsent(storage, 'denied', NOW)).toBe(true)
    expect([...memoria.keys()]).toEqual([CONSENT_STORAGE_KEY])
    expect(CONSENT_STORAGE_KEY).toBe('cinerie:consentimento-analise')
    expect(readConsent(storage, NOW)).toBe('denied')
  })

  it('acha so os cookies do GA4', () => {
    expect(ga4CookieNames('_ga=GA1.1.1; _ga_AB12CD34EF=GS1; __Host-cinerie_csrf=x; _gat=1; galo=1')).toEqual([
      '_ga',
      '_ga_AB12CD34EF',
    ])
    expect(ga4CookieNames('')).toEqual([])
  })

  it('apaga o cookie sem dominio, no host e no dominio-pai', () => {
    expect(cookieDeletionAssignments('_ga', 'www.cinerie.com')).toEqual([
      '_ga=; Max-Age=0; Path=/',
      '_ga=; Max-Age=0; Path=/; Domain=www.cinerie.com',
      '_ga=; Max-Age=0; Path=/; Domain=.cinerie.com',
    ])
  })
})
