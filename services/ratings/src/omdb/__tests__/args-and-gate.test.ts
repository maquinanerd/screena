/**
 * args-and-gate.test.ts — Parser de argumentos e gate fail-closed do worker OMDb,
 * mais o DESLIGAMENTO do provedor anterior (T4).
 */

import { describe, expect, it } from 'vitest'

import {
  describeRatingsGateReason,
  evaluateRatingsGate,
} from '../../film-show-ratings/gate.js'
import { parseOmdbArgs } from '../args.js'
import { describeOmdbGateReason, evaluateOmdbGate } from '../gate.js'

describe('parseOmdbArgs', () => {
  it('dry-run e o default: sem flags, nada apply/sample', () => {
    const parsed = parseOmdbArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.args).toEqual({
      apply: false,
      sample: false,
      type: null,
      id: null,
      limit: null,
      report: null,
      ignoreFreshness: false,
    })
  })

  it('aceita --flag=valor e --flag valor', () => {
    const a = parseOmdbArgs(['--type=movie', '--limit=5'])
    const b = parseOmdbArgs(['--type', 'movie', '--limit', '5'])
    expect(a.ok && a.args.type).toBe('movie')
    expect(b.ok && b.args.type).toBe('movie')
    expect(a.ok && a.args.limit).toBe(5)
    expect(b.ok && b.args.limit).toBe(5)
  })

  it('usa o vocabulario do BANCO (movie/tv), nao o do provedor antigo', () => {
    expect(parseOmdbArgs(['--type=movie']).ok).toBe(true)
    expect(parseOmdbArgs(['--type=tv']).ok).toBe(true)
    const rejected = parseOmdbArgs(['--type=film'])
    expect(rejected.ok).toBe(false)
    if (rejected.ok) return
    expect(rejected.error).toContain('movie')
  })

  it('--apply exige --type (atribuir nota a entidade errada e pior que nao gravar)', () => {
    const parsed = parseOmdbArgs(['--apply'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('--apply exige --type')
  })

  it('--sample sem --id exige --type', () => {
    const parsed = parseOmdbArgs(['--sample'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('--type')
  })

  it('--sample --id dispensa --type', () => {
    expect(parseOmdbArgs(['--sample', '--id=tt3896198']).ok).toBe(true)
  })

  it('--id exige a forma tt<digitos>', () => {
    expect(parseOmdbArgs(['--id=tt3896198', '--sample']).ok).toBe(true)
    const bad = parseOmdbArgs(['--id=3896198', '--sample'])
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error).toContain('tt<digitos>')
  })

  it('FAIL-LOUD: flag desconhecida e erro, nunca ignorada', () => {
    const parsed = parseOmdbArgs(['--forca'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('flag desconhecida')
  })

  it('FAIL-LOUD: flag de valor sem valor e erro', () => {
    const parsed = parseOmdbArgs(['--type'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('exige um valor')
  })

  it('FAIL-LOUD: --limit nao inteiro positivo e erro', () => {
    for (const bogus of ['0', '-1', '2.5', 'abc']) {
      const parsed = parseOmdbArgs([`--limit=${bogus}`])
      expect(parsed.ok, bogus).toBe(false)
    }
  })

  it('FAIL-LOUD: flag booleana com valor e erro', () => {
    const parsed = parseOmdbArgs(['--apply=true'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('booleana')
  })

  it('--ignore-freshness com --id e erro (o id explicito ja ignora frescor)', () => {
    const parsed = parseOmdbArgs(['--sample', '--id=tt3896198', '--ignore-freshness'])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('--ignore-freshness')
  })
})

const BASE_GATE = { isProd: false, apply: false, sample: false, hasKey: true, hasDb: true }

describe('gate do worker OMDb', () => {
  it('dry-run puro passa sem chave e sem banco', () => {
    const result = evaluateOmdbGate({ ...BASE_GATE, hasKey: false, hasDb: false })
    expect(result.allowed).toBe(true)
  })

  it('--sample sem chave e bloqueado', () => {
    const result = evaluateOmdbGate({ ...BASE_GATE, sample: true, hasKey: false })
    expect(result).toEqual({ allowed: false, reason: 'no-api-key' })
  })

  it('--sample sem DATABASE_URL e bloqueado (todo sync gera log)', () => {
    const result = evaluateOmdbGate({ ...BASE_GATE, sample: true, hasDb: false })
    expect(result).toEqual({ allowed: false, reason: 'no-database-url' })
  })

  it('producao SEM autorizacao explicita e bloqueada, mesmo com tudo pronto', () => {
    const result = evaluateOmdbGate({ ...BASE_GATE, isProd: true, apply: true })
    expect(result).toEqual({ allowed: false, reason: 'production-unauthorized' })
  })

  it('producao COM autorizacao explicita passa', () => {
    const result = evaluateOmdbGate({
      ...BASE_GATE,
      isProd: true,
      apply: true,
      providerAuthorized: true,
    })
    expect(result.allowed).toBe(true)
  })

  it('FAIL-CLOSED por omissao: chamador que nao passa o campo continua bloqueado', () => {
    // `undefined` nao e `true`. Um chamador antigo nao ganha autorizacao de graca.
    const result = evaluateOmdbGate({ ...BASE_GATE, isProd: true, apply: true })
    expect(result.allowed).toBe(false)
  })

  it('nenhuma mensagem de bloqueio cita valor de segredo', () => {
    for (const reason of ['production-unauthorized', 'no-api-key', 'no-database-url'] as const) {
      const message = describeOmdbGateReason(reason)
      expect(message.length).toBeGreaterThan(0)
      // Cita o NOME da variavel, nunca um valor.
      expect(message).not.toMatch(/=[A-Za-z0-9]{8,}/)
    }
  })
})

describe('T4 — o provedor anterior esta DESLIGADO por configuracao', () => {
  const OLD_BASE = {
    isProd: false,
    apply: false,
    sample: false,
    hasKey: true,
    hasDb: true,
    providerAuthorized: true,
  }

  it('--apply e bloqueado quando a flag nao esta ligada', () => {
    const result = evaluateRatingsGate({ ...OLD_BASE, apply: true })
    expect(result).toEqual({ allowed: false, reason: 'provider-disabled' })
  })

  it('--sample tambem e bloqueado', () => {
    const result = evaluateRatingsGate({ ...OLD_BASE, sample: true })
    expect(result).toEqual({ allowed: false, reason: 'provider-disabled' })
  })

  it('DESLIGADO por omissao: nenhum chamador antigo ganha rede de graca', () => {
    // O campo e opcional; ausente significa desligado. E isso que faz o
    // desligamento valer sem editar todo chamador.
    const result = evaluateRatingsGate({ isProd: false, apply: true, sample: false, hasKey: true, hasDb: true })
    expect(result.reason).toBe('provider-disabled')
  })

  it('dry-run puro continua liberado (relatar o plano nao gasta cota)', () => {
    const result = evaluateRatingsGate({ ...OLD_BASE })
    expect(result.allowed).toBe(true)
  })

  it('com a flag ligada, o gate volta a ser exatamente o de antes', () => {
    expect(evaluateRatingsGate({ ...OLD_BASE, apply: true, providerEnabled: true }).allowed).toBe(
      true,
    )
    expect(
      evaluateRatingsGate({ ...OLD_BASE, apply: true, providerEnabled: true, hasKey: false }),
    ).toEqual({ allowed: false, reason: 'no-api-key' })
    expect(
      evaluateRatingsGate({
        ...OLD_BASE,
        apply: true,
        providerEnabled: true,
        isProd: true,
        providerAuthorized: false,
      }),
    ).toEqual({ allowed: false, reason: 'production-unauthorized' })
  })

  it('a mensagem diz POR QUE esta desligado e O QUE reativa-lo exige', () => {
    const message = describeRatingsGateReason('provider-disabled')
    expect(message).toContain('403')
    expect(message).toContain('assinatura')
    expect(message).toContain('OMDb')
    expect(message).toContain('CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true')
    expect(message).toContain('ratings-provider-runbook.md')
  })
})
