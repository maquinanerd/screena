/**
 * Testes da sanitizacao de payload (samples em disco nunca carregam segredo).
 *
 * Duas camadas: por CHAVE (nome sugere credencial) e por VALOR (string contem um
 * segredo conhecido). Ambas ativas. `maxArrayItems` corta arrays grandes. Modulo
 * puro: nunca muta a entrada.
 */

import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets, sanitizePayload } from '../sanitize.js'

/** Segredo obviamente falso, com 19 chars (>= 8, logo elegivel a redacao). */
const SECRET = 'test-key-0000000000'

describe('redactSecrets', () => {
  it('substitui TODAS as ocorrencias de um segredo >= 8 chars', () => {
    const input = `inicio ${SECRET} meio ${SECRET} fim`
    const output = redactSecrets(input, [SECRET])
    expect(output).toBe(`inicio ${REDACTED} meio ${REDACTED} fim`)
    expect(output).not.toContain(SECRET)
  })

  it('IGNORA segredos com menos de 8 chars (nao detona o sample)', () => {
    // 'abcde' (5 chars) e substring do conteudo legitimo — nao pode ser redigido.
    const output = redactSecrets('abcdefghij fica intacto', ['abcde'])
    expect(output).toBe('abcdefghij fica intacto')
    expect(output).not.toContain(REDACTED)
  })
})

describe('sanitizePayload — redacao por NOME de chave', () => {
  it('redige campos-credencial (case-insensitive) para [REDACTED]', () => {
    const input = {
      apiKey: 'v1',
      api_key: 'v2',
      secret: 'v3',
      token: 'v4',
      authorization: 'v5',
      password: 'v6',
      cookie: 'v7',
      'x-rapidapi-key': 'v8',
      // variantes de caixa: o padrao e case-insensitive.
      API_KEY: 'v9',
      Authorization: 'v10',
      SECRET: 'v11',
      // campo inocente permanece.
      title: 'Duna',
    }

    const output = sanitizePayload(input) as Record<string, unknown>

    for (const key of [
      'apiKey',
      'api_key',
      'secret',
      'token',
      'authorization',
      'password',
      'cookie',
      'x-rapidapi-key',
      'API_KEY',
      'Authorization',
      'SECRET',
    ]) {
      expect(output[key]).toBe(REDACTED)
    }
    expect(output.title).toBe('Duna')
  })
})

describe('sanitizePayload — redacao por VALOR (defesa em profundidade)', () => {
  it('redige um segredo que aparece dentro de um campo de nome inocente', () => {
    const input = { debug: `GET https://api.test/x?key=${SECRET}&lang=pt` }

    const output = sanitizePayload(input, { secrets: [SECRET] }) as Record<string, unknown>

    expect(typeof output.debug).toBe('string')
    const debug = output.debug as string
    expect(debug).not.toContain(SECRET)
    expect(debug).toContain(REDACTED)
    // o resto do valor sobrevive.
    expect(debug).toContain('lang=pt')
  })
})

describe('sanitizePayload — arrays e recursao', () => {
  it('trunca array em maxArrayItems e anexa marcador com o total omitido', () => {
    const input = { items: [1, 2, 3, 4, 5, 6, 7] }

    const output = sanitizePayload(input, { maxArrayItems: 3 }) as { items: unknown[] }

    expect(output.items).toHaveLength(4) // 3 mantidos + 1 marcador
    expect(output.items.slice(0, 3)).toEqual([1, 2, 3])
    const marker = output.items[3]
    // marcador = "<ellipsis>[+4 itens omitidos no sample]" (um char de prefixo + N).
    expect(typeof marker).toBe('string')
    expect(marker as string).toMatch(/^.\[\+4 itens omitidos no sample\]$/)
  })

  it('usa maxArrayItems default de 5 quando nao informado', () => {
    const output = sanitizePayload({ items: [0, 1, 2, 3, 4, 5] }) as { items: unknown[] }
    expect(output.items).toHaveLength(6) // 5 mantidos + 1 marcador
    expect(output.items[5] as string).toMatch(/^.\[\+1 itens omitidos no sample\]$/)
  })

  it('caminha objetos aninhados (dentro de arrays e de objetos)', () => {
    const input = {
      meta: { secret: 's', ok: 'mantem' },
      list: [{ token: 'x' }, { debug: `has ${SECRET} inside` }],
    }

    const output = sanitizePayload(input, { secrets: [SECRET] }) as {
      meta: Record<string, unknown>
      list: Array<Record<string, unknown>>
    }

    expect(output.meta.secret).toBe(REDACTED)
    expect(output.meta.ok).toBe('mantem')

    const first = output.list[0]
    const second = output.list[1]
    if (!first || !second) throw new Error('teste: itens aninhados ausentes')
    expect(first.token).toBe(REDACTED)
    expect(String(second.debug)).not.toContain(SECRET)
    expect(String(second.debug)).toContain(REDACTED)
  })
})

describe('sanitizePayload — imutabilidade', () => {
  it('NAO muta o objeto de entrada', () => {
    const input = {
      token: 'plain-value',
      nested: { password: 'p' },
      arr: [1, 2, 3, 4, 5, 6],
    }

    const output = sanitizePayload(input, { maxArrayItems: 2 }) as Record<string, unknown>

    // entrada intacta
    expect(input.token).toBe('plain-value')
    expect(input.nested.password).toBe('p')
    expect(input.arr).toHaveLength(6)

    // saida efetivamente sanitizada (prova que rodou de fato)
    expect(output.token).toBe(REDACTED)
    expect(output.arr).toHaveLength(3) // 2 + marcador
  })
})
