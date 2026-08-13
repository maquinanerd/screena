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
  { providerKey: '2', providerName: 'Apple TV Store', offers: 10135, offerTypes: { buy: 5162, rent: 4973 } },
  { providerKey: '3', providerName: 'Google Play Movies', offers: 9043, offerTypes: { buy: 4698, rent: 4345 } },
  { providerKey: '10', providerName: 'Amazon Video', offers: 5123, offerTypes: { buy: 2579, rent: 2544 } },
  { providerKey: '35', providerName: 'Rakuten TV', offers: 3465, offerTypes: { buy: 1750, rent: 1708, ads: 7 } },
  { providerKey: '8', providerName: 'Netflix', offers: 1801, offerTypes: { subscription: 1801 } },
  { providerKey: '1899', providerName: 'HBO Max', offers: 1760, offerTypes: { subscription: 1760 } },
  { providerKey: '119', providerName: 'Amazon Prime Video', offers: 1525, offerTypes: { subscription: 1525 } },
  { providerKey: '192', providerName: 'YouTube', offers: 1408, offerTypes: { buy: 731, rent: 676, free: 1 } },
  { providerKey: '337', providerName: 'Disney Plus', offers: 1204, offerTypes: { subscription: 1204 } },
  { providerKey: '167', providerName: 'Claro video', offers: 324, offerTypes: { rent: 210, subscription: 68, buy: 46 } },
  { providerKey: '2100', providerName: 'Amazon Prime Video with Ads', offers: 238, offerTypes: { subscription: 238 } },
  { providerKey: '1796', providerName: 'Netflix Standard with Ads', offers: 172, offerTypes: { subscription: 172 } },
  { providerKey: '9', providerName: 'Amazon Prime Video', offers: 94, offerTypes: { subscription: 94 } },
  { providerKey: '2302', providerName: 'Mercado Play', offers: 76, offerTypes: { ads: 76 } },
  { providerKey: '122', providerName: 'Disney+', offers: 57, offerTypes: { subscription: 57 } },
  { providerKey: '613', providerName: 'Amazon Prime Video Free with Ads', offers: 6, offerTypes: { ads: 6 } },
  { providerKey: '307', providerName: 'Globoplay', offers: 7, offerTypes: { subscription: 7 } },
  { providerKey: '175', providerName: 'Netflix Kids', offers: 2, offerTypes: { subscription: 2 } },
  { providerKey: '300', providerName: 'Pluto TV', offers: 1, offerTypes: { ads: 1 } },
] as const

