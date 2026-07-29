/**
 * publication-media.ts — Entrega autenticada dos BYTES de uma midia editorial.
 *
 * Este endpoint existe para que o worker de projecao NUNCA precise baixar de
 * uma URL. A diferenca importa: uma URL pode ter sido escrita por um editor,
 * vinda do MNScr ou colada num bloco, e seguir aquele link significaria buscar
 * bytes num host arbitrario com a credencial do worker no bolso (SSRF). Aqui o
 * worker informa um `mediaId` CANONICO, e o CMS — o unico que conhece a licenca
 * — decide se pode entregar.
 *
 * A politica vive em `../media-authorization.js`, pura e testada sem servidor.
 * Este arquivo e o adaptador: autentica, busca o documento, aplica a politica e
 * transmite o arquivo.
 *
 * O que NUNCA sai daqui: caminho de filesystem, credencial de storage, URL
 * assinada de longa duracao e qualquer segredo.
 */

import { createHash } from 'node:crypto'

import type { Endpoint, PayloadRequest } from 'payload'

import { serviceHasScope } from '../access.js'
import { toActor } from '../actor.js'
import {
  authorizeMediaDelivery,
  isMediaPurpose,
  type MediaDocumentFacts,
} from '../media-authorization.js'
import { getMediaSource } from '../media-source-runtime.js'

/** MIME entregaveis. Espelha o `upload.mimeTypes` da collection `media`. */
export const DELIVERABLE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

/** Teto de entrega. Acima disso e original de camera, nao imagem de materia. */
export const MAX_DELIVERABLE_BYTES = 15 * 1024 * 1024

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toFacts(doc: Record<string, unknown> | null): MediaDocumentFacts {
  if (doc === null) {
    return {
      exists: false,
      licenseStatus: null,
      licenseExpiresAtIso: null,
      requiresAttribution: true,
      credit: null,
      allowedForEditorial: false,
      allowedForHero: false,
      allowedForSocial: false,
      mimeType: null,
      filesize: null,
      hasFile: false,
    }
  }
  return {
    exists: true,
    licenseStatus: text(doc.licenseStatus),
    licenseExpiresAtIso: text(doc.licenseExpiresAt),
    // Ausencia vira `true`: exigir credito por engano custa um campo
    // preenchido; deixar de exigir custa uma violacao de licenca.
    requiresAttribution: doc.requiresAttribution !== false,
    credit: text(doc.credit),
    allowedForEditorial: doc.allowedForEditorial === true,
    allowedForHero: doc.allowedForHero === true,
    allowedForSocial: doc.allowedForSocial === true,
    mimeType: text(doc.mimeType),
    filesize: typeof doc.filesize === 'number' ? doc.filesize : null,
    hasFile: text(doc.filename) !== null,
  }
}

