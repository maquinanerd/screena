/**
 * Testes da identidade de item: normalizacao de URL, fingerprints e dominio.
 *
 * Estes testes protegem a BASE da deduplicacao. Se a normalizacao deixar de ser
 * estavel, o mesmo artigo recebido por dois canais vira dois itens.
 */

import { describe, expect, it } from 'vitest'

import {
  contentFingerprint,
  foldForFingerprint,
  normalizeArticleUrl,
  normalizeSourceDomain,
  payloadFingerprint,
  sha256Hex,
  stableStringify,
} from '../identity.js'

describe('normalizeArticleUrl', () => {
  it('remove parametros de rastreamento, mantendo os significativos', () => {
    expect(
      normalizeArticleUrl('https://collider.com/nota?utm_source=rss&utm_medium=feed&page=2'),
    ).toBe('https://collider.com/nota?page=2')
    expect(normalizeArticleUrl('https://collider.com/nota?fbclid=abc&gclid=def')).toBe(
      'https://collider.com/nota',
    )
  })

  it('produz a MESMA chave para o mesmo artigo vindo por canais diferentes', () => {
    const rss = normalizeArticleUrl('https://www.Collider.com/nota/?utm_source=rss')
    const twitter = normalizeArticleUrl('https://collider.com/nota#comentarios')
    expect(rss).toBe(twitter)
  })

  it('ordena os parametros restantes (mesma pagina, mesma chave)', () => {
    expect(normalizeArticleUrl('https://x.com/a?b=2&a=1')).toBe(
      normalizeArticleUrl('https://x.com/a?a=1&b=2'),
    )
  })

  it('normaliza host, porta default e barra final', () => {
    expect(normalizeArticleUrl('HTTPS://WWW.Example.COM:443/post/')).toBe(
      'https://example.com/post',
    )
    expect(normalizeArticleUrl('http://example.com:80/')).toBe('http://example.com/')
  })

  it('recusa esquema nao-http e lixo (barreira de seguranca, nao higiene)', () => {
    expect(normalizeArticleUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeArticleUrl('data:text/html,<script>x</script>')).toBeNull()
    expect(normalizeArticleUrl('ftp://example.com/a')).toBeNull()
    expect(normalizeArticleUrl('nao-e-url')).toBeNull()
    expect(normalizeArticleUrl('')).toBeNull()
    expect(normalizeArticleUrl(null)).toBeNull()
  })

  it('e idempotente', () => {
    const once = normalizeArticleUrl('https://www.example.com/a/?utm_source=x#y')
    expect(normalizeArticleUrl(once)).toBe(once)
  })
})

describe('fingerprints', () => {
  it('sha256Hex produz 64 chars hex minusculos (formato do CHECK do banco)', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('dobra tipografica: mesmo conteudo com acento/pontuacao diferente casa', () => {
    expect(foldForFingerprint('Trailer de "Duna"  —  parte 2')).toBe(
      foldForFingerprint('Trailer de Duna - Parte 2'),
    )
    expect(contentFingerprint('Trailer de "Duna" — parte 2')).toBe(
      contentFingerprint('Trailer de Duna - Parte 2'),
    )
  })

  it('titulos diferentes produzem fingerprints diferentes', () => {
    expect(contentFingerprint('Trailer de Duna')).not.toBe(contentFingerprint('Trailer de Alien'))
  })

  it('sem texto util -> null (ausencia nunca e evidencia de igualdade)', () => {
    expect(contentFingerprint(null)).toBeNull()
    expect(contentFingerprint('   ', '  ')).toBeNull()
  })

  it('payloadFingerprint independe da ORDEM das chaves', () => {
    expect(payloadFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      payloadFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
    )
  })

  it('payloadFingerprint muda quando o valor muda', () => {
    expect(payloadFingerprint({ a: 1 })).not.toBe(payloadFingerprint({ a: 2 }))
    expect(payloadFingerprint(undefined)).toBeNull()
  })

  it('stableStringify ordena chaves recursivamente', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})

describe('normalizeSourceDomain', () => {
  it('extrai host canonico no formato exigido pelo CHECK', () => {
    expect(normalizeSourceDomain('https://www.Collider.com/feed')).toBe('collider.com')
    expect(normalizeSourceDomain('Collider.com')).toBe('collider.com')
    expect(normalizeSourceDomain('  https://news.example.co.uk/  ')).toBe('news.example.co.uk')
  })

  it('recusa entrada invalida', () => {
    expect(normalizeSourceDomain('javascript:alert(1)')).toBeNull()
    expect(normalizeSourceDomain('')).toBeNull()
    expect(normalizeSourceDomain(null)).toBeNull()
  })
})
