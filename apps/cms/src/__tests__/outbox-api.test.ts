/**
 * outbox-api.test.ts — Politica de claim/lease/retry da outbox, sem servidor.
 *
 * Todos os testes fixam o tempo por INJECAO. Nenhum depende do relogio real, e
 * por isso nenhum fica intermitente as 23h59.
 */

import { describe, expect, it } from 'vitest'

import {
  backoffDelayMs,
  buildClaimMutation,
  clampBatchSize,
  decideFailOutcome,
  evaluateClaimEligibility,
  hasScope,
  sanitizeErrorMessage,
  validateLease,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_POLICY,
  MAX_BATCH_SIZE,
  SERVICE_ACCOUNT_SCOPES,
} from '../outbox-api.js'
import {
  evaluateBuildFreshness,
  serializeSourceStamps,
  skipBuildAllowed,
} from '../build-fingerprint.js'

const NOW = '2026-07-28T12:00:00.000Z'

function row(overrides: Partial<Parameters<typeof evaluateClaimEligibility>[0]> = {}) {
  return {
    status: 'pending',
    availableAtIso: null,
    leaseExpiresAtIso: null,
    attempts: 0,
    ...overrides,
  }
}

describe('escopos de service account', () => {
  it('reconhece apenas os escopos declarados', () => {
    expect(SERVICE_ACCOUNT_SCOPES).toEqual([
      'draft_ingest',
      'publication_projection',
      'editorial_auto_publish',
      'editorial_media_ingest',
    ])
    // `editorial_auto_publish` (FASE 2F) e disjunto dos outros dois: quem pede
    // publicacao nao drena a fila, e quem drena a fila nao publica.
    expect(hasScope(['editorial_auto_publish'], 'publication_projection')).toBe(false)
    expect(hasScope(['publication_projection'], 'editorial_auto_publish')).toBe(false)
    // `editorial_media_ingest` e separado de `draft_ingest` porque a foto e o
    // unico dado que atravessa a fronteira como BYTES e que, uma vez no acervo,
    // e servido publicamente. Quem so escreve texto nao ganha essa capacidade.
    expect(hasScope(['draft_ingest'], 'editorial_media_ingest')).toBe(false)
    expect(hasScope(['editorial_media_ingest'], 'draft_ingest')).toBe(false)
    expect(hasScope(['editorial_media_ingest'], 'publication_projection')).toBe(false)
    expect(hasScope(['draft_ingest'], 'draft_ingest')).toBe(true)
    expect(hasScope(['draft_ingest'], 'publication_projection')).toBe(false)
  })

  it('trata entrada malformada como AUSENCIA de escopo', () => {
    // Um `scopes` corrompido no banco nao pode virar permissao.
    expect(hasScope(null, 'draft_ingest')).toBe(false)
    expect(hasScope('draft_ingest', 'draft_ingest')).toBe(false)
    expect(hasScope({ draft_ingest: true }, 'draft_ingest')).toBe(false)
    expect(hasScope([], 'draft_ingest')).toBe(false)
  })
})

describe('clampBatchSize', () => {
  it('limita o lote e rejeita lixo', () => {
    expect(clampBatchSize(5)).toBe(5)
    expect(clampBatchSize(10_000)).toBe(MAX_BATCH_SIZE)
    expect(clampBatchSize(0)).toBe(10)
    expect(clampBatchSize(-3)).toBe(10)
    expect(clampBatchSize('20')).toBe(10)
    expect(clampBatchSize(Number.NaN)).toBe(10)
  })
})