export const publicationMediaEndpoint: Endpoint = {
  path: '/internal/publication-media/:mediaId',
  method: 'get',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const actor = toActor(req.user)
    if (actor.kind === 'anonymous') return json({ error: 'unauthenticated' }, 401)
    if (!serviceHasScope(actor, 'publication_projection')) {
      return json({ error: 'forbidden_scope' }, 403)
    }

    const mediaId = text((req.routeParams as { mediaId?: unknown } | undefined)?.mediaId)
    if (mediaId === null) return json({ error: 'missing_media_id' }, 400)

    const purposeParam = req.searchParams?.get('purpose') ?? 'editorial'
    if (!isMediaPurpose(purposeParam)) return json({ error: 'invalid_purpose' }, 400)

    // O id do Payload e inteiro no Postgres. Um `mediaId` nao numerico nunca
    // pode virar consulta: `findByID` com lixo levanta erro de driver, e o erro
    // de driver carrega detalhe de banco.
    if (!/^\d+$/.test(mediaId)) {
      return json({ error: 'media_not_found', code: 'media_not_found' }, 404)
    }

    let doc: Record<string, unknown> | null = null
    try {
      doc = (await req.payload.findByID({
        collection: 'media',
        id: mediaId,
        depth: 0,
        // A politica de licenca abaixo E o controle de acesso desta rota. A
        // leitura generica da collection e de humano; o worker chega por aqui.
        overrideAccess: true,
        req,
      })) as unknown as Record<string, unknown>
    } catch {
      doc = null
    }

    const verdict = authorizeMediaDelivery({
      facts: toFacts(doc),
      purpose: purposeParam,
      nowIso: new Date().toISOString(),
      allowedMimeTypes: [...DELIVERABLE_MIME_TYPES],
      maxBytes: MAX_DELIVERABLE_BYTES,
    })

    if (!verdict.allowed) {
      // `detail` e curto e de politica (ex.: "expired", "image/gif"): nunca
      // caminho interno nem conteudo do arquivo.
      const status = verdict.code === 'media_not_found' ? 404 : 403
      return json({ error: 'media_not_deliverable', code: verdict.code, detail: verdict.detail }, status)
    }

    // A LEITURA passa pela porta `PayloadMediaSource`: o endpoint nao sabe se o
    // arquivo esta em disco, em volume montado ou num bucket S3-compatible.
    // Trocar o driver nao muda nada daqui para frente — nem o hash entregue,
    // nem o `publication-event-v1`, nem a referencia publica final.
    const source = getMediaSource()
    if (source === null) {
      // Configuracao de storage invalida NAO vira 500 com stack.
      return json(
        { error: 'media_not_deliverable', code: 'storage_unavailable', detail: 'storage de upload indisponivel' },
        503,
      )
    }

    const filename = text(doc?.filename)
    const bytes =
      filename === null ? null : await source.read(filename, MAX_DELIVERABLE_BYTES)
    if (bytes === null) {
      return json({ error: 'media_not_deliverable', code: 'file_missing', detail: 'sem bytes' }, 404)
    }

    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    const mime = text(doc?.mimeType) ?? 'application/octet-stream'

    // Metadados VERIFICAVEIS em header. O worker recalcula o hash dos bytes que
    // recebeu e compara: se divergir, os bytes mudaram no caminho e nada e
    // gravado. Sem isso, o worker so poderia confiar no TLS.
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-length': String(bytes.length),
        'cache-control': 'no-store',
        'x-cinerie-media-id': mediaId,
        'x-cinerie-media-content-hash': contentHash,
        'x-cinerie-media-purpose': purposeParam,
        'x-cinerie-media-width': String(typeof doc?.width === 'number' ? doc.width : 0),
        'x-cinerie-media-height': String(typeof doc?.height === 'number' ? doc.height : 0),
        'x-cinerie-media-alt': encodeURIComponent(text(doc?.alt) ?? ''),
        'x-cinerie-media-caption': encodeURIComponent(text(doc?.caption) ?? ''),
        'x-cinerie-media-credit': encodeURIComponent(text(doc?.credit) ?? ''),
        'x-cinerie-media-rights-holder': encodeURIComponent(text(doc?.rightsHolder) ?? ''),
        'x-cinerie-media-source-name': encodeURIComponent(text(doc?.sourceName) ?? ''),
        'x-cinerie-media-source-url': encodeURIComponent(text(doc?.sourceUrl) ?? ''),
        'x-cinerie-media-license-status': text(doc?.licenseStatus) ?? '',
        'x-cinerie-media-license-reference': encodeURIComponent(text(doc?.licenseReference) ?? ''),
        'x-cinerie-media-license-expires-at': text(doc?.licenseExpiresAt) ?? '',
        'x-cinerie-media-requires-attribution': doc?.requiresAttribution === false ? 'false' : 'true',
        'x-cinerie-media-allowed-editorial': doc?.allowedForEditorial === true ? 'true' : 'false',
        'x-cinerie-media-allowed-hero': doc?.allowedForHero === true ? 'true' : 'false',
        'x-cinerie-media-allowed-social': doc?.allowedForSocial === true ? 'true' : 'false',
        // Referencia de DIAGNOSTICO: driver + nome. Nunca caminho, bucket,
        // endpoint ou URL assinada — isso entregaria topologia da infra.
        'x-cinerie-media-source': source.sourceReference(filename ?? ''),
      },
    })
  },
}
