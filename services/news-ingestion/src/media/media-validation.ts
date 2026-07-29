/**
 * media-validation.ts — Validacao de bytes de imagem editorial. PURO.
 *
 * Esta e a porta de seguranca da projecao de midia. Ela decide se um punhado de
 * bytes pode virar arquivo publico do Cinerie, e faz isso olhando os BYTES —
 * nunca a extensao, nunca o `Content-Type` declarado, nunca o nome do upload.
 *
 * Por que tao desconfiado: o arquivo entra pelo painel, foi enviado por uma
 * pessoa, e vai ser servido no dominio publico. Um SVG e um documento com
 * script; um "PNG" que na verdade e HTML vira XSS se algum dia for servido com
 * o MIME errado; uma imagem de 60.000 x 60.000 pixels derruba qualquer
 * processador de imagem por memoria muito antes de gerar uma miniatura.
 */

/** MIME aceitos no MVP. Raster, sem script, processaveis. */
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number]

/** Extensao canonica por MIME. NUNCA vem do nome enviado pelo usuario. */
export const EXTENSION_BY_MIME: Record<AllowedImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export interface MediaLimits {
  readonly maxBytes: number
  readonly maxPixels: number
  readonly maxDimension: number
  readonly minDimension: number
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  // 15 MB: acima disso e original de camera, nao imagem de materia.
  maxBytes: 15 * 1024 * 1024,
  // 40 megapixels. Uma "imagem" de 60k x 60k cabe em poucos KB comprimida e
  // estoura a memoria de qualquer decodificador — o limite e de PIXELS, nao de
  // bytes, exatamente por isso.
  maxPixels: 40_000_000,
  maxDimension: 12_000,
  minDimension: 16,
}

/* ------------------------------------------------------------------ */
/* Deteccao por assinatura                                             */
/* ------------------------------------------------------------------ */

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

/**
 * Trecho ASCII do buffer.
 *
 * `exact` distingue dois usos que parecem o mesmo e nao sao. Assinatura de
 * formato precisa dos 4 bytes EXATOS (faltou byte, nao e aquele formato). Ja a
 * janela de inspecao de conteudo precisa ler O QUE HOUVER: exigir 512 bytes ali
 * fazia um SVG de 40 bytes voltar string vazia e escapar da deteccao — foi
 * exatamente este o defeito.
 */
function ascii(bytes: Uint8Array, offset: number, length: number, exact = true): string {
  if (exact && bytes.length < offset + length) return ''
  const end = Math.min(bytes.length, offset + length)
  let out = ''
  for (let index = offset; index < end; index += 1) out += String.fromCharCode(bytes[index] ?? 0)
  return out
}

/**
 * MIME REAL a partir dos primeiros bytes. `null` quando nao e um dos formatos
 * permitidos — inclusive quando e um formato de imagem valido porem proibido
 * (SVG, GIF, BMP): reconhecer nao e permitir.
 */
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // WebP: "RIFF" .... "WEBP"
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  // AVIF: caixa ISO-BMFF "ftyp" com marca avif/avis
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}

/**
 * Os bytes sao de um formato PERIGOSO conhecido?
 *
 * Serve para dar um motivo preciso na recusa. "SVG recusado" ensina; "formato
 * desconhecido" faz o editor tentar de novo com o mesmo arquivo.
 */
export function detectDangerousFormat(bytes: Uint8Array): string | null {
  const head = ascii(bytes, 0, 512, false).trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'svg_or_xml'
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (startsWith(bytes, [0x4d, 0x5a])) return 'executable'
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'executable'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'archive'
  return null
}

/* ------------------------------------------------------------------ */
/* Dimensoes                                                           */
/* ------------------------------------------------------------------ */

export interface Dimensions {
  readonly width: number
  readonly height: number
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0)
}
function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    ((bytes[offset + 3] ?? 0) >>> 0)
  ) >>> 0
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1] ?? 0
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carregam as dimensoes.
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isSof) {
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) }
    }
    const segmentLength = readUint16BE(bytes, offset + 2)
    if (segmentLength <= 0) return null
    offset += 2 + segmentLength
  }
  return null
}

function pngDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 24) return null
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  const format = ascii(bytes, 12, 4)
  if (format === 'VP8X' && bytes.length >= 30) {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16))
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    return { width, height }
  }
  if (format === 'VP8L' && bytes.length >= 25) {
    const bits =
      (bytes[21] ?? 0) | ((bytes[22] ?? 0) << 8) | ((bytes[23] ?? 0) << 16) | ((bytes[24] ?? 0) << 24)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (format === 'VP8 ' && bytes.length >= 30) {
    return {
      width: readUint16BE(bytes, 27) === 0 ? 0 : ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff,
      height: ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff,
    }
  }
  return null
}

/**
 * Dimensoes lidas do cabecalho.
 *
 * AVIF devolve `null` de proposito: as dimensoes vivem dentro da caixa `ispe`,
 * cujo deslocamento varia, e um parser incompleto que "acerta as vezes" e pior
 * do que nenhum — ele deixaria passar uma imagem gigante quando errasse. Sem
 * dimensao lida, o gate de pixels nao pode ser aplicado, e a politica trata
 * isso explicitamente (ver `validateImageBytes`).
 */
