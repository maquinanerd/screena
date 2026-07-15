/**
 * api-coverage.test.ts — Governanca do registro de cobertura de API (Fase 5).
 *
 * Trava duas coisas:
 *  1. POSITIVO: o registro COMMITADO (docs/api-coverage/*) e consistente com o
 *     codigo real — zero violacoes. Se alguem renomear um endpoint sem atualizar
 *     o registro, este teste (e o gate `api:coverage`) quebra.
 *  2. NEGATIVO: o validador REALMENTE pega drift e violacao de invariante — cada
 *     caso proibido produz violacao.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  COVERAGE_STATES,
  RATING_SOURCES,
  evaluateApiCoverage,
  parseProvidersYaml,
} from '../../scripts/audit/api-coverage-core.mjs'

const ROOT = process.cwd()

async function readText(rel: string): Promise<string | null> {
  try {
    return await readFile(path.join(ROOT, rel), 'utf8')
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
}

/** Reader fake em memoria para os casos negativos (nao toca no disco). */
function fakeReader(files: Record<string, string>) {
  return async (rel: string): Promise<string | null> => files[rel] ?? null
}

const PROVIDERS_YAML = ['providers:', '  - key: tmdb', '    provider_api: tmdb', '    kind: data', ''].join(
  '\n',
)

describe('Fase 5 — estados e fontes canonicas', () => {
  it('define exatamente os 8 estados de cobertura, sem duplicata', () => {
    expect(COVERAGE_STATES).toHaveLength(8)
    expect(new Set(COVERAGE_STATES).size).toBe(8)
    expect(COVERAGE_STATES).toEqual([
      'raw_captured',
      'normalized',
      'public_ready',
      'blocked_license',
      'blocked_privacy',
      'blocked_plan',
      'not_applicable',
      'deprecated',
    ])
  })

  it('as fontes editoriais espelham @screena/config (invariante 1)', () => {
    expect(RATING_SOURCES).toEqual(['imdb', 'rotten_tomatoes', 'metacritic', 'letterboxd', 'filmaffinity'])
  })

  it('parseProvidersYaml le o subconjunto plano e coage escalares', () => {
    const { providers, errors } = parseProvidersYaml(
      ['providers:', '  - key: tmdb', '    provider_api: tmdb', '    kind: data', '    active: true'].join('\n'),
    )
    expect(errors).toEqual([])
    expect(providers).toEqual([{ key: 'tmdb', provider_api: 'tmdb', kind: 'data', active: true }])
  })
})

describe('Fase 5 — registro commitado x codigo real', () => {
  it('passa sem violacoes (registro consistente com o codigo)', async () => {
    const providersText = await readText('docs/api-coverage/providers.yaml')
    const endpointsText = await readText('docs/api-coverage/endpoints.json')
    const fieldsText = await readText('docs/api-coverage/fields.json')

    expect(providersText).not.toBeNull()
    expect(endpointsText).not.toBeNull()
    expect(fieldsText).not.toBeNull()

    const res = await evaluateApiCoverage({
      providersText: providersText as string,
      endpoints: JSON.parse(endpointsText as string),
      fields: JSON.parse(fieldsText as string),
      readText,
    })

    expect(res.violations).toEqual([])
  })
})

describe('Fase 5 — o validador pega drift e violacao de invariante', () => {
  const base = {
    id: 'x',
    provider: 'tmdb',
    provider_api: 'tmdb',
    role: 'catalog',
    http: 'GET /x',
    worker_only: true,
    implemented: false,
    coverage_state: 'not_applicable',
    justification: 'roadmap',
  }

  it('falha quando provider_api e uma fonte editorial (invariante 2)', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [{ ...base, provider_api: 'imdb', rating_source: 'imdb' }],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/invariante 2|fonte editorial/i)
  })

  it('falha em coverage_state fora dos 8 canonicos', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [{ ...base, coverage_state: 'planned' }],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/coverage_state.*invalido/i)
  })

  it('falha em not_applicable sem justificativa', async () => {
    const { justification: _omit, ...noJust } = base
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [noJust],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/not_applicable.*justification/i)
  })

  it('falha em deprecated sem superseded_by', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [{ ...base, coverage_state: 'deprecated', justification: 'legado' }],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/deprecated.*superseded_by/i)
  })

  it('falha quando o provider nao existe em providers.yaml', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [{ ...base, provider: 'inexistente', provider_api: 'inexistente' }],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/nao existe em providers\.yaml/i)
  })

  it('falha em drift de ancora (simbolo sumiu do arquivo)', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [
        {
          ...base,
          implemented: true,
          coverage_state: 'public_ready',
          anchor: { file: 'fake/endpoints.ts', must_contain: ['getMovie'] },
        },
      ],
      fields: [],
      readText: fakeReader({ 'fake/endpoints.ts': 'export const nada = 1' }),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/nao contem `getMovie`.*drift/i)
  })

  it('falha em drift reverso (metodo-endpoint em codigo sem registro)', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [],
      fields: [],
      readText: fakeReader({ 'fake/client.ts': '  async getFoo(id) { return id }' }),
      enumerationSources: [{ file: 'fake/client.ts', label: 'Fake client' }],
    })
    expect(res.violations.join('\n')).toMatch(/drift reverso.*getFoo/i)
  })

  it('falha quando worker_only nao e true (invariante 3)', async () => {
    const res = await evaluateApiCoverage({
      providersText: PROVIDERS_YAML,
      endpoints: [{ ...base, worker_only: false }],
      fields: [],
      readText: fakeReader({}),
      enumerationSources: [],
    })
    expect(res.violations.join('\n')).toMatch(/worker_only.*true/i)
  })
})
