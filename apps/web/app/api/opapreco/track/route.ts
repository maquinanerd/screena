import { fireImpression } from '@screena/opapreco'

import { readOpaPrecoConfig } from '../../../../src/lib/opapreco/config'

/**
 * `POST /api/opapreco/track` — a impressao de um anuncio (50% visivel por 1 s,
 * medido no navegador). Corpo: `{ "url": "<tracking.impressionUrl>" }`.
 *
 * Quem dispara a URL do ad server e o SERVIDOR, para que o leitor nao contate
 * terceiro antes de clicar (mesmo motivo do proxy de imagem). E so dispara se a
 * URL for da ORIGEM do ad server configurado: esta rota publica nao pode virar
 * um disparador de GET para qualquer endereco. Sempre 204, sem corpo.
 */
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 4096

function done(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request): Promise<Response> {
  const config = readOpaPrecoConfig()
  if (config.mode !== 'live') return done()

  // `sendBeacon` e `fetch` da propria pagina mandam `same-origin`; outro site, nao.
  const site = request.headers.get('sec-fetch-site')
  if (site !== null && site !== 'same-origin') return done()

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return done()
  let url: unknown
  try {
    url = (JSON.parse(text) as { url?: unknown }).url
  } catch {
    return done()
  }
  if (typeof url !== 'string') return done()

  await fireImpression({ url, adServerUrl: config.adServerUrl })
  return done()
}
