/**
 * Resposta invalida do `claim` deixa de virar fila vazia.
 *
 * O worker fazia `Array.isArray(result.events) ? result.events : []`. Qualquer
 * resposta que nao trouxesse uma lista — corpo de erro com 200, HTML de proxy,
 * campo renomeado — significava exatamente o mesmo que "nada a projetar". O
 * ciclo terminava "com sucesso", o `/readyz` continuava verde e a projecao
 * ficava parada sem nenhum sintoma.
 */

import { describe, expect, it } from 'vitest'

import { parseClaimResponse } from '../outbox-claim-response.js'

describe('leitura da resposta do claim', () => {
  it('CONTROLE POSITIVO: lista com eventos e aceita', () => {
    const parsed = parseClaimResponse({ workerId: 'w1', claimed: 2, events: [{ a: 1 }, { b: 2 }] })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.events).toHaveLength(2)
  })

  it('FILA VAZIA e uma lista vazia — e continua valida', () => {
    // A distincao inteira depende disto: `events: []` e uma resposta legitima e
    // frequente. Trata-la como falha poria o worker em backoff a cada ciclo
    // ocioso.
    const parsed = parseClaimResponse({ workerId: 'w1', claimed: 0, events: [] })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.events).toEqual([])
  })

  it('corpo SEM `events` e falha, nao fila vazia', () => {
    const parsed = parseClaimResponse({ workerId: 'w1', claimed: 0 })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.code).toBe('outbox_claim_malformed')
  })

  it('`events` que nao e lista e falha', () => {
    for (const events of [null, 'nenhum', 0, {}]) {
      const parsed = parseClaimResponse({ events })
      expect(parsed.ok).toBe(false)
    }
  })

  it('corpo que nem e objeto e falha', () => {
    for (const raw of [null, undefined, 'texto', 42, ['a']]) {
      const parsed = parseClaimResponse(raw)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.code).toBe('outbox_claim_malformed')
    }
  })

  it('corpo de ERRO com status 2xx e falha', () => {
    // A forma mais enganosa: `response.ok` do fetch nao pega nada, e sem esta
    // checagem o erro viraria fila vazia.
    const parsed = parseClaimResponse({ error: 'claim_all_attempts_failed', events: undefined })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.code).toBe('outbox_claim_error_body')
      expect(parsed.detail).toContain('claim_all_attempts_failed')
    }
  })

  it('contagem que NAO bate com a lista e falha', () => {
    // Dois campos preenchidos pelo mesmo servidor. Divergirem significa que a
    // resposta foi montada por outra coisa no caminho.
    const parsed = parseClaimResponse({ claimed: 5, events: [{ a: 1 }] })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.code).toBe('outbox_claim_inconsistent')
      expect(parsed.detail).toContain('5')
      expect(parsed.detail).toContain('1')
    }
  })

  it('DEFEITO REGISTRADO: o atalho antigo transformava tudo isto em fila vazia', () => {
    // O atalho, verbatim, como estava em `bin/project-editorial.ts`:
    const atalhoAntigo = (result: { events?: unknown }): unknown[] =>
      Array.isArray(result.events) ? result.events : []

    const respostasQuebradas = [
      { error: 'claim_all_attempts_failed' },
      { claimed: 0 },
      { events: null },
      { events: 'nenhum' },
    ]

    for (const resposta of respostasQuebradas) {
      // O atalho dizia "nada a projetar" para TODAS elas...
      expect(atalhoAntigo(resposta)).toEqual([])
      // ...e e exatamente isso que deixou de acontecer.
      expect(parseClaimResponse(resposta).ok).toBe(false)
    }
  })

  it('sem `claimed` no corpo, a lista basta', () => {
    // O campo e uma verificacao gratuita, nao um requisito: uma versao anterior
    // do CMS que nao o emita continua funcionando.
    const parsed = parseClaimResponse({ events: [{ a: 1 }] })
    expect(parsed.ok).toBe(true)
  })
})
