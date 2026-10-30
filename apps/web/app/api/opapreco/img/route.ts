import { fetchAllowedImage } from '@screena/opapreco'

import { isAllowedImageHost, readOpaPrecoConfig } from '../../../../src/lib/opapreco/config'

/**
 * `GET /api/opapreco/img?src=<url>` — a foto do produto, servida pela origem da
 * Cinerie.
 *
 * POR QUE PROXY: a Politica de Privacidade (item 6) afirma que o unico conteudo
 * de terceiro na pagina e o player de video, e so depois do clique. Uma `<img>`
 * apontando para o CDN da loja faria todo leitor contatar terceiro ao abrir a
 * pagina. Com o proxy, o navegador so fala com a Cinerie ate clicar na oferta —
 * e o CSP (`img-src 'self'`) nao precisa mudar.
 *
 * O QUE O PROXY NAO VIRA: um buscador de qualquer URL. So https, so os hosts de
 * `OPAPRECO_IMAGE_HOSTS`, sem seguir redirect, so imagem raster (SVG de terceiro
 * servido daqui carregaria script com o cookie do site), ate 2 MB, 1,5 s.
 */
export const dynamic = 'force-dynamic'

function notFound(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request): Promise<Response> {
  const config = readOpaPrecoConfig()
  if (config.mode !== 'live') return notFound()

  const src = new URL(request.url).searchParams.get('src')
  if (src === null || src.length > 2048) return notFound()
  let target: URL
  try {
    target = new URL(src)
  } catch {
    return notFound()
  }
  if (target.protocol !== 'https:' || target.username !== '' || target.password !== '') return notFound()
  if (!isAllowedImageHost(target.hostname, config.imageHosts)) return notFound()

  const image = await fetchAllowedImage({ url: target.toString() })
  if (image === null) return notFound()

  return new Response(image.bytes, {
    status: 200,
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
