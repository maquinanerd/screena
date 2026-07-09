/**
 * Testes do relatorio/status do raw sync (P0-00d): derivacao do status de
 * api_sync_logs e presenca do breakdown por tipo no markdown. Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import {
  deriveSyncStatus,
  processedOf,
  renderRawSyncReport,
  serializeRawSyncReportJson,
} from '../raw-sync/report.js'
import type { KindCounts, RawSyncReport } from '../raw-sync/types.js'

const LIMITS = { movie: 100, tv: 100, person: 100 }

function report(overrides: Partial<RawSyncReport> = {}): RawSyncReport {
  const zero: KindCounts = { created: 0, updated: 0, skipped: 0, failed: 0 }
  return {
    mode: 'apply',
    baseLanguage: 'pt-BR',
    limits: LIMITS,
    perKindSelected: { movie: 0, tv: 0, person: 0 },
    perKind: { movie: { ...zero }, tv: { ...zero }, person: { ...zero } },
    totals: { ...zero },
    unsupportedSkipped: 0,
    unsupportedByKind: {},
    retries: 0,
    rate429: 0,
    scanned: 0,
    selected: 0,
    durationMs: 0,
    ...overrides,
  }
}

describe('processedOf', () => {
  it('soma created+updated+skipped+failed', () => {
    expect(processedOf({ created: 2, updated: 1, skipped: 3, failed: 1 })).toBe(7)
  })
})

describe('deriveSyncStatus', () => {
  it('nada selecionado => empty', () => {
    expect(deriveSyncStatus(report({ selected: 0 }))).toBe('empty')
  })

  it('tudo ok => success', () => {
    expect(
      deriveSyncStatus(report({ selected: 2, totals: { created: 2, updated: 0, skipped: 0, failed: 0 } })),
    ).toBe('success')
  })

  it('alguma falha (parcial) => partial', () => {
    expect(
      deriveSyncStatus(report({ selected: 3, totals: { created: 2, updated: 0, skipped: 0, failed: 1 } })),
    ).toBe('partial')
  })

  it('tudo falhou => failed', () => {
    expect(
      deriveSyncStatus(report({ selected: 2, totals: { created: 0, updated: 0, skipped: 0, failed: 2 } })),
    ).toBe('failed')
  })
})

describe('renderRawSyncReport', () => {
  it('apply: mostra breakdown por tipo + unsupported', () => {
    const md = renderRawSyncReport(
      report({
        selected: 3,
        perKindSelected: { movie: 2, tv: 1, person: 0 },
        perKind: {
          movie: { created: 1, updated: 1, skipped: 0, failed: 0 },
          tv: { created: 0, updated: 0, skipped: 1, failed: 0 },
          person: { created: 0, updated: 0, skipped: 0, failed: 0 },
        },
        totals: { created: 1, updated: 1, skipped: 1, failed: 0 },
        unsupportedSkipped: 5,
        unsupportedByKind: { collection: 3, keyword: 2 },
      }),
    )
    expect(md).toContain('Desfechos por tipo (apply)')
    expect(md).toContain('| movie |')
    expect(md).toContain('| tv |')
    expect(md).toContain('| person |')
    expect(md).toContain('unsupportedSkipped: 5')
    expect(md).toContain('collection')
  })

  it('dry-run: mostra o plano, nao desfechos', () => {
    const md = renderRawSyncReport(
      report({ mode: 'dry-run', perKindSelected: { movie: 4, tv: 2, person: 1 } }),
    )
    expect(md).toContain('Plano (dry-run')
    expect(md).not.toContain('Desfechos por tipo')
  })

  it('JSON serializado inclui status no apply', () => {
    const json = JSON.parse(
      serializeRawSyncReportJson(
        report({ selected: 1, totals: { created: 1, updated: 0, skipped: 0, failed: 0 } }),
      ),
    )
    expect(json.status).toBe('success')
    expect(json.processed).toBe(1)
  })
})