/** O provedor tem alguma oferta por assinatura? Loja = zero. */
function hasSubscription(providerKey: string): boolean {
  const row = HARVEST_2026_08_13.find((p) => p.providerKey === providerKey)
  return (row?.offerTypes as Record<string, number> | undefined)?.subscription !== undefined
}

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

  it('AS TRES LOJAS recebem o MESMO tratamento (a contradicao da #167)', () => {
    const index = tmdbAliasIndex()
    // A colheita prova que os tres sao a mesma natureza: zero assinatura.
    for (const key of ['2', '3', '10']) {
      expect(hasSubscription(key)).toBe(false)
    }
    // Logo: os tres mapeados. A #167 recusou `10` POR SER LOJA enquanto `2` ja
    // estava mapeado e passando — nao havia principio separando os dois, havia
    // uma decisao aplicada a um so.
    expect(index.get('2')).toBe('apple-tv')
    expect(index.get('3')).toBe('google-play')
    expect(index.get('10')).toBe('amazon-video')
  })

  it('CONTROLE NEGATIVO: a loja da Amazon NAO cai no slug da assinatura', () => {
    const index = tmdbAliasIndex()
    // Colapsar `10` em `prime-video` afirmaria que a compra avulsa esta inclusa
    // na assinatura. Sao slugs distintos, e continuam distintos.
    expect(index.get('10')).not.toBe(index.get('119'))
    expect(index.get('10')).not.toBe('prime-video')
    // ...e o servico por assinatura, esse sim, e um slug so para os dois ids.
    expect(index.get('119')).toBe('prime-video')
    expect(index.get('9')).toBe('prime-video')
  })

  it('variantes de PLANO colapsam na marca, sem duplicar a linha na tela', () => {
    const index = tmdbAliasIndex()
    expect(index.get('2100')).toBe('prime-video') // Prime Video with Ads
    expect(index.get('613')).toBe('prime-video') // Prime Video Free with Ads
    expect(index.get('1796')).toBe('netflix') // Netflix Standard with Ads
    expect(index.get('175')).toBe('netflix') // Netflix Kids
    // Cada marca continua sendo UM slug: e o que impede "Netflix" e "Netflix
    // Standard with Ads" virarem duas entradas na mesma pagina.
    expect(new Set(['8', '1796', '175'].map((k) => index.get(k))).size).toBe(1)
    expect(new Set(['119', '9', '2100', '613'].map((k) => index.get(k))).size).toBe(1)
  })

  it('o plano gratuito com anuncio depende da MODALIDADE para nao mentir', () => {
    // `613` e o unico dos planos colapsados que NAO e `subscription`. Sem a
    // modalidade na tela, dobra-lo em `prime-video` afirmaria que precisa de
    // assinatura; com ela, a linha le "Prime Video · Grátis com anúncios".
    expect(hasSubscription('613')).toBe(false)
    const row = HARVEST_2026_08_13.find((p) => p.providerKey === '613')
    expect((row?.offerTypes as Record<string, number>).ads).toBe(6)
  })

  it('CONTROLE NEGATIVO: o 2o id "Disney+" fica sem alias ate o TERRITORIO decidir', () => {
    const index = tmdbAliasIndex()
    expect(index.has('122')).toBe(false)
    // Os dois sao `subscription`, os dois se chamam Disney para um humano — a
    // modalidade NAO separa este caso. O que separa e o territorio, e a
    // colheita imprimia so a CONTAGEM de paises, nunca os codigos.
    expect(hasSubscription('122')).toBe(true)
    expect(hasSubscription('337')).toBe(true)
    const d337 = HARVEST_2026_08_13.find((p) => p.providerKey === '337')?.offers ?? 0
    const d122 = HARVEST_2026_08_13.find((p) => p.providerKey === '122')?.offers ?? 0
    expect(d337).toBeGreaterThan(d122)
  })

  it('CONTROLE NEGATIVO: canal dentro de outro servico nunca vira plataforma', () => {
    const index = tmdbAliasIndex()
    // "…Amazon Channel" e "…Apple TV Channel" sao canais DENTRO de outro
    // servico. Exibi-los como assinatura propria e decisao de exibicao.
    for (const key of ['2156', '2157']) expect(index.has(key)).toBe(false)
  })

  it('CONTROLE NEGATIVO: plataforma BR sem numero de BR nao entra no registro', () => {
    const index = tmdbAliasIndex()
    // Claro video, Mercado Play, Looke, Oldflix, NetMovies... A colheita mede
    // volume GLOBAL, e um provedor com 324 ofertas em 7 paises pode nao ter
    // nenhuma em BR. Registrar por palpite puxa licenca e decisao de uso no
    // `legal apply` para um provedor que talvez nunca apareca na tela.
    for (const key of ['167', '2302', '484', '499', '19', '47', '447', '477']) {
      expect(index.has(key)).toBe(false)
    }
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
    const novos = plan.aliases
      .filter((a) => a.providerApi === 'tmdb' && a.action === 'create')
      .map((a) => a.externalKey)
      .sort()
    expect(novos).toEqual(
      ['2', '3', '8', '9', '10', '119', '175', '300', '307', '337', '613', '1796', '1899', '2100'].sort(),
    )
  })

  it('renomear o nome canonico e `rename`, nunca perda do slug', () => {
    // `source_licenses.source_key` aponta para o SLUG. Renomear o slug do
    // `apple-tv` orfanaria a licenca vigente; o que muda e o nome EXIBIDO, e o
    // plano idempotente ja tem a acao certa para isso.
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, {
      providers: new Map([['apple-tv', 'Apple TV']]),
      aliases: new Map(),
    })
    const apple = plan.providers.find((p) => p.slug === 'apple-tv')
    expect(apple).toMatchObject({ action: 'rename', canonicalName: 'Apple TV Store' })
  })
})
