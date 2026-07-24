/**
 * Testes do gate e do relatorio da auditoria (PURO, sem DB).
 */

import { describe, expect, it } from 'vitest'
import {
  describeAuditGate,
  evaluateAuditGate,
  formatAuditReport,
  runDatabaseAudit,
  type AuditReaderPort,
  type DatabaseAuditReport,
} from '../index.js'

const NOW = new Date('2026-07-16T12:00:00.000Z')

describe('evaluateAuditGate', () => {
  it('bloqueia sem DATABASE_URL', () => {
    const d = evaluateAuditGate({
      environment: 'development',
      confirmProductionRead: false,
      hasDatabaseUrl: false,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/DATABASE_URL/)
  })

  it('em producao EXIGE --confirm-production-read', () => {
    const d = evaluateAuditGate({
      environment: 'production',
      confirmProductionRead: false,
      hasDatabaseUrl: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/confirm-production-read/)
  })

  it('em producao com confirmacao explicita, libera (segue read-only)', () => {
    const d = evaluateAuditGate({
      environment: 'production',
      confirmProductionRead: true,
      hasDatabaseUrl: true,
    })
    expect(d.allowed).toBe(true)
  })

  it('fora de producao libera sem confirmacao', () => {
    expect(
      evaluateAuditGate({
        environment: 'development',
        confirmProductionRead: false,
        hasDatabaseUrl: true,
      }).allowed,
    ).toBe(true)
  })

  it('describeAuditGate nunca vaza credencial', () => {
    const text = describeAuditGate(
      evaluateAuditGate({
        environment: 'production',
        confirmProductionRead: false,
        hasDatabaseUrl: true,
      }),
    )
    expect(text).not.toMatch(/postgres:\/\/|password|@/)
  })
})

const reader: AuditReaderPort = {
  readEntityCounts: async () => [{ entity: 'movies', total: 10, lastSyncedAt: NOW }],
  readCoverage: async () => [
    { kind: 'movie', total: 10, withImages: 5, withTrailer: 2, imageRatio: 0.5, trailerRatio: 0.2 },
  ],
  readJobs: async () => [{ status: 'pending', count: 3 }],
  readDeadLetterCount: async () => 1,
  readCheckpoints: async () => [
    { job: 'changes:movie', lastPage: 2, totalPages: 5, done: false, cursor: 'w', updatedAt: NOW },
  ],
  readSnapshots: async () => [
    {
      listType: 'trending',
      entityType: 'movie',
      locale: 'pt-BR',
      capturedAt: NOW,
      expiresAt: NOW,
      ageSeconds: 60,
      expired: true,
      items: 20,
    },
  ],
  readSearchDocuments: async () => ({ total: 42, byLocale: [{ locale: 'pt-BR', count: 42 }] }),
  readPublishability: async () => [
    {
      entity: 'movie',
      total: 10,
      withSlug: 8,
      withoutSlug: 2,
      withTranslation: 7,
      withoutTranslation: 3,
      withMedia: 6,
      withoutMedia: 4,
      renderable: 8,
      publishable: 7,
      sitemapEligible: 7,
      withDecision: 5,
      missingDecision: 5,
      staleDecision: 1,
    },
  ],
  readDecisionReasons: async () => [
    { reason: 'eligible', count: 4 },
    { reason: 'missing_slug', count: 1 },
  ],
}

describe('runDatabaseAudit', () => {
  it('agrega tudo o que o reader traz (somente leitura)', async () => {
    const report = await runDatabaseAudit(reader, { environment: 'development', now: NOW })
    expect(report.entities[0]?.total).toBe(10)
    expect(report.deadLetters).toBe(1)
    expect(report.checkpoints[0]?.job).toBe('changes:movie')
    expect(report.snapshots[0]?.expired).toBe(true)
    expect(report.searchDocuments.total).toBe(42)
  })
})

describe('formatAuditReport', () => {
  it('formata as secoes sem imprimir credencial', async () => {
    const report: DatabaseAuditReport = await runDatabaseAudit(reader, {
      environment: 'development',
      now: NOW,
    })
    const text = formatAuditReport(report)
    expect(text).toContain('Entidades')
    expect(text).toContain('Cobertura de midia')
    expect(text).toContain('dead-letters: 1')
    expect(text).toContain('search_documents: 42')
    expect(text).toContain('EXPIRADO')
    expect(text).not.toMatch(/postgres:\/\/|password=/)
  })
})
