/**
 * footer-cookie-preferences.test.tsx — "Preferências de cookies" existe no
 * rodapé exatamente quando existe aviso de cookies para reabrir.
 *
 * O botão é a única forma de um visitante sem conta mudar de ideia (Política de
 * Privacidade, item 6.3). Sem ele, a autorização ao GA4 seria de mão única. Com
 * ele e sem GA4, abriria um aviso que não está na página.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SiteFooter } from '../site-footer'

const LABEL = 'Preferências de cookies'

function footerMarkup(): string {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    return renderToStaticMarkup(<SiteFooter />)
  } finally {
    spy.mockRestore()
  }
}

function stubOfficialProduction(): void {
  vi.stubEnv('CINERIE_PUBLIC_SITE_URL', 'https://cinerie.com')
  vi.stubEnv('NODE_ENV', 'production')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('rodapé — botão de preferências de cookies', () => {
  it('aparece na produção oficial com o GA4 configurado', () => {
    stubOfficialProduction()
    vi.stubEnv('CINERIE_GA4_MEASUREMENT_ID', 'G-AB12CD34EF')

    const markup = footerMarkup()
    expect(markup).toContain(LABEL)
    expect(markup).toContain('class="cookie-prefs-button"')
  })

  it('NÃO aparece sem GA4 — o beacon da Cloudflare não usa cookie, não há o que decidir', () => {
    stubOfficialProduction()

    expect(footerMarkup()).not.toContain(LABEL)
  })

  it('NÃO aparece fora da produção oficial, mesmo com o identificador', () => {
    vi.stubEnv('CINERIE_PUBLIC_SITE_URL', 'https://staging.cinerie.com')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CINERIE_GA4_MEASUREMENT_ID', 'G-AB12CD34EF')

    expect(footerMarkup()).not.toContain(LABEL)
  })
})
