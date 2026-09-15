/**
 * O que cada botao do painel operacional ENFILEIRA.
 *
 * A pergunta que este teste responde nao e "o job tem forma de job" — e "o botao
 * faz alguma coisa". Um job do painel com a MESMA chave do job que o agendador ja
 * enfileirou vira `ON CONFLICT DO NOTHING`: o botao responderia "enfileirado" e
 * nada aconteceria. Por isso cada caso compara a chave do painel com a chave que
 * o caminho normal gera para o mesmo titulo.
 */

import { describe, expect, it } from 'vitest'

import { buildCoverageJob } from '@screena/ingestion/coverage-entry'
import { scopedChildDiscriminator } from '@screena/ingestion/job-idempotency'
import { validateJobPayload } from '@screena/ingestion/job-payload'

import {
  ADMIN_ACTION_KIND_BY_TITLE_ACTION,
  ADMIN_FORCE_LOCALE,
  ADMIN_TITLE_ACTIONS,
  adminScope,
  isAdminRequestToken,
  planAdminCatalogJob,
  planAdminSchedulerRequest,
} from '../admin-action-plan.js'

const TOKEN_A = '0123456789abcdef01234567'
const TOKEN_B = 'fedcba9876543210fedcba98'

function planned(input: Parameters<typeof planAdminCatalogJob>[0]) {
  const plan = planAdminCatalogJob(input)
  if (!plan.ok) throw new Error(`plano recusado: ${plan.reason}`)
  return plan.job
}

describe('detalhe: a porta unica de cobertura, com escopo da decisao', () => {
  it('sync_details na prioridade 10, run_id e escopo admin:<token>', () => {
    const job = planned({ action: 'detalhe', kind: 'movie', tmdbId: 603, token: TOKEN_A })
    expect(job.jobType).toBe('sync_details')
    expect(job.idempotencyKey).toBe(`sync_details:movie:603:pt-BR:admin:${TOKEN_A}`)
    expect(job.priority).toBe(10)
    expect(job.runId).toBe(`admin:${TOKEN_A}`)
    expect(job.payload).toMatchObject({
      entityType: 'movie',
      tmdbId: 603,
      locale: 'pt-BR',
      reason: 'on_demand',
      enqueueDependencies: true,
      window: `admin:${TOKEN_A}`,
    })
  })

  it('CONTROLE NEGATIVO: sem o escopo, a chave seria a mesma do caminho normal — o botao viraria noop', () => {
    const semEscopo = buildCoverageJob({ kind: 'movie', tmdbId: 603, locale: 'pt-BR', reason: 'on_demand' })
    const agendador = buildCoverageJob({
      kind: 'movie',
      tmdbId: 603,
      locale: 'pt-BR',
      reason: 'scheduled',
      scope: 'title_detail_ended:2026-09-15',
    })
    const painel = planned({ action: 'detalhe', kind: 'movie', tmdbId: 603, token: TOKEN_A })
    expect(semEscopo.idempotencyKey).toBe('sync_details:movie:603:pt-BR')
    expect(painel.idempotencyKey).not.toBe(semEscopo.idempotencyKey)
    expect(painel.idempotencyKey).not.toBe(agendador.idempotencyKey)
  })

  it('a mesma decisao (mesmo token) da a mesma chave; outra decisao, outra chave', () => {
    const a1 = planned({ action: 'detalhe', kind: 'tv', tmdbId: 1399, token: TOKEN_A })
    const a2 = planned({ action: 'detalhe', kind: 'tv', tmdbId: 1399, token: TOKEN_A })
    const b = planned({ action: 'detalhe', kind: 'tv', tmdbId: 1399, token: TOKEN_B })
    expect(a1.idempotencyKey).toBe(a2.idempotencyKey)
    expect(b.idempotencyKey).not.toBe(a1.idempotencyKey)
  })

  it('o filho herda o escopo: a midia da cascata tambem nao colide com a do agendador', () => {
    const doPainel = scopedChildDiscriminator(ADMIN_FORCE_LOCALE, adminScope(TOKEN_A))
    const doAgendador = scopedChildDiscriminator(ADMIN_FORCE_LOCALE, 'title_detail_ended:2026-09-15')
    expect(doPainel).toBe(`pt-BR:admin:${TOKEN_A}`)
    expect(doPainel).not.toBe(doAgendador)
  })
})

