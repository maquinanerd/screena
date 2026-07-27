/**
 * Testes da deduplicacao. O foco NAO e "achou a duplicata": e provar que o
 * sistema NAO funde quando a evidencia e fraca — o erro caro e o falso
 * positivo, porque corrompe proveniencia de artigo publicado.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyIncomingItem,
  isUpdatedSourceItem,
  RELATED_WINDOW_HOURS,
  type ExistingItem,
  type IncomingItem,
} from '../dedup.js'

function incoming(overrides: Partial<IncomingItem> = {}): IncomingItem {
  return {
    sourceId: 's1',
    externalId: 'ext-1',
    normalizedUrl: 'https://collider.com/nota',
    contentFingerprint: 'a'.repeat(64),
    publishedAtIso: '2026-07-01T12:00:00.000Z',
    entityKeys: ['movie:10'],
    ...overrides,
  }
}

function existing(overrides: Partial<ExistingItem> = {}): ExistingItem {
  return {
    id: '100',
    sourceId: 's1',
    externalId: 'ext-1',
    normalizedUrl: 'https://collider.com/nota',
    contentFingerprint: 'a'.repeat(64),
    publishedAtIso: '2026-07-01T12:00:00.000Z',
    entityKeys: ['movie:10'],
    ...overrides,
  }
}

describe('sinais FORTES (fundem)', () => {
  it('mesma (fonte, id externo) -> duplicate', () => {
    const d = classifyIncomingItem(incoming(), [existing()])
    expect(d.verdict).toBe('duplicate')
    expect(d.signal).toBe('source_external_id')
    expect(d.duplicateOfId).toBe('100')
  })

  it('mesma URL normalizada em fonte diferente -> duplicate (mesmo recurso)', () => {
    const d = classifyIncomingItem(
      incoming({ sourceId: 's2', externalId: 'outro', contentFingerprint: 'b'.repeat(64) }),
      [existing()],
    )
    expect(d.verdict).toBe('duplicate')
    expect(d.signal).toBe('normalized_url')
  })

  it('mesmo fingerprint NA MESMA fonte -> duplicate (republicacao)', () => {
    const d = classifyIncomingItem(
      incoming({ externalId: 'ext-2', normalizedUrl: 'https://collider.com/outra' }),
      [existing()],
    )
    expect(d.verdict).toBe('duplicate')
    expect(d.signal).toBe('content_fingerprint')
  })
})

describe('fail-closed: evidencia fraca NUNCA funde', () => {
  it('mesmo fingerprint em fontes DIFERENTES nao funde (sindicacao = 2 proveniencias)', () => {
    const d = classifyIncomingItem(
      incoming({
        sourceId: 's2',
        externalId: 'ext-2',
        normalizedUrl: 'https://variety.com/outra',
        entityKeys: ['movie:999'],
      }),
      [existing()],
    )
    expect(d.verdict).not.toBe('duplicate')
    expect(d.duplicateOfId).toBeNull()
  })

  it('null NUNCA casa com null (ausencia nao e igualdade)', () => {
    const d = classifyIncomingItem(
      incoming({
        sourceId: 's2',
        externalId: 'ext-2',
        normalizedUrl: null,
        contentFingerprint: null,
        entityKeys: [],
      }),
      [existing({ normalizedUrl: null, contentFingerprint: null, entityKeys: [] })],
    )
    expect(d.verdict).toBe('unique')
    expect(d.duplicateOfId).toBeNull()
  })

  it('mesma entidade dentro da janela -> related, e related NAO aponta primario', () => {
    const d = classifyIncomingItem(
      incoming({
        sourceId: 's2',
        externalId: 'ext-2',
        normalizedUrl: 'https://variety.com/outra',
        contentFingerprint: 'b'.repeat(64),
        publishedAtIso: '2026-07-01T18:00:00.000Z',
      }),
      [existing()],
    )
    expect(d.verdict).toBe('related')
    expect(d.signal).toBe('entity_time_window')
    expect(d.duplicateOfId).toBeNull()
  })

  it('mesma entidade FORA da janela -> unique', () => {
    const far = new Date(
      Date.parse('2026-07-01T12:00:00.000Z') + (RELATED_WINDOW_HOURS + 1) * 3_600_000,
    ).toISOString()
    const d = classifyIncomingItem(
      incoming({
        sourceId: 's2',
        externalId: 'ext-2',
        normalizedUrl: 'https://variety.com/outra',
        contentFingerprint: 'b'.repeat(64),
        publishedAtIso: far,
      }),
      [existing()],
    )
    expect(d.verdict).toBe('unique')
  })

  it('manchete/entidade iguais sem identidade estavel nao viram duplicate', () => {
    // O erro classico: "mesma manchete = mesmo fato". Aqui os dois itens falam
    // do mesmo filme e tem titulo equivalente, mas sao recursos diferentes.
    const d = classifyIncomingItem(
      incoming({
        sourceId: 's2',
        externalId: 'ext-2',
        normalizedUrl: 'https://variety.com/outra',
        contentFingerprint: 'b'.repeat(64),
      }),
      [existing()],
    )
    expect(d.verdict).not.toBe('duplicate')
  })

  it('sem candidatos -> unique', () => {
    expect(classifyIncomingItem(incoming(), []).verdict).toBe('unique')
  })
})

describe('isUpdatedSourceItem', () => {
  it('fingerprint diferente = item atualizado na fonte', () => {
    expect(
      isUpdatedSourceItem({ contentFingerprint: 'a'.repeat(64) }, { contentFingerprint: 'b'.repeat(64) }),
    ).toBe(true)
  })

  it('fingerprint igual = sem mudanca (nao reescreve)', () => {
    expect(
      isUpdatedSourceItem({ contentFingerprint: 'a'.repeat(64) }, { contentFingerprint: 'a'.repeat(64) }),
    ).toBe(false)
  })

  it('fingerprint ausente nao afirma mudanca (fail-closed)', () => {
    expect(isUpdatedSourceItem({ contentFingerprint: null }, { contentFingerprint: 'a'.repeat(64) })).toBe(
      false,
    )
  })
})
