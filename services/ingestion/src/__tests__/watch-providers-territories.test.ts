/**
 * watch-providers-territories.test.ts — Escopo territorial da ingestao de
 * `watch/providers`.
 *
 * O que este arquivo trava e o incidente de 2026-08-13: o payload real traz 138
 * paises, `watch_availability.country_code` e FK para `countries.code` (13
 * codigos semeados), e o reprocessamento gravava tudo — `23503` em 100 de 100
 * titulos. A cura e escopo declarado + descarte CONTADO, nunca FK afrouxada.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_WATCH_TERRITORIES,
  parseWatchTerritories,
} from '../watch-providers/territories.js'

describe('parseWatchTerritories', () => {
  it('CONTROLE POSITIVO: sem flag, ingere o territorio do render (BR)', () => {
    const parsed = parseWatchTerritories(null)
    expect(parsed.ok).toBe(true)
    expect(parsed.territories).toEqual(['BR'])
    expect(DEFAULT_WATCH_TERRITORIES).toEqual(['BR'])
  })

  it('CONTROLE POSITIVO: lista valida normaliza para MAIUSCULO e deduplica', () => {
    const parsed = parseWatchTerritories('br, us ,BR,pt')
    expect(parsed.ok).toBe(true)
    expect(parsed.territories).toEqual(['BR', 'US', 'PT'])
    expect(parsed.errors).toEqual([])
  })

  it('codigo fora de ISO 3166-1 alpha-2 e recusado com o valor NOMEADO', () => {
    const parsed = parseWatchTerritories('BR,BRA,X')
    expect(parsed.ok).toBe(false)
    expect(parsed.errors.join(' ')).toContain('"BRA"')
    expect(parsed.errors.join(' ')).toContain('"X"')
    // O valido nao e descartado junto: o operador ve exatamente o que sobrou.
    expect(parsed.territories).toEqual(['BR'])
  })

  it('lista vazia e ERRO, nao no-op silencioso', () => {
    const parsed = parseWatchTerritories('   , ,')
    expect(parsed.ok).toBe(false)
    expect(parsed.territories).toEqual([])
    expect(parsed.errors.join(' ')).toContain('zero territorio')
  })
})