describe('midia e temporadas', () => {
  it('midia de serie: sync_media com payload que o worker aceita', () => {
    const job = planned({ action: 'midia', kind: 'tv', tmdbId: 1399, token: TOKEN_A })
    expect(job.jobType).toBe('sync_media')
    expect(job.idempotencyKey).toBe(`sync_media:tv:1399:pt-BR:admin:${TOKEN_A}`)
    expect(job.priority).toBe(10)
    expect(() => validateJobPayload('sync_media', job.payload)).not.toThrow()
  })

  it('temporadas de serie: sync_seasons com episodios e midia de temporada', () => {
    const job = planned({ action: 'temporadas', kind: 'tv', tmdbId: 1399, token: TOKEN_B })
    expect(job.jobType).toBe('sync_seasons')
    expect(job.idempotencyKey).toBe(`sync_seasons:tv:1399:pt-BR:admin:${TOKEN_B}`)
    expect(job.payload).toMatchObject({ enqueueEpisodes: true, enqueueSeasonMedia: true, window: `admin:${TOKEN_B}` })
    expect(() => validateJobPayload('sync_seasons', job.payload)).not.toThrow()
  })

  it('temporadas de FILME e recusada com motivo, sem job', () => {
    const plan = planAdminCatalogJob({ action: 'temporadas', kind: 'movie', tmdbId: 603, token: TOKEN_A })
    expect(plan).toEqual({ ok: false, reason: 'filme nao tem temporadas' })
  })
})

describe('recusas antes de qualquer job', () => {
  it('token fora do formato e recusado (o nonce e a unica defesa contra reenvio)', () => {
    expect(isAdminRequestToken(TOKEN_A)).toBe(true)
    expect(isAdminRequestToken('0123456789ABCDEF01234567')).toBe(false)
    expect(isAdminRequestToken('abc')).toBe(false)
    expect(planAdminCatalogJob({ action: 'detalhe', kind: 'movie', tmdbId: 603, token: 'x' }).ok).toBe(false)
  })

  it('titulo sem tmdb_id valido e recusado', () => {
    expect(planAdminCatalogJob({ action: 'midia', kind: 'movie', tmdbId: 0, token: TOKEN_A })).toEqual({
      ok: false,
      reason: 'titulo sem tmdb_id valido',
    })
  })
})

describe('pedidos ao agendador', () => {
  it('fila da tabela de ritmos passa; fila inventada, nao', () => {
    expect(planAdminSchedulerRequest({ kind: 'queue', queue: 'people' })).toEqual({ ok: true, kind: 'queue', queue: 'people' })
    expect(planAdminSchedulerRequest({ kind: 'queue', queue: 'drop_all' }).ok).toBe(false)
  })

  it('nota e score so de filme ou serie, com id numerico', () => {
    expect(planAdminSchedulerRequest({ kind: 'title_ratings', entityType: 'tv', entityId: '42' })).toMatchObject({ ok: true })
    expect(planAdminSchedulerRequest({ kind: 'title_score', entityType: 'person', entityId: '42' }).ok).toBe(false)
    expect(planAdminSchedulerRequest({ kind: 'title_score', entityType: 'movie', entityId: '42; DROP' }).ok).toBe(false)
  })

  it('toda acao de titulo tem tipo auditado', () => {
    for (const action of ADMIN_TITLE_ACTIONS) {
      expect(ADMIN_ACTION_KIND_BY_TITLE_ACTION[action]).toMatch(/^force_title_/)
    }
  })
})
