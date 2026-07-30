/**
 * media-validation.test.ts — A porta de seguranca da midia editorial.
 *
 * Todos os casos constroem BYTES REAIS (cabecalho valido), nao strings com nome
 * de arquivo. Testar `validate('foto.svg')` provaria apenas que sabemos ler
 * extensao — e extensao e exatamente o que este modulo se recusa a considerar.
 */

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  detectDangerousFormat,
  readImageDimensions,
  sniffImageMime,
  validateImageBytes,
  DEFAULT_MEDIA_LIMITS,
  EXTENSION_BY_MIME,
} from '../media/media-validation.js'

function hashOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/** JPEG minimo com SOF0 declarando dimensoes. */
function jpeg(width: number, height: number): Uint8Array {
  const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
  bytes.push(...Array.from('JFIF\0', (char) => char.charCodeAt(0)))
  bytes.push(0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08)
  bytes.push((height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff)
  bytes.push(0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01)
  bytes.push(0xff, 0xd9)
  return new Uint8Array(bytes)
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function webpLossless(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(40)
  bytes.set(Array.from('RIFF', (c) => c.charCodeAt(0)), 0)
  bytes.set(Array.from('WEBP', (c) => c.charCodeAt(0)), 8)
  bytes.set(Array.from('VP8L', (c) => c.charCodeAt(0)), 12)
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  bytes[21] = bits & 0xff
  bytes[22] = (bits >> 8) & 0xff
  bytes[23] = (bits >> 16) & 0xff
  bytes[24] = (bits >> 24) & 0xff
  return bytes
}

function bytesOf(text: string): Uint8Array {
  return new Uint8Array(Array.from(text, (char) => char.charCodeAt(0)))
}

function validate(bytes: Uint8Array, overrides: Record<string, unknown> = {}) {
  return validateImageBytes({ bytes, contentHash: hashOf(bytes), ...overrides })
}

describe('deteccao por assinatura', () => {
  it('reconhece os formatos permitidos pelos BYTES', () => {
    expect(sniffImageMime(jpeg(10, 10))).toBe('image/jpeg')
    expect(sniffImageMime(png(10, 10))).toBe('image/png')
    expect(sniffImageMime(webpLossless(10, 10))).toBe('image/webp')
  })

  it('nao reconhece formato de imagem PROIBIDO — reconhecer nao e permitir', () => {
    expect(sniffImageMime(bytesOf('GIF89a....'))).toBeNull()
    expect(sniffImageMime(bytesOf('BM......'))).toBeNull()
  })

  it('classifica formatos perigosos com motivo preciso', () => {
    // "SVG recusado" ensina; "formato desconhecido" faz o editor tentar de novo
    // com o mesmo arquivo.
    expect(detectDangerousFormat(bytesOf('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('svg_or_xml')
    expect(detectDangerousFormat(bytesOf('  <?xml version="1.0"?>'))).toBe('svg_or_xml')
    expect(detectDangerousFormat(bytesOf('<!DOCTYPE html><html>'))).toBe('html')
    expect(detectDangerousFormat(bytesOf('%PDF-1.7'))).toBe('pdf')
    expect(detectDangerousFormat(new Uint8Array([0x4d, 0x5a, 0x90]))).toBe('executable')
    expect(detectDangerousFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('archive')
    // Controle positivo: imagem legitima nao e "perigosa".
    expect(detectDangerousFormat(png(10, 10))).toBeNull()
  })
})

describe('leitura de dimensoes', () => {
  it('le do cabecalho de JPEG, PNG e WebP', () => {
    expect(readImageDimensions(jpeg(1200, 630), 'image/jpeg')).toEqual({ width: 1200, height: 630 })
    expect(readImageDimensions(png(800, 600), 'image/png')).toEqual({ width: 800, height: 600 })
    expect(readImageDimensions(webpLossless(320, 240), 'image/webp')).toEqual({
      width: 320,
      height: 240,
    })
  })
})

describe('veredito de validacao', () => {
  it('aceita imagem legitima e deriva a extensao do MIME REAL', () => {
    const result = validate(jpeg(1200, 630))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mime).toBe('image/jpeg')
    // A extensao vem de uma tabela fechada, nunca do nome do upload.
    expect(result.extension).toBe(EXTENSION_BY_MIME['image/jpeg'])
    expect(result.dimensions).toEqual({ width: 1200, height: 630 })
  })

  it('recusa SVG mesmo com MIME de imagem declarado', () => {
    // O caso classico: o painel aceita `image/svg+xml`, e o SVG e um documento
    // com script sendo servido do nosso dominio.
    const result = validate(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), {
      declaredMime: 'image/png',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('dangerous_format')
    expect(result.detail).toBe('svg_or_xml')
  })

  it('recusa MIME declarado que NAO bate com os bytes', () => {
    const result = validate(png(10, 10), { declaredMime: 'image/jpeg' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('declared_mime_mismatch')
  })

  it('recusa hash divergente ANTES de qualquer analise de formato', () => {
    // Bytes trocados no caminho nao merecem nem ser analisados.
    const result = validate(jpeg(10, 10), { expectedContentHash: `sha256:${'b'.repeat(64)}` })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('content_hash_mismatch')
  })

  it('recusa arquivo acima do limite de bytes', () => {
    const big = new Uint8Array(DEFAULT_MEDIA_LIMITS.maxBytes + 1)
    big.set([0xff, 0xd8, 0xff], 0)
    const result = validate(big)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('too_large')
  })

  it('recusa BOMBA DE PIXELS — o limite e de pixels, nao de bytes', () => {
    // 30.000 x 30.000 cabe em poucos bytes comprimido e estoura a memoria de
    // qualquer decodificador. Sem este gate, o limite de bytes nao protegeria.
    const result = validate(png(30_000, 30_000))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(['too_many_pixels', 'dimensions_out_of_range']).toContain(result.code)
  })

  it('recusa imagem minuscula demais para ser conteudo', () => {
    const result = validate(png(1, 1))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('dimensions_out_of_range')
  })

  it('recusa arquivo vazio', () => {
    const result = validate(new Uint8Array())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('empty_file')
  })

  it('formato sem dimensoes legiveis e FAIL-CLOSED por padrao', () => {
    // AVIF: as dimensoes vivem numa caixa de deslocamento variavel. Um parser
    // que "acerta as vezes" deixaria passar uma imagem gigante quando errasse.
    const avif = new Uint8Array(32)
    avif.set(Array.from('ftypavif', (c) => c.charCodeAt(0)), 4)
    const blocked = validate(avif)
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.code).toBe('dimensions_unreadable')

    // E so passa com opt-in EXPLICITO, que e abrir mao do gate de pixels
    // conscientemente.
    const allowed = validate(avif, { allowUnreadableDimensions: true })
    expect(allowed.ok).toBe(true)
  })

  it('recusa qualquer coisa que nao seja imagem reconhecida', () => {
    const result = validate(bytesOf('GIF89a'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unsupported_format')
  })
})
