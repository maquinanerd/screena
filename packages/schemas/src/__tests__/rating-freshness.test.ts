/**
 * rating-freshness.test.ts — Fronteiras da politica de frescor.
 *
 * O relogio e sempre injetado, entao cada fronteira e provada por igualdade
 * exata em vez de aproximacao — inclusive o instante EXATO da virada, que e
 * onde um `>` no lugar de `>=` passaria despercebido para sempre.
 */

import { describe, expect, it } from 'vitest'

import { RATING_STALE_POLICY } from '@screena/config'

import {
  computeRatingStaleAfter,
  evaluateRatingFreshness,
  resolveRatingStalePolicy,
} from '../rating-freshness.js'

const HOUR = 60 * 60 * 1000
const FETCHED = new Date('2026-07-01T00:00:00.000Z')
const at = (hoursAfterFetch: number): Date => new Date(FETCHED.getTime() + hoursAfterFetch * HOUR)

describe('politica de frescor — resolucao por fonte', () => {
  it('imdb e rotten_tomatoes compartilham a janela de 7d/30d', () => {
    expect(resolveRatingStalePolicy('imdb')).toEqual({ refreshAfterHours: 168, expireAfterHours: 720 })
    expect(resolveRatingStalePolicy('rotten_tomatoes')).toEqual({
      refreshAfterHours: 168,
      expireAfterHours: 720,
    })
  })

  it('metacritic tem janela mais longa (14d/60d)', () => {
    expect(resolveRatingStalePolicy('metacritic')).toEqual({
      refreshAfterHours: 336,
      expireAfterHours: 1440,
    })
  })

  it('fonte SEM politica declarada resolve null (nao inventamos janela)', () => {
    expect(resolveRatingStalePolicy('letterboxd')).toBeNull()
    expect(resolveRatingStalePolicy('filmaffinity')).toBeNull()
    expect(resolveRatingStalePolicy('nao_existe')).toBeNull()
  })

  it('refresh sempre vem antes de expirar (politica coerente)', () => {
    for (const [source, policy] of Object.entries(RATING_STALE_POLICY)) {
      expect(policy.refreshAfterHours, source).toBeLessThan(policy.expireAfterHours)
    }
  })
})

describe('politica de frescor — stale_after', () => {
  it('stale_after = coleta + refreshAfterHours', () => {
    expect(computeRatingStaleAfter('imdb', FETCHED)).toEqual(at(168))
  })

  it('sem coleta ou sem politica, nao ha carimbo (null, nunca um chute)', () => {
    expect(computeRatingStaleAfter('imdb', null)).toBeNull()
    expect(computeRatingStaleAfter('letterboxd', FETCHED)).toBeNull()
  })
})

describe('politica de frescor — estados e exibibilidade', () => {
  it('dentro da janela de refresh: fresh e exibivel', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now: at(1) })
    expect(r.state).toBe('fresh')
    expect(r.displayable).toBe(true)
  })

  it('EXATAMENTE no refresh: ja e needs_refresh (fronteira inclusiva)', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now: at(168) })
    expect(r.state).toBe('needs_refresh')
  })

  it('needs_refresh CONTINUA exibivel — "vale reconferir" nao e "invalido"', () => {
    // Se um atraso de worker tirasse notas boas do ar, um incidente de
    // infraestrutura viraria um incidente de produto.
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now: at(400) })
    expect(r.state).toBe('needs_refresh')
    expect(r.displayable).toBe(true)
  })

  it('EXATAMENTE no expire: ja expirou e NAO e exibivel (fronteira inclusiva)', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now: at(720) })
    expect(r.state).toBe('expired')
    expect(r.displayable).toBe(false)
  })

  it('um instante antes de expirar ainda exibe (a fronteira e so ali)', () => {
    const r = evaluateRatingFreshness({
      ratingSource: 'imdb',
      fetchedAt: FETCHED,
      now: new Date(at(720).getTime() - 1),
    })
    expect(r.state).toBe('needs_refresh')
    expect(r.displayable).toBe(true)
  })

  it('fonte sem politica NUNCA exibe, por mais nova que a nota seja', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'letterboxd', fetchedAt: at(0), now: at(0) })
    expect(r.state).toBe('unknown-policy')
    expect(r.displayable).toBe(false)
  })

  it('sem fetchedAt NUNCA exibe (sem saber quando coletamos, nao ha frescor a afirmar)', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: null, now: at(0) })
    expect(r.state).toBe('unknown-fetch')
    expect(r.displayable).toBe(false)
  })

  it('coleta no FUTURO e tratada como desconhecida, nao como fresquissima', () => {
    // Relogio torto do upstream ou bug de parse. Idade negativa e sinal de dado
    // errado — e dado errado nao vira nota exibida.
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: at(10), now: at(0) })
    expect(r.state).toBe('unknown-fetch')
    expect(r.displayable).toBe(false)
  })

  it('metacritic ainda exibe onde o imdb ja expirou (janelas sao por fonte)', () => {
    const now = at(800)
    expect(evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now }).displayable).toBe(false)
    expect(
      evaluateRatingFreshness({ ratingSource: 'metacritic', fetchedAt: FETCHED, now }).displayable,
    ).toBe(true)
  })

  it('reporta as datas derivadas para diagnostico', () => {
    const r = evaluateRatingFreshness({ ratingSource: 'imdb', fetchedAt: FETCHED, now: at(1) })
    expect(r.refreshDueAt).toEqual(at(168))
    expect(r.expiresAt).toEqual(at(720))
    expect(r.ageHours).toBe(1)
  })
})
