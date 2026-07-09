/**
 * Testes do core de Daily ID Exports: catalogo de arquivos, nome/URL por data e
 * parse JSONL. Sem rede.
 */

import { describe, expect, it } from 'vitest'
import {
  ADULT_EXPORT_FILES,
  DAILY_ID_EXPORTS,
  TMDB_EXPORTS_BASE_URL,
  exportFileName,
  exportUrl,
  formatExportDate,
  parseIdExport,
  parseIdExportLine,
} from '../discovery/id-exports.js'

const DATE = new Date(Date.UTC(2026, 6, 9)) // 2026-07-09 (UTC)

describe('catalogo de exports', () => {
  it('lista exatamente os 7 exports padrao com os kinds corretos', () => {
    expect(DAILY_ID_EXPORTS.map((e) => [e.file, e.kind])).toEqual([
      ['movie_ids', 'movie'],
      ['tv_series_ids', 'tv'],
      ['person_ids', 'person'],
      ['collection_ids', 'collection'],
      ['tv_network_ids', 'network'],
      ['keyword_ids', 'keyword'],
      ['production_company_ids', 'company'],
    ])
  })

  it('hasAdultField: so movie e person trazem o campo adult (fail-closed por tipo)', () => {
    const byKind = Object.fromEntries(DAILY_ID_EXPORTS.map((e) => [e.kind, e.hasAdultField]))
    expect(byKind).toEqual({
      movie: true,
      tv: false,
      person: true,
      collection: false,
      network: false,
      company: false,
      keyword: false,
    })
  })

  it('NENHUM export padrao e um arquivo adult_* (camada 1 do filtro adult)', () => {
    for (const entry of DAILY_ID_EXPORTS) {
      expect(entry.file.startsWith('adult_')).toBe(false)
    }
    // Os arquivos adult_* declarados sao disjuntos da lista de download.
    const downloadFiles = new Set(DAILY_ID_EXPORTS.map((e) => e.file))
    for (const adult of ADULT_EXPORT_FILES) {
      expect(downloadFiles.has(adult)).toBe(false)
    }
    expect(ADULT_EXPORT_FILES).toEqual([
      'adult_movie_ids',
      'adult_tv_series_ids',
      'adult_person_ids',
    ])
  })
})

describe('nome/URL por data (MM_DD_YYYY, UTC)', () => {
  it('formatExportDate zero-padded em UTC', () => {
    expect(formatExportDate(DATE)).toBe('07_09_2026')
    expect(formatExportDate(new Date(Date.UTC(2025, 11, 1)))).toBe('12_01_2025')
  })

  it('exportFileName e exportUrl seguem o padrao oficial', () => {
    expect(exportFileName('movie_ids', DATE)).toBe('movie_ids_07_09_2026.json.gz')
    expect(exportUrl('person_ids', DATE)).toBe(
      `${TMDB_EXPORTS_BASE_URL}/person_ids_07_09_2026.json.gz`,
    )
    expect(TMDB_EXPORTS_BASE_URL).toBe('https://files.tmdb.org/p/exports')
  })
})

describe('parseIdExportLine / parseIdExport (JSONL tolerante)', () => {
  it('parseia uma linha de objeto valida', () => {
    const rec = parseIdExportLine('{"adult":false,"id":3924,"popularity":2.4}')
    expect(rec).toEqual({ adult: false, id: 3924, popularity: 2.4 })
  })

  it('devolve null para linha vazia/branca, JSON invalido, ou nao-objeto', () => {
    expect(parseIdExportLine('')).toBeNull()
    expect(parseIdExportLine('   ')).toBeNull()
    expect(parseIdExportLine('{invalid json')).toBeNull()
    expect(parseIdExportLine('42')).toBeNull() // numero, nao objeto
    expect(parseIdExportLine('[1,2,3]')).toBeNull() // array, nao objeto
    expect(parseIdExportLine('null')).toBeNull()
  })

  it('parseIdExport ignora linhas invalidas/brancas e o trailing newline', () => {
    const text = [
      '{"id":1,"adult":false}',
      '',
      '{invalid',
      '{"id":2,"adult":true}',
      '', // trailing
    ].join('\n')
    const records = parseIdExport(text)
    expect(records.map((r) => r.id)).toEqual([1, 2])
  })
})