describe('elegibilidade de claim', () => {
  it('reclama evento pendente disponivel', () => {
    expect(evaluateClaimEligibility(row(), NOW)).toEqual({ claimable: true, kind: 'fresh' })
  })

  it('NAO reclama evento ja processado nem dead-letter', () => {
    expect(evaluateClaimEligibility(row({ status: 'processed' }), NOW)).toEqual({
      claimable: false,
      reason: 'already_processed',
    })
    expect(evaluateClaimEligibility(row({ status: 'dead_letter' }), NOW)).toEqual({
      claimable: false,
      reason: 'dead_letter',
    })
  })

  it('respeita o backoff: falhado com availableAt no futuro nao e reclamado', () => {
    const future = '2026-07-28T12:00:01.000Z'
    expect(
      evaluateClaimEligibility(row({ status: 'failed', availableAtIso: future }), NOW),
    ).toEqual({ claimable: false, reason: 'not_yet_available' })
    // Controle positivo: um milissegundo no PASSADO ja e reclamavel.
    const past = '2026-07-27T12:00:00.000Z'
    expect(
      evaluateClaimEligibility(row({ status: 'failed', availableAtIso: past }), NOW),
    ).toEqual({ claimable: true, kind: 'fresh' })
  })

  it('lease VALIDA e intocavel — e o que impede projecao dupla', () => {
    expect(
      evaluateClaimEligibility(
        row({ status: 'processing', leaseExpiresAtIso: '2026-07-28T12:00:30.000Z' }),
        NOW,
      ),
    ).toEqual({ claimable: false, reason: 'lease_still_valid' })
  })

  it('lease EXPIRADA e recuperavel — worker morto nao prende o evento', () => {
    expect(
      evaluateClaimEligibility(
        row({ status: 'processing', leaseExpiresAtIso: '2026-07-28T11:59:59.000Z' }),
        NOW,
      ),
    ).toEqual({ claimable: true, kind: 'expired_lease' })
  })

  it('lease com carimbo ilegivel conta como expirada, nao como eterna', () => {
    // Preso para sempre e pior que reprojetar de forma idempotente.
    expect(
      evaluateClaimEligibility(row({ status: 'processing', leaseExpiresAtIso: 'nao-e-data' }), NOW),
    ).toEqual({ claimable: true, kind: 'expired_lease' })
    expect(
      evaluateClaimEligibility(row({ status: 'processing', leaseExpiresAtIso: null }), NOW),
    ).toEqual({ claimable: true, kind: 'expired_lease' })
  })

  it('status desconhecido nao e reclamavel', () => {
    expect(evaluateClaimEligibility(row({ status: 'sei-la' }), NOW)).toEqual({
      claimable: false,
      reason: 'unknown_status',
    })
  })
})

describe('buildClaimMutation', () => {
  it('conta a tentativa no CLAIM, nao no fail', () => {
    // Um worker que morre sem reportar nada nunca chamaria `fail`. Se o
    // contador vivesse la, esse evento seria retentado para sempre.
    const mutation = buildClaimMutation({
      row: row({ attempts: 2 }),
      nowIso: NOW,
      leaseMs: 60_000,
      leaseToken: 'tok',
      workerId: 'w1',
    })
    expect(mutation.attempts).toBe(3)
    expect(mutation.status).toBe('processing')
    expect(mutation.leaseExpiresAtIso).toBe('2026-07-28T12:01:00.000Z')
    expect(mutation.lockedBy).toBe('w1')
  })

  it('aplica piso de lease para nao nascer expirada', () => {
    const mutation = buildClaimMutation({
      row: row(),
      nowIso: NOW,
      leaseMs: 0,
      leaseToken: 'tok',
      workerId: 'w1',
    })
    expect(mutation.leaseExpiresAtIso).toBe('2026-07-28T12:00:01.000Z')
  })
})