export function readImageDimensions(bytes: Uint8Array, mime: AllowedImageMime): Dimensions | null {
  const dimensions =
    mime === 'image/jpeg'
      ? jpegDimensions(bytes)
      : mime === 'image/png'
        ? pngDimensions(bytes)
        : mime === 'image/webp'
          ? webpDimensions(bytes)
          : null
  if (dimensions === null) return null
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) return null
  if (dimensions.width <= 0 || dimensions.height <= 0) return null
  return dimensions
}

/* ------------------------------------------------------------------ */
/* Veredito                                                            */
/* ------------------------------------------------------------------ */

export type MediaRejectionCode =
  | 'empty_file'
  | 'too_large'
  | 'dangerous_format'
  | 'unsupported_format'
  | 'declared_mime_mismatch'
  | 'dimensions_unreadable'
  | 'dimensions_out_of_range'
  | 'too_many_pixels'
  | 'content_hash_mismatch'

export type MediaValidation =
  | {
      readonly ok: true
      readonly mime: AllowedImageMime
      readonly extension: string
      readonly byteSize: number
      readonly dimensions: Dimensions | null
      readonly contentHash: string
    }
  | { readonly ok: false; readonly code: MediaRejectionCode; readonly detail: string }

export interface ValidateImageInput {
  readonly bytes: Uint8Array
  /** Hash calculado dos bytes recebidos (o nucleo nao faz cripto). */
  readonly contentHash: string
  /** MIME que o Payload declarou. Serve para DETECTAR divergencia, nao para confiar. */
  readonly declaredMime?: string | null
  /** Hash que o Payload prometeu. Divergencia = bytes trocados no caminho. */
  readonly expectedContentHash?: string | null
  readonly limits?: MediaLimits
  /**
   * Aceitar formato cujas dimensoes nao conseguimos ler (hoje: AVIF)?
   *
   * Default `false` — fail-closed. Ligar isto significa abrir mao do gate de
   * pixels para aquele formato, e essa e uma decisao consciente, nao um efeito
   * colateral de um parser incompleto.
   */
  readonly allowUnreadableDimensions?: boolean
}

export function validateImageBytes(input: ValidateImageInput): MediaValidation {
  const limits = input.limits ?? DEFAULT_MEDIA_LIMITS
  const bytes = input.bytes

  if (bytes.length === 0) {
    return { ok: false, code: 'empty_file', detail: 'arquivo vazio' }
  }
  if (bytes.length > limits.maxBytes) {
    return {
      ok: false,
      code: 'too_large',
      detail: `${String(bytes.length)} bytes acima do limite de ${String(limits.maxBytes)}`,
    }
  }

  // Hash ANTES do formato: bytes trocados no caminho nao merecem nem analise.
  if (
    input.expectedContentHash !== undefined &&
    input.expectedContentHash !== null &&
    input.expectedContentHash !== '' &&
    input.expectedContentHash !== input.contentHash
  ) {
    return {
      ok: false,
      code: 'content_hash_mismatch',
      detail: 'hash dos bytes difere do prometido pelo CMS',
    }
  }

  const dangerous = detectDangerousFormat(bytes)
  if (dangerous !== null) {
    return { ok: false, code: 'dangerous_format', detail: dangerous }
  }

  const mime = sniffImageMime(bytes)
  if (mime === null) {
    return { ok: false, code: 'unsupported_format', detail: 'assinatura nao reconhecida' }
  }

  // O MIME declarado so importa para PEGAR MENTIRA. Um PNG declarado como
  // `image/jpeg` indica manipulacao ou pipeline quebrado; nos dois casos, parar.
  const declared = (input.declaredMime ?? '').trim().toLowerCase()
  if (declared !== '' && declared !== mime) {
    return {
      ok: false,
      code: 'declared_mime_mismatch',
      detail: `declarado ${declared}, real ${mime}`,
    }
  }

  const dimensions = readImageDimensions(bytes, mime)
  if (dimensions === null) {
    if (input.allowUnreadableDimensions !== true) {
      return {
        ok: false,
        code: 'dimensions_unreadable',
        detail: `dimensoes ilegiveis para ${mime}`,
      }
    }
  } else {
    if (
      dimensions.width < limits.minDimension ||
      dimensions.height < limits.minDimension ||
      dimensions.width > limits.maxDimension ||
      dimensions.height > limits.maxDimension
    ) {
      return {
        ok: false,
        code: 'dimensions_out_of_range',
        detail: `${String(dimensions.width)}x${String(dimensions.height)}`,
      }
    }
    if (dimensions.width * dimensions.height > limits.maxPixels) {
      return {
        ok: false,
        code: 'too_many_pixels',
        detail: `${String(dimensions.width * dimensions.height)} pixels`,
      }
    }
  }

  return {
    ok: true,
    mime,
    extension: EXTENSION_BY_MIME[mime],
    byteSize: bytes.length,
    dimensions,
    contentHash: input.contentHash,
  }
}

/** Falha de validacao de bytes NUNCA e retentavel: o arquivo nao muda sozinho. */
export function isRetryableMediaRejection(): boolean {
  return false
}
