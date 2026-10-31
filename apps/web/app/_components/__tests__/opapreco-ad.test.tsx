/**
 * <OpaPrecoAd> renderizado no servidor (`react-dom/server`): o que o HTML leva
 * e o que ele NAO leva.
 *
 * O SDK do OpaPreço le os atributos do `<op-slot>`; o resto (reserva, pedido,
 * desenho, colapso, beacons) e dele. Entao o que se confere aqui e a marcacao:
 * os atributos certos, nenhum filho (o conteudo e do script), o script e a folha
 * de estilo do SDK, e nada quando a chave desliga.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import { OpaPrecoAd } from '../opapreco-ad'

const ENV_KEYS = ['NEXT_PUBLIC_OPAPRECO_ADS_ENABLED', 'CINERIE_PUBLIC_SITE_URL'] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function render(): string {
  return renderToStaticMarkup(
    <OpaPrecoAd
      className="art-ad art-ad--inline-01"
      contentId="4821"
      section="Filmes"
      slotKey="article-inline-01"
      tags={['Duna: Parte Dois', 'Denis Villeneuve']}
    />,
  )
}

describe('<OpaPrecoAd>', () => {
  it('ligado: o <op-slot> com a chave do slot, o site, o endpoint e o contexto da materia', () => {
    process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'true'
    const html = render()
    const slot = html.match(/<op-slot\b[^>]*>/)?.[0] ?? ''
    expect(slot).toContain('slot-key="article-inline-01"')
    expect(slot).toContain('site-key="cinerie"')
    expect(slot).toContain('endpoint="https://opapreco.com.br"')
    expect(slot).toContain('section="Filmes"')
    expect(slot).toContain('tags="Duna: Parte Dois,Denis Villeneuve"')
    expect(slot).toContain('content-id="4821"')
    expect(slot).toContain('class="art-ad art-ad--inline-01"')
    // Nenhum filho: o conteudo e do script. Nenhum link em volta do slot, nem
    // `/go/`/`/out/`/`/redirect/`: o clique vai direto para a Shopee.
    expect(html).toContain('<op-slot')
    expect(html).toMatch(/<op-slot\b[^>]*><\/op-slot>/)
    expect(html).not.toMatch(/<a\b|\/go\/|\/out\/|\/redirect\//)
  })

  it('ligado: o script async e a folha de estilo do SDK, servidos pelo OpaPreço', () => {
    process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'true'
    const html = render()
    expect(html).toMatch(/<script\b[^>]*\basync\b[^>]*src="https:\/\/opapreco\.com\.br\/v1\/ads\/sdk\/opapreco-ads\.js"/)
    expect(html).toContain('href="https://opapreco.com.br/v1/ads/sdk/opapreco-ads.css"')
  })

  it('nada do leitor no HTML do slot: nem cookie, nem e-mail, nem identificador', () => {
    process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'true'
    expect(render()).not.toMatch(/cookie|e-?mail|user-?id|session/i)
  })

  it('sem tags nem secao, os atributos nem saem', () => {
    process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'true'
    const html = renderToStaticMarkup(<OpaPrecoAd contentId="9" slotKey="article-top" />)
    const slot = html.match(/<op-slot\b[^>]*>/)?.[0] ?? ''
    expect(slot).toContain('slot-key="article-top"')
    expect(slot).not.toContain('tags=')
    expect(slot).not.toContain('section=')
  })

  it('desligado pela chave: nada — sem slot, sem script, sem folha de estilo', () => {
    process.env.NEXT_PUBLIC_OPAPRECO_ADS_ENABLED = 'false'
    process.env.CINERIE_PUBLIC_SITE_URL = 'https://cinerie.com'
    expect(render()).toBe('')
  })
})
