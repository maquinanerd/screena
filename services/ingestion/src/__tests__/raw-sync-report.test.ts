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
import type { KindCounts, PayloadSizeStats, RawSyncReport } from '../raw-sync/types.js'

const LIMITS = { movie: 100, tv: 100, person: 100 }

function report(overrides: Partial<RawSyncReport> = {}): RawSyncReport {
  const zero: KindCounts = { created: 0, updated: 0, skipped: 0, failed: 0 }
  const zeroSize: PayloadSizeStats = { count: 0, avgBytes: 0, maxBytes: 0, minBytes: 0 }
  return {
    mode: 'apply',
    baseLanguage: 'pt-BR',
    limits: LIMITS,
    perKindSelected: { movie: 0, tv: 0, person: 0 },
    perKind: { movie: { ...zero }, tv: { ...zero }, person: { ...zero } },
    totals: { ...zero },
    payloadSizes: { movie: { ...zeroSize }, tv: { ...zeroSize }, person: { ...zeroSize } },
    payloadSizesTotal: { ...zeroSize },
    unsupportedSkipped: 0,
    unsupportedByKind: {},
    retries: 0,
    rate429: 0,
    requests: 0,
    notProcessed: 0,
    aborted: false,
    abortReason: null,
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

  it('lote interrompido (teto/breaker) => aborted, mesmo com sucessos parciais', () => {
    expect(
      deriveSyncStatus(
        report({
          selected: 10,
          aborted: true,
          abortReason: 'request-ceiling',
          notProcessed: 7,
          totals: { created: 3, updated: 0, skipped: 0, failed: 0 },
        }),
      ),
    ).toBe('aborted')
  })

  it('aborted tem precedencia sobre failed/partial (run cortado)', () => {
    expect(
      deriveSyncStatus(
        report({
          selected: 5,
          aborted: true,
          abortReason: 'circuit-open',
          notProcessed: 3,
          totals: { created: 1, updated: 0, skipped: 0, failed: 1 },
        }),
      ),
    ).toBe('aborted')
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
    expect(md).not.toContain('Tamanho de payload por tipo')
  })

  it('apply: mostra requisicoes e nota de ABORTO quando o lote parou cedo', () => {
    const md = renderRawSyncReport(
      report({
        selected: 10,
        requests: 42,
        aborted: true,
        abortReason: 'circuit-open',
        notProcessed: 7,
        totals: { created: 3, updated: 0, skipped: 0, failed: 0 },
      }),
    )
    expect(md).toContain('requisicoes (fetch): 42')
    expect(md).toContain('ABORTADO')
    expect(md).toContain('circuit-open')
    expect(md).toContain('7 item(ns) NAO processado')
  })

  it('apply: sem aborto NAO imprime a nota de ABORTADO', () => {
    const md = renderRawSyncReport(
      report({ selected: 1, requests: 1, totals: { created: 1, updated: 0, skipped: 0, failed: 0 } }),
    )
    expect(md).toContain('requisicoes (fetch): 1')
    expect(md).not.toContain('ABORTADO')
  })

  it('apply: mostra a tabela de tamanho de payload por tipo', () => {
    const md = renderRawSyncReport(
      report({
        selected: 3,
        payloadSizes: {
          movie: { count: 2, avgBytes: 2048, maxBytes: 3072, minBytes: 1024 },
          tv: { count: 1, avgBytes: 500000, maxBytes: 500000, minBytes: 500000 },
          person: { count: 0, avgBytes: 0, maxBytes: 0, minBytes: 0 },
        },
        payloadSizesTotal: { count: 3, avgBytes: 168448, maxBytes: 500000, minBytes: 1024 },
      }),
    )
    expect(md).toContain('Tamanho de payload por tipo')
    expect(md).toContain('serializacao canonica')
    // media do movie: 2048 bytes = 2.0 KB
    expect(md).toContain('2.0 KB')
    // total agrega as 3 amostras
    expect(md).toMatch(/\*\*total\*\* \| 3 \|/)
  })

  it('JSON serializado inclui status, processed e payloadSizes no apply', () => {
    const json = JSON.parse(
      serializeRawSyncReportJson(
        report({
          selected: 1,
          totals: { created: 1, updated: 0, skipped: 0, failed: 0 },
          payloadSizes: {
            movie: { count: 1, avgBytes: 1000, maxBytes: 1000, minBytes: 1000 },
            tv: { count: 0, avgBytes: 0, maxBytes: 0, minBytes: 0 },
            person: { count: 0, avgBytes: 0, maxBytes: 0, minBytes: 0 },
          },
          payloadSizesTotal: { count: 1, avgBytes: 1000, maxBytes: 1000, minBytes: 1000 },
        }),
      ),
    )
    expect(json.status).toBe('success')
    expect(json.processed).toBe(1)
    expect(json.payloadSizes.movie).toEqual({ count: 1, avgBytes: 1000, maxBytes: 1000, minBytes: 1000 })
    expect(json.payloadSizesTotal.count).toBe(1)
  })
})
