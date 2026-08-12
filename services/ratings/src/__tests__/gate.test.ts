/**
 * gate.test.ts — Gate FAIL-CLOSED do worker de ratings.
 *
 * Precedencia (mais restritivo primeiro): provedor desligado -> producao sem
 * autorizacao -> chave -> banco -> liberado. Dry-run puro nunca toca rede nem
 * banco, entao passa sem chave/DB.
 *
 * A partir de 2026-08-11 o bloqueio em producao deixou de ser incondicional e
 * virou AUTORIZACAO EXPLICITA por provedor. Os testes abaixo provam as duas
 * pontas: sem autorizacao o comportamento e identico ao de antes; com
 * autorizacao, e so ela que muda.
 *
 * A partir de 2026-08-12 este provedor esta DESLIGADO por padrao (a API responde
 * 403 por falta de assinatura; o provedor ativo e a OMDb). Por isso os casos
 * abaixo que TOCAM A REDE passam `providerEnabled: true` explicitamente: eles
 * testam a precedencia a JUSANTE do desligamento, que continua valendo intacta
 * no dia em que a assinatura voltar. O desligamento em si e testado em
 * `omdb/__tests__/args-and-gate.test.ts`.
 */

import { describe, it, expect } from 'vitest'

import {
  evaluateRatingsGate,
  describeRatingsGateReason,
  needsNetwork,
  type RatingsGateReason,
} from '../film-show-ratings/gate.js'

const FAKE_SECRET = 'test-key-0000000000'

describe('evaluateRatingsGate', () => {
  it('producao SEM autorizacao bloqueia, mesmo em dry-run puro (checada primeiro)', () => {
    const result = evaluateRatingsGate({
      isProd: true,
      apply: false,
      sample: false,
      hasKey: false,
      hasDb: false,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('production-unauthorized')
  })

  it('producao SEM autorizacao vence mesmo com apply/sample/chave/db presentes', () => {
    const result = evaluateRatingsGate({
      isProd: true,
      apply: true,
      sample: true,
      hasKey: true,
      hasDb: true,
        providerEnabled: true,
      })
    expect(result.reason).toBe('production-unauthorized')
  })

  it('FAIL-CLOSED por OMISSAO: campo ausente nao e autorizacao', () => {
    // Um chamador antigo que nao conheca o campo passa `undefined`. Se o gate
    // usasse `!input.providerAuthorized === false` ou algo equivalente a
    // "nao explicitamente negado", a omissao viraria liberacao silenciosa.
    const omitido = evaluateRatingsGate({
      isProd: true,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: true,
        providerEnabled: true,
      })
    const explicitoFalse = evaluateRatingsGate({
      isProd: true,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: true,
      providerAuthorized: false,
        providerEnabled: true,
      })
    expect(omitido).toEqual(explicitoFalse)
    expect(omitido.reason).toBe('production-unauthorized')
  })

  it('producao COM autorizacao explicita libera (chave e banco presentes)', () => {
    const result = evaluateRatingsGate({
      isProd: true,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: true,
      providerAuthorized: true,
        providerEnabled: true,
      })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('autorizacao NAO dispensa chave nem banco', () => {
    // Autorizar o provedor e uma decisao de LICENCA. Ela nao substitui a
    // credencial nem a regra "todo sync externo gera log".
    expect(
      evaluateRatingsGate({
        isProd: true,
        apply: true,
        sample: false,
        hasKey: false,
        hasDb: true,
        providerAuthorized: true,
        providerEnabled: true,
      }).reason,
    ).toBe('no-api-key')

    expect(
      evaluateRatingsGate({
        isProd: true,
        apply: true,
        sample: false,
        hasKey: true,
        hasDb: false,
        providerAuthorized: true,
        providerEnabled: true,
      }).reason,
    ).toBe('no-database-url')
  })

  it('a autorizacao e IRRELEVANTE fora de producao (nao muda nada)', () => {
    const semAutorizacao = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: true,
        providerEnabled: true,
      })
    const comAutorizacao = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: true,
      providerAuthorized: true,
        providerEnabled: true,
      })
    expect(semAutorizacao).toEqual(comAutorizacao)
    expect(semAutorizacao.allowed).toBe(true)
  })

  it('sample=true sem chave -> no-api-key', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: true,
      hasKey: false,
      hasDb: false,
        providerEnabled: true,
      })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-api-key')
  })

  it('apply=true sem chave -> no-api-key', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: false,
      hasDb: true,
        providerEnabled: true,
      })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-api-key')
  })

  it('apply=true com chave porem sem banco -> no-database-url', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: true,
      sample: false,
      hasKey: true,
      hasDb: false,
        providerEnabled: true,
      })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-database-url')
  })

  // Regra "todo sync externo gera log": qualquer execucao que toca a rede grava
  // api_cache + api_sync_logs. Um --sample sem banco seria ingestao silenciosa.
  it('sample=true com chave porem sem banco -> no-database-url (sample tambem loga)', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: true,
      hasKey: true,
      hasDb: false,
        providerEnabled: true,
      })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('no-database-url')
  })

  it('dry-run puro (apply=false, sample=false) sem chave e sem DB -> LIBERADO', () => {
    const result = evaluateRatingsGate({
      isProd: false,
      apply: false,
      sample: false,
      hasKey: false,
      hasDb: false,
    })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })
})

describe('needsNetwork', () => {
  it('true quando apply, true quando sample, false caso contrario', () => {
    expect(needsNetwork({ apply: true, sample: false })).toBe(true)
    expect(needsNetwork({ apply: false, sample: true })).toBe(true)
    expect(needsNetwork({ apply: false, sample: false })).toBe(false)
  })
})

describe('describeRatingsGateReason', () => {
  const reasons: readonly RatingsGateReason[] = [
    'provider-disabled',
    'production-unauthorized',
    'no-api-key',
    'no-database-url',
  ]

  it('retorna string pt-BR nao-vazia para cada motivo e nunca vaza segredo', () => {
    for (const reason of reasons) {
      const message = describeRatingsGateReason(reason)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
      expect(message).toContain('Bloqueado')
      // A mensagem cita apenas o NOME da variavel/segredo, nunca um valor.
      expect(message).not.toContain(FAKE_SECRET)
    }
  })

  it('no-api-key cita o NOME da env var (nao o valor)', () => {
    const message = describeRatingsGateReason('no-api-key')
    expect(message).toContain('RAPIDAPI_FILM_SHOW_RATINGS_KEY')
  })

  it('no-database-url cita DATABASE_URL', () => {
    const message = describeRatingsGateReason('no-database-url')
    expect(message).toContain('DATABASE_URL')
  })

  it('production-unauthorized diz QUAL variavel destrava e ONDE a decisao esta registrada', () => {
    const message = describeRatingsGateReason('production-unauthorized')
    expect(message).toContain('CINERIE_RATINGS_PROVIDER_AUTHORIZED')
    expect(message).toContain('ratings-streaming-provider-authorization')
  })
})
