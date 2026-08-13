/**
 * args-and-gate.test.ts — Parser e gate da promocao de premiacao.
 *
 * Dois pontos que ja custaram rodada de producao neste repositorio:
 *  - o separador `--` chega LITERAL no pnpm 9.15.4 e tem de ser recusado como
 *    posicional (nao pode virar "flag desconhecida" silenciosa);
 *  - o gate e FAIL-CLOSED POR OMISSAO: um chamador que nao conheca o campo de
 *    autorizacao passa `undefined`, e `undefined` bloqueia igual a `false`.
 */

import { describe, expect, it } from 'vitest'

import { evaluateAwardsGate, parseAwardsArgs } from '../args.js'

describe('parser', () => {
  it('default: dry-run, sem filtro, sem teto', () => {
    expect(parseAwardsArgs([])).toEqual({
      ok: true,
      args: { apply: false, type: null, limit: null, report: false },
    })
  })

  it('aceita --flag=valor e --flag valor', () => {
    expect(parseAwardsArgs(['--type=movie', '--limit', '50', '--apply', '--report'])).toEqual({
      ok: true,
      args: { apply: true, type: 'movie', limit: 50, report: true },
    })
  })

  it('--dry-run e aceito explicitamente, sem efeito colateral', () => {
    const parsed = parseAwardsArgs(['--dry-run'])
    expect(parsed.ok && parsed.args.apply).toBe(false)
  })

  it('recusa o separador `--` (ele chega LITERAL no pnpm 9.15.4)', () => {
    const parsed = parseAwardsArgs(['--', '--apply'])
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.error).toContain('flag desconhecida')
  })

  it('recusa posicional solto, flag desconhecida e valor invalido', () => {
    expect(parseAwardsArgs(['movie']).ok).toBe(false)
    expect(parseAwardsArgs(['--forca']).ok).toBe(false)
    expect(parseAwardsArgs(['--type=filme']).ok).toBe(false)
    expect(parseAwardsArgs(['--limit=0']).ok).toBe(false)
    expect(parseAwardsArgs(['--limit=abc']).ok).toBe(false)
    expect(parseAwardsArgs(['--apply=1']).ok).toBe(false)
    expect(parseAwardsArgs(['--type']).ok).toBe(false)
  })
})

describe('gate fail-closed', () => {
  it('CONTROLE POSITIVO: com banco, fora de producao, libera', () => {
    expect(evaluateAwardsGate({ isProd: false, apply: true, hasDb: true })).toEqual({
      allowed: true,
      reason: null,
    })
  })

  it('sem DATABASE_URL bloqueia mesmo em dry-run (a leitura e do banco)', () => {
    expect(evaluateAwardsGate({ isProd: false, apply: false, hasDb: false })).toEqual({
      allowed: false,
      reason: 'no-database-url',
    })
  })

  it('producao + --apply sem autorizacao bloqueia — e por OMISSAO tambem', () => {
    // `undefined` (chamador que nao conhece o campo) bloqueia igual a `false`.
    expect(evaluateAwardsGate({ isProd: true, apply: true, hasDb: true })).toEqual({
      allowed: false,
      reason: 'production-unauthorized',
    })
    expect(
      evaluateAwardsGate({ isProd: true, apply: true, hasDb: true, promotionAuthorized: false }),
    ).toEqual({ allowed: false, reason: 'production-unauthorized' })
    expect(
      evaluateAwardsGate({ isProd: true, apply: true, hasDb: true, promotionAuthorized: true }),
    ).toEqual({ allowed: true, reason: null })
  })

  it('producao SEM --apply roda: dry-run nao escreve nada', () => {
    expect(evaluateAwardsGate({ isProd: true, apply: false, hasDb: true })).toEqual({
      allowed: true,
      reason: null,
    })
  })
})
