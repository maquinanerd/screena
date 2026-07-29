/**
 * media-client.ts — Busca os BYTES de uma midia no endpoint interno do CMS.
 *
 * Worker-only. Este e o unico ponto do pipeline que recebe bytes de fora, e por
 * isso e o mais desconfiado:
 *
 *  - a origem e SEMPRE o endpoint interno, montado a partir da base configurada
 *    e de um `mediaId`. Nunca uma URL vinda do evento, do bloco ou do editor —
 *    seguir aquele link seria SSRF com a credencial do worker no bolso;
 *  - ZERO redirect. Um 302 do CMS para outro host levaria a mesma credencial
 *    para la;
 *  - o limite de bytes e aplicado durante o STREAMING, nao depois. Confiar em
 *    `Content-Length` deixaria uma resposta mentirosa encher a memoria antes de
 *    qualquer checagem.
 */

import { createHash } from 'node:crypto'

import type { MediaPurpose } from './media-plan.js'

export interface MediaFetchDeps {
  readonly baseUrl: string
  readonly authorization: string
  readonly requestTimeoutMs: number
  readonly maxBytes: number
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}

/** Metadados que o CMS envia junto dos bytes, para conferencia. */
export interface MediaEnvelope {
  readonly mediaId: string
  readonly bytes: Uint8Array
  readonly contentHash: string
  readonly declaredContentHash: string | null
  readonly declaredMime: string | null
  readonly width: number | null
  readonly height: number | null
  readonly alt: string
  readonly caption: string | null
  readonly credit: string | null
  readonly rightsHolder: string | null
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  readonly licenseStatus: string | null
  readonly licenseReference: string | null
  readonly licenseExpiresAtIso: string | null
  readonly requiresAttribution: boolean
  readonly allowedForEditorial: boolean
  readonly allowedForHero: boolean
  readonly allowedForSocial: boolean
}

export class MediaFetchError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

function header(response: Response, name: string): string | null {
  const raw = response.headers.get(name)
  if (raw === null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

function decodedHeader(response: Response, name: string): string | null {
  const raw = header(response, name)
  if (raw === null) return null
  try {
    const decoded = decodeURIComponent(raw).trim()
    return decoded === '' ? null : decoded
  } catch {
    return null
  }
}

function intHeader(response: Response, name: string): number | null {
  const parsed = Number.parseInt(header(response, name) ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Le o corpo com TETO REAL, abortando assim que o limite e ultrapassado.
 *
 * O teto e aplicado sobre os bytes que chegam, nao sobre o que a resposta
 * declara: um `Content-Length: 100` seguido de 2 GB de corpo derrubaria o
 * processo se acreditassemos no cabecalho.
 */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new MediaFetchError('media_too_large', 'Content-Length acima do limite', false)
  }

  const body = response.body
  if (body === null) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new MediaFetchError('media_too_large', 'corpo acima do limite', false)
    }
    return buffer
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      total += value.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new MediaFetchError('media_too_large', 'corpo acima do limite', false)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Baixa uma midia pelo id canonico, para a finalidade declarada. */
export async function fetchMediaEnvelope(
  deps: MediaFetchDeps,
  mediaId: string,
  purpose: MediaPurpose,
): Promise<MediaEnvelope> {
  // O id entra no CAMINHO: qualquer coisa que nao seja um id simples e recusada
  // antes de virar URL, para que nao exista caminho de `../` nem query injetada.
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mediaId)) {
    throw new MediaFetchError('media_id_invalid', 'mediaId fora do formato', false)
  }

  const url = `${deps.baseUrl}/api/internal/publication-media/${encodeURIComponent(mediaId)}?purpose=${purpose}`
  const doFetch = deps.fetchImpl ?? ((target, init) => fetch(target, init))

  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: { authorization: deps.authorization },
      // ZERO redirect. Um 302 para outro host levaria a credencial junto.
      redirect: 'error',
      signal: AbortSignal.timeout(deps.requestTimeoutMs),
    })
  } catch (error) {
    // Rede/timeout: transitorio, vale retentar.
    throw new MediaFetchError(
      'media_fetch_failed',
      `falha de rede ao buscar midia (${error instanceof Error ? error.name : 'desconhecida'})`,
      true,
    )
  }

  if (!response.ok) {
    // 403/404 sao decisao de POLITICA do CMS (licenca, finalidade, inexistente):
    // nao adianta retentar, o arquivo nao vai virar licenciado sozinho.
    const permanent = response.status === 403 || response.status === 404 || response.status === 400
    let code = `media_http_${String(response.status)}`
    try {
      const body = (await response.json()) as { code?: unknown }
      if (typeof body.code === 'string') code = body.code
    } catch {
      /* corpo nao-JSON: o status ja basta */
    }
    throw new MediaFetchError(
      code,
      `endpoint de midia respondeu ${String(response.status)}`,
      !permanent,
    )
  }

  const bytes = await readLimited(response, deps.maxBytes)
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`

  return {
    mediaId,
    bytes,
    contentHash,
    declaredContentHash: header(response, 'x-cinerie-media-content-hash'),
    declaredMime: header(response, 'content-type'),
    width: intHeader(response, 'x-cinerie-media-width'),
    height: intHeader(response, 'x-cinerie-media-height'),
    alt: decodedHeader(response, 'x-cinerie-media-alt') ?? 'imagem editorial',
    caption: decodedHeader(response, 'x-cinerie-media-caption'),
    credit: decodedHeader(response, 'x-cinerie-media-credit'),
    rightsHolder: decodedHeader(response, 'x-cinerie-media-rights-holder'),
    sourceName: decodedHeader(response, 'x-cinerie-media-source-name'),
    sourceUrl: decodedHeader(response, 'x-cinerie-media-source-url'),
    licenseStatus: header(response, 'x-cinerie-media-license-status'),
    licenseReference: decodedHeader(response, 'x-cinerie-media-license-reference'),
    licenseExpiresAtIso: header(response, 'x-cinerie-media-license-expires-at'),
    requiresAttribution: header(response, 'x-cinerie-media-requires-attribution') !== 'false',
    allowedForEditorial: header(response, 'x-cinerie-media-allowed-editorial') === 'true',
    allowedForHero: header(response, 'x-cinerie-media-allowed-hero') === 'true',
    allowedForSocial: header(response, 'x-cinerie-media-allowed-social') === 'true',
  }
}