describe('validacao de lease', () => {
  const holder = {
    status: 'processing',
    leaseToken: 'tok-a',
    lockedBy: 'w1',
    eventPayloadHash: null,
  }

  it('aceita o portador legitimo', () => {
    expect(validateLease(holder, { leaseToken: 'tok-a', workerId: 'w1' })).toEqual({ ok: true })
  })

  it('ack de evento JA processado e idempotente, nao erro', () => {
    // E o caso real: o worker commitou no screen-db e caiu antes do ack.
    expect(
      validateLease({ ...holder, status: 'processed' }, { leaseToken: 'x', workerId: 'w9' }),
    ).toEqual({ ok: false, idempotent: true })
  })

  it('recusa lease ANTIGA — confirmar agora sobrescreveria outro worker', () => {
    expect(validateLease(holder, { leaseToken: 'tok-velho', workerId: 'w1' })).toEqual({
      ok: false,
      idempotent: false,
      reason: 'lease_token_mismatch',
    })
  })

  it('recusa worker diferente mesmo com o token certo', () => {
    expect(validateLease(holder, { leaseToken: 'tok-a', workerId: 'w2' })).toEqual({
      ok: false,
      idempotent: false,
      reason: 'worker_mismatch',
    })
  })

  it('recusa quem confirma sobre um payload que mudou', () => {
    expect(
      validateLease(
        { ...holder, eventPayloadHash: 'hash-novo' },
        { leaseToken: 'tok-a', workerId: 'w1', eventPayloadHash: 'hash-velho' },
      ),
    ).toEqual({ ok: false, idempotent: false, reason: 'payload_hash_mismatch' })
  })

  it('recusa ack sobre evento que nem esta em processamento', () => {
    expect(
      validateLease({ ...holder, status: 'pending' }, { leaseToken: 'tok-a', workerId: 'w1' }),
    ).toEqual({ ok: false, idempotent: false, reason: 'not_processing' })
  })
})

describe('backoff e dead-letter', () => {
  it('cresce exponencialmente e respeita o teto', () => {
    expect(backoffDelayMs(1)).toBe(2_000)
    expect(backoffDelayMs(2)).toBe(4_000)
    expect(backoffDelayMs(3)).toBe(8_000)
    expect(backoffDelayMs(50)).toBe(DEFAULT_RETRY_POLICY.backoffMaxMs)
  })

  it('e DETERMINISTICO: o jitter e injetado, nunca sorteado aqui', () => {
    expect(backoffDelayMs(1)).toBe(backoffDelayMs(1))
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, 0.5)).toBe(3_000)
  })

  it('erro permanente vai direto para dead_letter', () => {
    // Insistir num erro que o produtor declarou permanente so atrasa a fila.
    expect(decideFailOutcome({ attempts: 1, retryable: false, nowIso: NOW })).toEqual({
      status: 'dead_letter',
      availableAtIso: null,
      releaseLease: true,
    })
  })

  it('agenda retry com atraso enquanto houver tentativa', () => {
    expect(decideFailOutcome({ attempts: 1, retryable: true, nowIso: NOW })).toEqual({
      status: 'failed',
      availableAtIso: '2026-07-28T12:00:02.000Z',
      releaseLease: true,
    })
  })

  it('esgotou as tentativas: dead_letter, nao retry infinito', () => {
    expect(
      decideFailOutcome({ attempts: DEFAULT_MAX_ATTEMPTS, retryable: true, nowIso: NOW }).status,
    ).toBe('dead_letter')
    // Controle negativo: uma tentativa antes ainda e retry.
    expect(
      decideFailOutcome({ attempts: DEFAULT_MAX_ATTEMPTS - 1, retryable: true, nowIso: NOW })
        .status,
    ).toBe('failed')
  })
})

