/**
 * Nucleo puro da despublicacao de emergencia: plano, idempotencia e o
 * detector de "sucesso" silencioso (updated divergente do plano).
 */

import { describe, expect, it } from 'vitest'

import {
  isUnpublishMode,
  planUnpublishTranslations,
  verifyDemotionCount,
  type UnpublishTranslationState,
} from '../unpublish.js'

function translation(
  overrides: Partial<UnpublishTranslationState> = {},
): UnpublishTranslationState {
  return {
    id: 1n,
    languageCode: 'pt-BR',
    reviewStatus: 'published',
    indexStatus: 'index',
    ...overrides,
  }
}

describe('planUnpublishTranslations', () => {
  it('traducao publicada e pendencia', () => {
    const plan = planUnpublishTranslations([translation()], 'archived')
    expect(plan.pending).toHaveLength(1)
    expect(plan.alreadyDone).toHaveLength(0)
  })

  it('ja rebaixada com noindex NAO e pendencia (idempotencia)', () => {
    const plan = planUnpublishTranslations(
      [translation({ reviewStatus: 'archived', indexStatus: 'noindex' })],
      'archived',
    )
    expect(plan.pending).toHaveLength(0)
    expect(plan.alreadyDone).toHaveLength(1)
  })

  it('review_status certo mas index_status errado AINDA e pendencia (sitemap le dele)', () => {
    const plan = planUnpublishTranslations(
      [translation({ reviewStatus: 'archived', indexStatus: 'index' })],
      'archived',
    )
    expect(plan.pending).toHaveLength(1)
  })

  it('modo blocked nao aceita archived como feito: retratacao e vocabulario distinto', () => {
    const plan = planUnpublishTranslations(
      [translation({ reviewStatus: 'archived', indexStatus: 'noindex' })],
      'blocked',
    )
    expect(plan.pending).toHaveLength(1)
  })

  it('mistura de idiomas: rebaixa so o que falta', () => {
    const plan = planUnpublishTranslations(
      [
        translation({ id: 1n, languageCode: 'pt-BR' }),
        translation({
          id: 2n,
          languageCode: 'en',
          reviewStatus: 'archived',
          indexStatus: 'noindex',
        }),
      ],
      'archived',
    )
    expect(plan.pending.map((t) => t.languageCode)).toEqual(['pt-BR'])
    expect(plan.alreadyDone.map((t) => t.languageCode)).toEqual(['en'])
  })
})

describe('verifyDemotionCount — o caminho de falha GRITA', () => {
  it('contagem igual ao plano: sem erro', () => {
    expect(verifyDemotionCount(2, 2)).toBeNull()
  })

  it('updated: 0 com pendencia planejada e ERRO, nunca sucesso', () => {
    const message = verifyDemotionCount(2, 0)
    expect(message).not.toBeNull()
    expect(message).toContain('esperava rebaixar 2')
  })

  it('update parcial tambem e ERRO', () => {
    expect(verifyDemotionCount(3, 2)).not.toBeNull()
  })
})

describe('isUnpublishMode', () => {
  it('aceita so archived|blocked', () => {
    expect(isUnpublishMode('archived')).toBe(true)
    expect(isUnpublishMode('blocked')).toBe(true)
    expect(isUnpublishMode('published')).toBe(false)
    expect(isUnpublishMode('deleted')).toBe(false)
  })
})
