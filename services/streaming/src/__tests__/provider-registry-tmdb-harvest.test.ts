/**
 * provider-registry-tmdb-harvest.test.ts — Os aliases TMDB batem com a COLHEITA
 * de producao (2026-08-13), nao com fixture inventada.
 *
 * A recusa anterior a criar alias TMDB estava certa: nao havia evidencia. Agora
 * ha — `reprocess-watch-providers` imprimiu 291 provedores vistos no dado real,
 * com `provider_id`, `provider_name` e volume. Este arquivo transcreve a fatia
 * relevante daquela saida e trava tres coisas:
 *
 *  1. os ids de maior volume deixam de cair em `no-alias`;
 *  2. dois ids da MESMA plataforma resolvem para UM slug canonico;
 *  3. os ids deliberadamente NAO mapeados continuam nao mapeados — mapear
 *     "Amazon Video" (loja) no slug do "Amazon Prime Video" (assinatura)
 *     afirmaria que uma compra avulsa esta inclusa na assinatura.
 */

import { describe, expect, it } from 'vitest'

import {
  WATCH_PROVIDER_REGISTRY,
  planProviderRegistration,
  validateProviderRegistry,
} from '../provider-registry.js'

/**
 * Transcricao literal da colheita de producao (`provedores TMDB vistos`), na
 * fatia citada no relatorio. Nao e fixture inventada: sao os pares
 * (provider_id, provider_name, ofertas) impressos pelo comando.
 */
const HARVEST_2026_08_13 = [
  { providerKey: '2', providerName: 'Apple TV', offers: 10135 },
  { providerKey: '3', providerName: 'Google Play Movies', offers: 9043 },
  { providerKey: '10', providerName: 'Amazon Video', offers: 5123 },
  { providerKey: '8', providerName: 'Netflix', offers: 1801 },
  { providerKey: '1899', providerName: 'HBO Max', offers: 1760 },
  { providerKey: '119', providerName: 'Amazon Prime Video', offers: 1525 },
  { providerKey: '337', providerName: 'Disney Plus', offers: 1204 },
  { providerKey: '9', providerName: 'Amazon Prime Video', offers: 94 },
  { providerKey: '122', providerName: 'Disney+', offers: 57 },
  { providerKey: '307', providerName: 'Globoplay', offers: 7 },
  { providerKey: '300', providerName: 'Pluto TV', offers: 1 },
] as const

/** `external_key` TMDB -> slug canonico, como o registro resolve hoje. */
function tmdbAliasIndex(): Map<string, string> {
  const index = new Map<string, string>()
  for (const entry of WATCH_PROVIDER_REGISTRY) {
    for (const alias of entry.aliases) {
      if (alias.providerApi === 'tmdb') index.set(alias.externalKey, entry.slug)
    }
  }
  return index
}

describe('aliases TMDB vindos da colheita real', () => {
  it('CONTROLE POSITIVO: os ids de maior volume resolvem para o slug esperado', () => {
    const index = tmdbAliasIndex()
    expect(index.get('3')).toBe('google-play')
    expect(index.get('119')).toBe('prime-video')
    expect(index.get('337')).toBe('disney-plus')
    expect(index.get('307')).toBe('globoplay')
    // Os que ja existiam continuam de pe (nao houve retarget silencioso).
    expect(index.get('8')).toBe('netflix')
    expect(index.get('1899')).toBe('max')
    expect(index.get('2')).toBe('apple-tv')
    expect(index.get('300')).toBe('pluto-tv')
  })

  it('ids duplos da MESMA plataforma resolvem para UM slug canonico', () => {
    const index = tmdbAliasIndex()
    // O upstream exibe o nome identico nos dois registros — e a mesma
    // plataforma. Um registro por alias existe exatamente para isto.
    const nomes = HARVEST_2026_08_13.filter((p) => p.providerKey === '9' || p.providerKey === '119')
    expect(new Set(nomes.map((p) => p.providerName))).toEqual(new Set(['Amazon Prime Video']))
    expect(index.get('9')).toBe('prime-video')
    expect(index.get('119')).toBe('prime-video')
    expect(index.get('9')).toBe(index.get('119'))
  })

  it('CONTROLE NEGATIVO: "Amazon Video" (loja) NAO herda o slug da assinatura', () => {
    const index = tmdbAliasIndex()
    // Nome diferente das outras duas Amazon: e a loja transacional. Mapea-la em
    // `prime-video` afirmaria que a compra esta inclusa na assinatura.
    expect(HARVEST_2026_08_13.find((p) => p.providerKey === '10')?.providerName).toBe('Amazon Video')
    expect(index.has('10')).toBe(false)
  })

  it('CONTROLE NEGATIVO: o 2o id "Disney+" fica sem alias ate o payload decidir', () => {
    const index = tmdbAliasIndex()
    expect(index.has('122')).toBe(false)
    // ...e o que ESTA mapeado nao e o de menor volume por acidente.
    const d337 = HARVEST_2026_08_13.find((p) => p.providerKey === '337')?.offers ?? 0
    const d122 = HARVEST_2026_08_13.find((p) => p.providerKey === '122')?.offers ?? 0
    expect(d337).toBeGreaterThan(d122)
  })

  it('nenhum alias inventado: todo alias TMDB do registro esta na colheita', () => {
    const colhidos = new Set<string>(HARVEST_2026_08_13.map((p) => p.providerKey))
    const doRegistro = [...tmdbAliasIndex().keys()]
    expect(doRegistro.filter((key) => !colhidos.has(key))).toEqual([])
  })

  it('o registro continua valido e sem alias repetido', () => {
    expect(validateProviderRegistry(WATCH_PROVIDER_REGISTRY)).toEqual([])
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, {
      providers: new Map(),
      aliases: new Map(),
    })
    expect(plan.ok).toBe(true)
    expect(plan.conflicts).toEqual([])
    // Os cinco aliases TMDB novos aparecem como `create` no plano idempotente.
    const novos = plan.aliases
      .filter((a) => a.providerApi === 'tmdb' && a.action === 'create')
      .map((a) => a.externalKey)
      .sort()
    expect(novos).toEqual(['119', '1899', '2', '3', '300', '307', '337', '8', '9'].sort())
  })
})