describe('sanitizacao de erro', () => {
  it('remove connection string do Postgres', () => {
    const dirty = 'connect ECONNREFUSED postgresql://u:senha@host:5432/base falhou'
    const clean = sanitizeErrorMessage(dirty)
    expect(clean).not.toContain('senha')
    expect(clean).not.toContain('5432')
    expect(clean).toContain('[redigido]')
  })

  it('remove header de autorizacao em suas varias formas', () => {
    for (const dirty of [
      'HTTP 401 com Authorization: Bearer abc.def.ghi',
      'header service-accounts API-Key 0f9a-secreta',
      'JWT eyJhbGciOiJIUzI1NiJ9.payload.sig recusado',
      'DSN password=abcdef invalido',
    ]) {
      const clean = sanitizeErrorMessage(dirty)
      expect(clean).toContain('[redigido]')
      for (const secret of ['abc.def.ghi', '0f9a-secreta', 'eyJhbGciOiJIUzI1NiJ9', 'abcdef']) {
        if (dirty.includes(secret)) expect(clean).not.toContain(secret)
      }
    }
  })

  it('trunca mensagem gigante e normaliza entrada nao textual', () => {
    expect(sanitizeErrorMessage('x'.repeat(5_000)).length).toBe(503)
    expect(sanitizeErrorMessage(null)).toBe('erro desconhecido')
    expect(sanitizeErrorMessage({ boom: true })).toBe('erro desconhecido')
  })

  it('controle positivo: mensagem inocente atravessa intacta', () => {
    // Sem isto, uma sanitizacao que apagasse tudo passaria nos testes acima.
    expect(sanitizeErrorMessage('slug ausente na traducao pt-BR')).toBe(
      'slug ausente na traducao pt-BR',
    )
  })
})

/* ------------------------------------------------------------------ */
/* Trava do atalho de build                                            */
/* ------------------------------------------------------------------ */

describe('impressao digital do build (debito da FASE 2B)', () => {
  const stampA = [
    { path: 'src/b.ts', mtimeMs: 200, size: 20 },
    { path: 'src/a.ts', mtimeMs: 100, size: 10 },
  ]

  it('e DETERMINISTICA: a ordem do sistema de arquivos nao muda o resultado', () => {
    // Se a ordem importasse, o atalho falharia aleatoriamente e seria desligado
    // por irritacao — voltando ao problema que a trava existe para resolver.
    expect(serializeSourceStamps(stampA)).toBe(serializeSourceStamps([...stampA].reverse()))
  })

  it('separador de caminho do Windows nao muda a impressao', () => {
    expect(serializeSourceStamps([{ path: 'src\\a.ts', mtimeMs: 1, size: 2 }])).toBe(
      serializeSourceStamps([{ path: 'src/a.ts', mtimeMs: 1, size: 2 }]),
    )
  })

  it('build carimbado com o MESMO fonte e considerado fresco', () => {
    const fp = serializeSourceStamps(stampA)
    expect(evaluateBuildFreshness(fp, fp)).toEqual({ fresh: true })
  })

  it('CONTROLE NEGATIVO: fonte editado invalida o build carimbado', () => {
    // Este e o defeito real da FASE 2B: a suite rodou contra um build antigo e
    // a correcao de hook recem escrita nunca foi exercitada.
    const antes = serializeSourceStamps(stampA)
    const depois = serializeSourceStamps([
      { path: 'src/b.ts', mtimeMs: 999, size: 21 },
      { path: 'src/a.ts', mtimeMs: 100, size: 10 },
    ])
    expect(evaluateBuildFreshness(antes, depois)).toEqual({
      fresh: false,
      reason: 'source_changed',
    })
  })

  it('sem carimbo nunca presume que o build serve', () => {
    expect(evaluateBuildFreshness(null, 'x')).toEqual({ fresh: false, reason: 'no_fingerprint' })
    expect(evaluateBuildFreshness('   ', 'x')).toEqual({ fresh: false, reason: 'no_fingerprint' })
  })

  it('o atalho NUNCA vale em CI', () => {
    // O valor do CI e provar a pipeline inteira; conveniencia local nao pode
    // atravessar para la nem por acidente.
    expect(skipBuildAllowed({ CMS_IT_SKIP_BUILD: '1', CI: 'true' })).toBe(false)
    expect(skipBuildAllowed({ CMS_IT_SKIP_BUILD: '1', CI: '1' })).toBe(false)
    // Controle positivo: fora de CI, o atalho continua disponivel.
    expect(skipBuildAllowed({ CMS_IT_SKIP_BUILD: '1' })).toBe(true)
    expect(skipBuildAllowed({ CMS_IT_SKIP_BUILD: '1', CI: 'false' })).toBe(true)
    expect(skipBuildAllowed({})).toBe(false)
  })
})
