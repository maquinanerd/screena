/**
 * Testes do relatorio/status da promocao (P0-00f): derivacao do status de
 * api_sync_logs e o markdown/JSON. Sem rede, sem DB.
 */

import { describe, expect, it } from 'vitest'
import {
  derivePromoteStatus,
  promoteProcessed,
  renderPromoteReport,
  serializePromoteReportJson,
} from '../raw-promote/report.js'
import type { PromoteCounts, PromoteReport } from '../raw-promote/types.js'

function report(over: Partial<PromoteReport> = {}): PromoteReport {
  const zero: PromoteCounts = { created: 0, updated: 0, failed: 0 }
  return {
    mode: 'apply',
    baseLanguage: 'pt-BR',
    limit: 100,
    available: 0,
    selected: 0,
    counts: { ...zero },
    failedIds: [],
    durationMs: 0,
    ...over,
  }
}

describe('promoteProcessed', () => {
  it('soma created+updated+failed', () => {
    expect(promoteProcessed({ created: 2, updated: 1, failed: 1 })).toBe(4)
  })
})

describe('derivePromoteStatus', () => {
  it('nada selecionado => empty', () => {
    expect(derivePromoteStatus(report({ selected: 0 }))).toBe('empty')
  })
  it('tudo ok => success', () => {
    expect(
      derivePromoteStatus(report({ selected: 2, counts: { created: 2, updated: 0, failed: 0 } })),
    ).toBe('success')
  })
  it('alguma falha (parcial) => partial', () => {
    expect(
      derivePromoteStatus(report({ selected: 3, counts: { created: 2, updated: 0, failed: 1 } })),
    ).toBe('partial')
  })
  it('tudo falhou => failed', () => {
    expect(
      derivePromoteStatus(report({ selected: 2, counts: { created: 0, updated: 0, failed: 2 } })),
    ).toBe('failed')
  })
})

describe('renderPromoteReport', () => {
  it('apply: mostra desfechos + ids que falharam', () => {
    const md = renderPromoteReport(
      report({
        mode: 'apply',
        available: 10,
        selected: 3,
        counts: { created: 2, updated: 0, failed: 1 },
        failedIds: [42],
      }),
    )
    expect(md).toContain('Desfechos (apply)')
    expect(md).toContain('movie (P0-00f.1)')
    expect(md).toContain('42')
  })

  it('dry-run: mostra o plano, nao desfechos', () => {
    const md = renderPromoteReport(report({ mode: 'dry-run', available: 5, selected: 3 }))
    expect(md).toContain('Plano (dry-run')
    expect(md).not.toContain('Desfechos (apply)')
  })

  it('JSON serializado inclui status e processed no apply', () => {
    const json = JSON.parse(
      serializePromoteReportJson(
        report({ selected: 1, counts: { created: 1, updated: 0, failed: 0 } }),
      ),
    )
    expect(json.status).toBe('success')
    expect(json.processed).toBe(1)
  })
})
